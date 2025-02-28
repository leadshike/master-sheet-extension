// APIConnector.gs

/**
 * Shows a toast message in the spreadsheet
 */
function showToast(message, type = 'info') {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const title = type.charAt(0).toUpperCase() + type.slice(1);
  ss.toast(message, title, 5);
}

/**
 * Main function to execute API request and handle response
 */
function executeAPIRequest(apiUrl, method, headers, paginationType, settings) {
    try {
        // Validate required URL
        if (!apiUrl) {
            throw new Error('API URL is required');
        }

        console.log('Request details:', { apiUrl, method, headers, paginationType, settings });

        // Get saved format for this endpoint
        const savedFormat = getUserSavedFormat(apiUrl);
        console.log('Saved format for endpoint:', savedFormat);

        // Prepare request options
        const options = {
            method: method || 'GET',
            muteHttpExceptions: true,
            headers: headers || {}
        };

        // Make initial request
        const response = UrlFetchApp.fetch(apiUrl, options);
        const responseCode = response.getResponseCode();

        if (responseCode >= 200 && responseCode < 300) {
            let responseData = JSON.parse(response.getContentText());
            console.log('Initial response data:', responseData);

            // Handle pagination if specified
            if (paginationType && paginationType !== 'None') {
                responseData = handlePagination(responseData, apiUrl, options, paginationType);
            }

            // Write response to sheet using saved format and settings
            writeFormattedDataToSheet(responseData, savedFormat, settings);
            return 'API request completed successfully';
        } else {
            throw new Error(`API request failed with status ${responseCode}`);
        }

    } catch (error) {
        Logger.log('Error in executeAPIRequest:', error);
        throw new Error(`Failed to execute API request: ${error.message}`);
    }
}

/**
 * Handles different types of pagination
 */
function handlePagination(initialData, apiUrl, options, paginationType) {
  let allData = Array.isArray(initialData) ? initialData : [initialData];
  let nextPage = true;
  let pageNum = 2;
  let offset = allData.length;
  
  const MAX_PAGES = 10;
  
  try {
    while (nextPage && pageNum <= MAX_PAGES) {
      let nextUrl = apiUrl;
      
      switch (paginationType) {
        case 'Page Number':
          nextUrl += nextUrl.includes('?') ? '&' : '?';
          nextUrl += `page=${pageNum}`;
          break;
          
        case 'Offset Limit':
          nextUrl += nextUrl.includes('?') ? '&' : '?';
          nextUrl += `offset=${offset}&limit=100`;
          break;
          
        default:
          nextPage = false;
          continue;
      }

      const response = UrlFetchApp.fetch(nextUrl, options);
      const newData = JSON.parse(response.getContentText());
      
      if (Array.isArray(newData) && newData.length > 0) {
        allData = allData.concat(newData);
        pageNum++;
        offset += newData.length;
      } else {
        nextPage = false;
      }
    }
    
    return allData;
  } catch (error) {
    Logger.log('Error in pagination:', error);
    return allData;
  }
}

/**
 * Format and write data to sheet using saved format
 */
function writeFormattedDataToSheet(data, format, settings) {
    const sheet = SpreadsheetApp.getActiveSheet();
    
    try {
        // Apply format if exists
        let formattedData = format ? applyFormat(data, format) : (Array.isArray(data) ? data : [data]);
        
        // Add date/time if setting is enabled
        if (settings && settings.includeDateTime) {
            const now = new Date();
            formattedData = formattedData.map(row => ({
                ...row,
                'Date': now.toLocaleString()
            }));
        }

        if (formattedData.length === 0) {
            throw new Error('No data to write after applying format');
        }

        // Get headers
        const headers = format ? 
            [...Object.keys(format)
                .filter(field => format[field].selected)
                .map(field => format[field].columnHeading),
             ...(settings?.includeDateTime ? ['Date'] : [])]
            : Object.keys(formattedData[0]);

        // Handle append mode
        let startRow = 1;
        if (settings?.appendMode) {
            const lastRow = sheet.getLastRow();
            if (lastRow > 0) {
                startRow = lastRow + 1;
            }
        } else {
            // Clear sheet if not in append mode
            sheet.clear();
        }

        // Write headers if not appending or sheet is empty
        if (startRow === 1) {
            sheet.getRange(1, 1, 1, headers.length)
                .setValues([headers])
                .setFontWeight('bold')
                .setBackground('#f3f4f6');
        }

        // Write data
        const values = formattedData.map(row => 
            headers.map(header => {
                const value = row[header];
                return (value !== null && typeof value === 'object') ? JSON.stringify(value) : value;
            })
        );

        if (values.length > 0) {
            sheet.getRange(startRow + (startRow === 1 ? 1 : 0), 1, values.length, headers.length)
                .setValues(values);
        }

        // Format sheet
        sheet.autoResizeColumns(1, headers.length);
        if (startRow === 1) {
            sheet.setFrozenRows(1);
        }

        return true;
    } catch (error) {
        Logger.log('Error writing to sheet:', error);
        throw new Error(`Failed to write to sheet: ${error.message}`);
    }
}


/**
 * Apply saved format to data
 */
function applyFormat(data, format) {
  const dataArray = Array.isArray(data) ? data : [data];
  const formattedData = [];

  dataArray.forEach(row => {
    const formattedRow = {};
    let includeRow = true;

    Object.keys(format).forEach(field => {
      if (format[field].selected) {
        const sourceField = format[field].sourceField;
        const value = row[sourceField];

        // Apply filter if exists
        if (format[field].filter !== 'none' && format[field].filterValue) {
          if (!checkFilter(value, format[field].filter, format[field].filterValue)) {
            includeRow = false;
          }
        }

        // Use custom column heading
        formattedRow[format[field].columnHeading] = value;
      }
    });

    if (includeRow) {
      formattedData.push(formattedRow);
    }
  });

  return formattedData;
}

/**
 * Check filter conditions
 */
function checkFilter(value, filter, filterValue) {
  const numValue = !isNaN(value) ? Number(value) : value;
  const numFilterValue = !isNaN(filterValue) ? Number(filterValue) : filterValue;

  switch (filter) {
    case '>':
      return numValue > numFilterValue;
    case '>=':
      return numValue >= numFilterValue;
    case '<':
      return numValue < numFilterValue;
    case '<=':
      return numValue <= numFilterValue;
    case 'equals':
      return value == filterValue;
    case 'contains':
      return String(value).toLowerCase().includes(String(filterValue).toLowerCase());
    default:
      return true;
  }
}

/**
 * Save a new API request configuration
 */
function saveRequest(requestName, requestData) {
    try {
        const userProperties = PropertiesService.getUserProperties();
        const savedRequests = JSON.parse(userProperties.getProperty('savedRequests') || '{}');
        
        // Check if request with this name already exists
        if (savedRequests[requestName] && !requestData.overwrite) {
            throw new Error('Request with this name already exists');
        }

        // Save the request
        savedRequests[requestName] = {
            method: requestData.method,
            url: requestData.url,
            headers: requestData.headers || {},
            pagination: requestData.pagination || 'None',
            settings: {
                appendMode: requestData.settings?.appendMode || false,
                includeDateTime: requestData.settings?.includeDateTime || false,
                delaySeconds: requestData.settings?.delaySeconds || 2.0,
                delayApiCalls: requestData.settings?.delayApiCalls || 1
            }
        };

        userProperties.setProperty('savedRequests', JSON.stringify(savedRequests));
        return true;
    } catch (error) {
        Logger.log('Error saving request:', error);
        throw new Error(`Failed to save request: ${error.message}`);
    }
}

/**
 * Get all saved requests
 */
function getSavedRequests() {
    try {
        const userProperties = PropertiesService.getUserProperties();
        return JSON.parse(userProperties.getProperty('savedRequests') || '{}');
    } catch (error) {
        Logger.log('Error getting saved requests:', error);
        throw new Error('Failed to get saved requests');
    }
}

/**
 * Get a specific saved request by name
 */
function getRequest(requestName) {
    try {
        const userProperties = PropertiesService.getUserProperties();
        const savedRequests = JSON.parse(userProperties.getProperty('savedRequests') || '{}');
        
        if (!savedRequests[requestName]) {
            throw new Error('Request not found');
        }

        return savedRequests[requestName];
    } catch (error) {
        Logger.log('Error getting request:', error);
        throw new Error(`Failed to get request: ${error.message}`);
    }
}

/**
 * Execute a saved request by name
 */
function executeSavedRequest(requestName) {
    try {
        const request = getRequest(requestName);
        if (!request) {
            throw new Error('Request not found');
        }

        return executeAPIRequest(
            request.url,
            request.method,
            request.headers,
            request.pagination,
            request.settings
        );
    } catch (error) {
        Logger.log('Error executing saved request:', error);
        throw new Error(`Failed to execute saved request: ${error.message}`);
    }
}

/**
 * Delete a saved request
 */
function deleteRequest(requestName) {
    try {
        const userProperties = PropertiesService.getUserProperties();
        const savedRequests = JSON.parse(userProperties.getProperty('savedRequests') || '{}');
        
        if (!savedRequests[requestName]) {
            throw new Error('Request not found');
        }

        delete savedRequests[requestName];
        userProperties.setProperty('savedRequests', JSON.stringify(savedRequests));
        return true;
    } catch (error) {
        Logger.log('Error deleting request:', error);
        throw new Error(`Failed to delete request: ${error.message}`);
    }
}

/**
 * Shows error message in a popup
 */
function showError(message) {
  SpreadsheetApp.getUi().alert('Error', message, SpreadsheetApp.getUi().ButtonSet.OK);
}
