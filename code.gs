// Firestore helpers
function getUserUrl(userEmail) {
 return `${FIRESTORE_BASE_URL}/users/${encodeURIComponent(userEmail)}`;
}

function fetchUserData(userEmail, method = 'get', payload = null) {
 const options = {
   method,
   muteHttpExceptions: true
 };
 
 if (payload) {
   options.contentType = 'application/json';
   
   // If we're doing a PATCH, add the updateMask parameter to the URL to specify 
   // that we want to merge fields rather than replace the entire document
   if (method.toUpperCase() === 'PATCH') {
     const fields = Object.keys(payload.fields);
     const updateMask = fields.map(field => `updateMask.fieldPaths=${field}`).join('&');
     const url = `${getUserUrl(userEmail)}?${updateMask}`;
     
     options.payload = JSON.stringify(payload);
     const response = UrlFetchApp.fetch(url, options);
     return {
       response,
       data: JSON.parse(response.getContentText())
     };
   }
   
   options.payload = JSON.stringify(payload);
 }
 
 const response = UrlFetchApp.fetch(getUserUrl(userEmail), options);
 return {
   response,
   data: JSON.parse(response.getContentText())
 };
}

function onInstall(e) {
 onOpen(e);
}

function onOpen() {
 SpreadsheetApp.getUi()
   .createMenu(MENU_TITLE)
   .addItem('Open', 'openSidebar')
   .addToUi();
}

function getEmail() {
 return Session.getEffectiveUser().getEmail();
}

function getUserData(userEmail) {
 try {
   if (!userEmail) userEmail = getEmail();
   const result = fetchUserData(userEmail);
   return {
     credits: parseInt(result.data.fields.credits?.integerValue || 0),
     email: userEmail,
     runHistory: result.data.fields.runHistory?.arrayValue?.values || [],
   };
 } catch (error) {
   console.error('Error fetching user data:', error);
   return null;
 }
}

function openSidebar() {
 const userEmail = getEmail();
 let credits = 0;

 try {
   const result = fetchUserData(userEmail);
   const responseCode = result.response.getResponseCode();

   if (responseCode === 200) {
     credits = result.data.fields.credits.integerValue;
     SpreadsheetApp.getUi().alert(`Welcome back! You are already registered. You have ${credits} credits left.`);
   } else if (responseCode === 404) {
     credits = DEFAULT_CREDITS;
     registerUser(userEmail);
     SpreadsheetApp.getUi().alert(`Welcome! You have been registered successfully. You have ${credits} credits.`);
   } else {
     throw new Error(`Unexpected response code: ${responseCode}`);
   }

   PropertiesService.getScriptProperties().setProperty('userEmail', userEmail);
 } catch (error) {
   console.error('Error fetching or registering user data:', error);
   SpreadsheetApp.getUi().alert(ERROR_MESSAGES.FETCH_USER);
 }

 const template = HtmlService.createTemplateFromFile('index');
 template.credits = credits;

 const htmlOutput = template
   .evaluate()
   .setSandboxMode(HtmlService.SandboxMode.IFRAME)
   .setTitle(SIDEBAR_TITLE)
   .setWidth(SIDEBAR_WIDTH);

 SpreadsheetApp.getUi().showSidebar(htmlOutput);
}

function openDocsPopup() {
  const html = HtmlService.createHtmlOutputFromFile('docs')
  SpreadsheetApp.getUi().showModalDialog(html, 'Formula Documentation');
}
// Function to open preview popup
function openPreviewPopup() {
  const html = HtmlService.createHtmlOutputFromFile('preview').setTitle('Response Preview');
  SpreadsheetApp.getUi().showModalDialog(html, 'Response Preview');
}

function openDataIntegrationPopup() {
    const html = HtmlService.createHtmlOutputFromFile('dataIntegration').setWidth(800).setHeight(800).setTitle('Data Integration');
    SpreadsheetApp.getUi().showModalDialog(html, 'Data Integration');
}

function openEnrichmentFormulasPopup() {
    const html = HtmlService.createHtmlOutputFromFile('enrichmentFormulas').setWidth(800).setHeight(800).setTitle('Enrichment Formulas');
    SpreadsheetApp.getUi().showModalDialog(html, 'Enrichment Formulas');
}

// Function to get preview data (test API call)
// Function to get preview data
function getPreviewData() {
  const endpoint = getCurrentEndpoint();
  console.log('Getting preview data for endpoint:', endpoint);
  
  try {
    // First check if we have a saved format
    const savedFormat = getUserSavedFormat(endpoint);
    console.log('Saved format:', savedFormat);

    if (savedFormat) {
      // Convert saved format to match the desired table structure
      return Object.entries(savedFormat).map(([field, config]) => ({
        field: field,
        sourceName: config.sourceField,
        columnHeading: config.columnHeading,
        filter: config.filter || 'none',
        filterValue: config.filterValue || '',
        selected: config.selected
      }));
    }

    // If no saved format exists, make the API call
    const response = makeTestApiCall(endpoint);
    if (!response) return null;

    // Get the sample data
    const sampleData = Array.isArray(response) ? response[0] : response;
    
    // Create initial format matching table structure
    const fields = Object.keys(sampleData).map(field => ({
      field: field,
      sourceName: field,
      columnHeading: field,
      filter: 'none',
      filterValue: '',
      selected: true
    }));

    // Create and save initial format
    const initialFormat = {};
    fields.forEach(field => {
      initialFormat[field.field] = {
        sourceField: field.sourceName,
        columnHeading: field.columnHeading,
        filter: field.filter,
        filterValue: field.filterValue,
        selected: field.selected
      };
    });
    saveUserPreviewFormat(initialFormat);

    return fields;
  } catch (error) {
    console.error('Error in getPreviewData:', error);
    throw new Error('Failed to get preview data: ' + error.message);
  }
}
// Function to create initial format from response
function createInitialFormat(response) {
  const format = {};
  Object.keys(response).forEach(field => {
    format[field] = {
      selected: true,
      sourceField: field,
      columnHeading: field,
      filter: 'none',
      filterValue: ''
    };
  });
  return format;
}

// Function to make test API call
function makeTestApiCall(endpoint) {
  if (!endpoint) return null;

  try {
    const response = UrlFetchApp.fetch(endpoint);
    const jsonResponse = JSON.parse(response.getContentText());
    console.log('API Response:', jsonResponse);
    return jsonResponse;
  } catch (error) {
    console.error('Error in test API call:', error);
    throw new Error('Failed to fetch API data: ' + error.message);
  }
}

// Function to get current endpoint
function getCurrentEndpoint() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const endpoint = scriptProperties.getProperty('current_endpoint');
  console.log('Current endpoint:', endpoint);
  return endpoint;
}

// Function to set current endpoint
function setCurrentEndpoint(endpoint) {
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty('current_endpoint', endpoint);
  console.log('Endpoint set:', endpoint);
}

// Function to save preview format to Firebase
function saveUserPreviewFormat(format) {
  console.log('Saving format:', format);
  const endpoint = getCurrentEndpoint();
  
  if (!endpoint) {
    throw new Error('No endpoint found in properties');
  }
  
  try {
    const userEmail = getEmail();
    const result = fetchUserData(userEmail);
    const userData = result.data;
    
    // Get existing formats or initialize an empty array
    const existingFormats = userData.fields.universalApiFormats?.arrayValue?.values || [];
    
    // Check if format for this endpoint already exists
    let formatExists = false;
    const updatedFormats = existingFormats.map(function(item) {
      const itemEndpoint = item.mapValue.fields.endpoint?.stringValue;
      if (itemEndpoint === endpoint) {
        formatExists = true;
        // Update existing format with the complex object structure
        const formatFields = {};
        
        // Convert the format object to Firestore field format
        Object.entries(format).forEach(([fieldName, fieldConfig]) => {
          formatFields[fieldName] = {
            mapValue: {
              fields: {
                sourceField: { stringValue: fieldConfig.sourceField },
                columnHeading: { stringValue: fieldConfig.columnHeading },
                filter: { stringValue: fieldConfig.filter || 'none' },
                filterValue: { stringValue: fieldConfig.filterValue || '' },
                selected: { booleanValue: fieldConfig.selected }
              }
            }
          };
        });
        
        // Return updated item
        return {
          mapValue: {
            fields: {
              endpoint: { stringValue: endpoint },
              format: { 
                mapValue: { 
                  fields: formatFields 
                } 
              }
            }
          }
        };
      }
      return item;
    });
    
    // If format for this endpoint doesn't exist, add a new one
    if (!formatExists) {
      const formatFields = {};
      
      // Convert the format object to Firestore field format
      Object.entries(format).forEach(([fieldName, fieldConfig]) => {
        formatFields[fieldName] = {
          mapValue: {
            fields: {
              sourceField: { stringValue: fieldConfig.sourceField },
              columnHeading: { stringValue: fieldConfig.columnHeading },
              filter: { stringValue: fieldConfig.filter || 'none' },
              filterValue: { stringValue: fieldConfig.filterValue || '' },
              selected: { booleanValue: fieldConfig.selected }
            }
          }
        };
      });
      
      updatedFormats.push({
        mapValue: {
          fields: {
            endpoint: { stringValue: endpoint },
            format: { 
              mapValue: { 
                fields: formatFields 
              } 
            }
          }
        }
      });
    }
    
    // Prepare update payload - only update the universalApiFormats field
    const updatePayload = {
      fields: {
        universalApiFormats: {
          arrayValue: { values: updatedFormats }
        }
      }
    };
    
    // Update user data in Firebase
    fetchUserData(userEmail, 'PATCH', updatePayload);
    return true;
  } catch (error) {
    console.error('Error saving format to Firebase:', error);
    throw new Error('Failed to save format: ' + error.message);
  }
}


// Function to get saved format for an endpoint from Firebase
function getUserSavedFormat(endpoint) {
  if (!endpoint) return null;
  
  try {
    const userEmail = getEmail();
    const result = fetchUserData(userEmail);
    const userData = result.data;
    
    // Get existing formats or return null if none exist
    const existingFormats = userData.fields.universalApiFormats?.arrayValue?.values || [];
    
    // Find format for the specified endpoint
    for (let i = 0; i < existingFormats.length; i++) {
      const item = existingFormats[i];
      const itemEndpoint = item.mapValue.fields.endpoint?.stringValue;
      
      if (itemEndpoint === endpoint) {
        // Convert from Firestore format to the expected JavaScript object format
        const firestoreFormat = item.mapValue.fields.format.mapValue.fields;
        const resultFormat = {};
        
        // Convert each field from Firestore format
        Object.entries(firestoreFormat).forEach(([fieldName, fieldConfig]) => {
          const config = fieldConfig.mapValue.fields;
          resultFormat[fieldName] = {
            sourceField: config.sourceField.stringValue,
            columnHeading: config.columnHeading.stringValue,
            filter: config.filter.stringValue,
            filterValue: config.filterValue.stringValue,
            selected: config.selected.booleanValue
          };
        });
        
        return resultFormat;
      }
    }
    
    // Return null if no format is found for this endpoint
    return null;
  } catch (error) {
    console.error('Error getting saved format from Firebase:', error);
    return null;
  }
}

// Helper function to check filter conditions
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

function formatPayloadForFirestore(data) {
 const formatters = {
   string: function(value) { return { stringValue: value }; },
   number: function(value) { return { integerValue: value }; },
   object: function(value) { 
     return value instanceof Date ? { timestampValue: value.toISOString() } : null; 
   }
 };

 const formatted = {};
 for (const [key, value] of Object.entries(data)) {
   const type = typeof value;
   const formatter = formatters[type];
   if (formatter) {
     formatted[key] = formatter(value);
   }
 }
 return formatted;
}

function registerUser(userId) {
 const payload = {
   fields: formatPayloadForFirestore({
     email: userId,
     credits: DEFAULT_CREDITS,
     installationDate: new Date()
   })
 };

 try {
   const result = fetchUserData(userId, 'patch', payload);
   if (result.response.getResponseCode() !== 200) {
     throw new Error(`${ERROR_MESSAGES.REGISTER_USER} ${result.response.getContentText()}`);
   }
 } catch (error) {
   console.error(ERROR_MESSAGES.REGISTER_USER, error);
   throw error;
 }
}

function updateHeaders(headerObject) {
 try {
   const sheet = SpreadsheetApp.getActiveSheet();
   for (const [cell, header] of Object.entries(headerObject)) {
     sheet.getRange(cell).setValue(header);
   }
   return true;
 } catch (error) {
   console.error(ERROR_MESSAGES.UPDATE_HEADERS, error);
   return false;
 }
}

function saveRunHistory(userEmail, runStats) {
 try {
   const result = fetchUserData(userEmail);
   const data = result.data;
   
   const currentHistory = data.fields.runHistory?.arrayValue?.values || [];
   const currentCredits = parseInt(data.fields.credits?.integerValue || 0);
   const updatedCredits = Math.max(0, currentCredits - runStats.successfulCalls);

   const newEntry = {
     mapValue: {
       fields: {
         functionName: { stringValue: runStats.functionName },
         startTime: { stringValue: runStats.startTime },
         endTime: { stringValue: runStats.endTime },
         totalApiCalls: { integerValue: runStats.totalApiCalls },
         successfulCalls: { integerValue: runStats.successfulCalls },
         failedCalls: { integerValue: runStats.failedCalls },
         totalRetries: { integerValue: runStats.totalRetries },
         runName: { stringValue: runStats.runName }
       }
     }
   };

   const updatePayload = {
     fields: {
       ...data.fields,
       credits: { integerValue: updatedCredits },
       runHistory: {
         arrayValue: { values: [...currentHistory, newEntry] }
       }
     }
   };

   fetchUserData(userEmail, 'PATCH', updatePayload);
 } catch (error) {
   console.error(ERROR_MESSAGES.SAVE_HISTORY, error);
 }
}

function createCustomFormula(customFormula) {
 const userEmail = getEmail();

 try {
   const result = fetchUserData(userEmail);
   const data = result.data;
   const existingFormulas = data.fields.customFormulas?.arrayValue?.values || [];
   
   const newFormula = {
     mapValue: {
       fields: {
         formula: { stringValue: customFormula.formula },
         headers: {
           arrayValue: {
             values: customFormula.headers.map(function(header) {
               return {
                 mapValue: {
                   fields: {
                     [Object.keys(header)[0]]: { stringValue: header[Object.keys(header)[0]] }
                   }
                 }
               };
             })
           }
         },
         prompt: { stringValue: customFormula.prompt }
       }
     }
   };

   const updatePayload = {
     fields: {
       ...data.fields,
       customFormulas: {
         arrayValue: { values: [...existingFormulas, newFormula] }
       }
     }
   };

   fetchUserData(userEmail, 'PATCH', updatePayload);
   return true;
 } catch (error) {
   console.error(ERROR_MESSAGES.SAVE_FORMULA, error);
   return false;
 }
}

function createCustomRecipe(recipe) {
 const userEmail = getEmail();

 try {
   const result = fetchUserData(userEmail);
   const data = result.data;
   const existingRecipes = data.fields.customRecipes?.arrayValue?.values || [];
   
   const newRecipe = {
     mapValue: {
       fields: {
         recipeName: { stringValue: recipe.recipeName },
         description: { stringValue: recipe.description }
       }
     }
   };

   const updatePayload = {
     fields: {
       ...data.fields,
       customRecipes: {
         arrayValue: { values: [...existingRecipes, newRecipe] }
       }
     }
   };

   fetchUserData(userEmail, 'PATCH', updatePayload);
   return true;
 } catch (error) {
   console.error(ERROR_MESSAGES.SAVE_RECIPE, error);
   return false;
 }
}

function getCurrentSheetHeaders() {
 const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
 const headersRange = sheet.getRange(1, 1, 1, sheet.getMaxColumns());
 const headersValues = headersRange.getValues()[0];
 
 const headers = {};
 for (let i = 0; i < headersValues.length; i++) {
   if (headersValues[i]) {
     const cellReference = sheet.getRange(1, i + 1).getA1Notation();
     headers[cellReference] = headersValues[i];
   }
 }
 return headers;
}

function getCustomRecipes() {
 try {
   const result = fetchUserData(getEmail());
   const customRecipes = result.data.fields.customRecipes?.arrayValue?.values || [];
   
   return customRecipes.map(function(recipe) {
     return {
       recipeName: recipe.mapValue.fields.recipeName.stringValue,
       description: recipe.mapValue.fields.description.stringValue
     };
   });
 } catch (error) {
   console.error(ERROR_MESSAGES.FETCH_RECIPES, error);
   return [];
 }
}

function getUserCustomFormulas() {
 try {
   const result = fetchUserData(getEmail());
   return result.data;
 } catch (error) {
   console.error(ERROR_MESSAGES.FETCH_FORMULAS, error);
   return null;
 }
}
