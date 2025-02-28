function validateInputs(schema, inputs, cells) {
  const errors = [];
  
  if (schema) {
    // If schema exists, do full validation
    for (const [field, value] of Object.entries(inputs)) {
      const rules = schema[field];
      if (!rules) continue;
      
      if (rules.required && !value) {
        errors.push(`Missing required field ${field} at ${cells[`${field}Cell`]}`);
        continue;
      }

      if (value && !rules.validate(value)) {
        errors.push(rules.message(cells[`${field}Cell`]));
      }
    }
  } else {
    // If no schema, just do missing field validation
    for (const [field, value] of Object.entries(inputs)) {
      if (!value || value.toString().trim() === '') {
        errors.push(`Missing required field ${field} at ${cells[`${field}Cell`]}`);
      }
    }
  }

  return {
    isValid: errors.length === 0,
    messages: errors
  };
}

function showAlert(messages) {
  const formattedMessages = messages.join('\n\n');
  SpreadsheetApp.getUi().alert('Validation Errors', formattedMessages, SpreadsheetApp.getUi().ButtonSet.OK);
}

// API Handler configurations
const API_HANDLERS = {
  GEMINI: {
    makeRequest: function(prompt, apiKey) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
      const payload = {
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          temperature: API_CONFIG.API_SETTINGS.temperature,
          maxOutputTokens: API_CONFIG.API_SETTINGS.maxTokens
        }
      };
      
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      
      const result = JSON.parse(response.getContentText());
      if (!result?.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Invalid Gemini API response');
      }
      return result.candidates[0].content.parts[0].text.trim();
    }
  },
  OPENAI: {
    makeRequest: function(prompt, apiKey) {
      const url = 'https://api.openai.com/v1/chat/completions';
      const payload = {
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        temperature: API_CONFIG.API_SETTINGS.temperature,
        max_tokens: API_CONFIG.API_SETTINGS.maxTokens
      };
      
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      
      const result = JSON.parse(response.getContentText());
      if (!result?.choices?.[0]?.message?.content) {
        throw new Error('Invalid OpenAI API response');
      }
      return result.choices[0].message.content.trim();
    }
  },
  DEEPSEEK: {
    makeRequest: function(prompt, apiKey) {
      const url = 'https://api.deepseek.com/chat/completions';
      const payload = {
        model: "deepseek-chat",
        messages: [
          {"role": "user", "content": prompt}
        ],
        stream: false,
        temperature: API_CONFIG.API_SETTINGS.temperature,
        max_tokens: API_CONFIG.API_SETTINGS.maxTokens
      };
      
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        headers: { 
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      
      const result = JSON.parse(response.getContentText());
      if (!result?.choices?.[0]?.message?.content) {
        throw new Error('Invalid Deepseek API response');
      }
      return result.choices[0].message.content.trim();
    }
  }
};

function storeErrorMessage(message, range, sheetId) {
  const errorKey = `error_${Date.now()}`;
  PropertiesService.getScriptProperties().setProperty(errorKey, JSON.stringify({
    message,
    range: range.getA1Notation(),
    sheetId,
    timestamp: Date.now()
  }));
  return message;
}

function createStatusMessage(validationErrors = [], validRowCount = 0, credits = null, totalRows = 0) {
  let message = "";
  
  if (validationErrors.length > 0) {
    message += `Validation Errors:\n${validationErrors.join("\n")}\n\n`;
  }
  
  if (credits !== null && totalRows > credits) {
    message += `You have ${credits} credits. Only processing first ${credits} valid row(s). ${totalRows - credits} row(s) cannot be processed due to insufficient credits.\n\n`;
  }
  
  if (validRowCount > 0) {
    const processCount = credits !== null ? Math.min(validRowCount, credits) : validRowCount;
    message += `Processing ${processCount} valid row(s). Loading response...`;
  }
  
  return message || "No valid rows to process";
}

/**
 * Generic function to validate rows
 * @param {object} params - Validation parameters
 * @param {Sheet} params.sheet - Google Sheet object
 * @param {object} params.inputConfig - Configuration for input fields
 * @param {object} params.schema - Validation schema
 * @returns {object} Validation results
 */
function validateRows(params) {
  const {
    sheet,
    inputConfig,
    schema
  } = params;

  const rows = [];
  const validationErrors = [];
  let validRowCount = 0;
  let failedValidationCount = 0;

  // Extract row numbers from inputConfig
  const { startRow, endRow } = inputConfig;

  for (let row = startRow; row <= endRow; row++) {
    // Get all inputs based on inputConfig
    const inputs = {};
    const cells = {};

    // Dynamically create inputs and cells based on configuration
    Object.entries(inputConfig.columns).forEach(([field, column]) => {
      inputs[field] = sheet.getRange(column + row).getValue().toString();
      cells[`${field}Cell`] = `${column}${row}`;
    });

    const validation = validateInputs(schema, inputs, cells);
    
    if (validation.isValid) {
      let processedRow = {
        row,
        ...inputConfig.processRow?.(inputs, row) // Allow custom row processing
      };
      rows.push(processedRow);
      validRowCount++;
    } else {
      validationErrors.push(`Row ${row}: ${validation.messages.join(", ")}`);
      failedValidationCount++;
    }
  }

  return {
    rows,
    validationErrors,
    validRowCount,
    failedValidationCount
  };
}

/**
 * Creates initial run statistics object
 * @param {object} params - Stats initialization parameters
 * @returns {object} Initial run statistics
 */
function initializeRunStats(params) {
  const {
    startRow,
    endRow
  } = params;

  return {
    functionName: params.functionName,
    startTime: new Date().toISOString(),
    totalApiCalls: endRow ? (endRow - startRow + 1) : 1,
    successfulCalls: 0,
    failedCalls: 0,
    totalRetries: 0,
    totalRows: endRow ? (endRow - startRow + 1) : 1,
    runName: `${params.functionName}_${new Date().toISOString()}`
  };
}


function processValidRows(rows, credits, request) {
  const processableRows = Math.min(rows.length, credits);
  const requestId = `request_${Date.now()}`;
  
  const requestWithStats = {
    ...request,
    rows: rows.slice(0, processableRows),
    status: 'pending'
  };

  PropertiesService.getScriptProperties().setProperty(requestId, JSON.stringify(requestWithStats));
  return processableRows;
}
