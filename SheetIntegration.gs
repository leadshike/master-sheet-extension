
/**
 * Custom formula that retrieves verified work emails based on input parameters
 * @param {string} sourceCol The column with first names
 * @param {string} destCol The column to output verified emails
 * @param {number} startRow Starting row number
 * @param {number} [endRow] Optional ending row number
 * @return {string} Loading message with estimated time
 * @customfunction
 */
function FIND_VERIFIED_EMAIL(sourceCol, destCol, startRow, endRow) {
  const range = SpreadsheetApp.getActiveRange();
  const sheet = range.getSheet();
  const scriptProperties = PropertiesService.getScriptProperties();
  const userEmail = scriptProperties.getProperty('userEmail');

  if (!userEmail) return "Error: Unable to fetch user email. Please open the sidebar first.";

  const runStats = {
    functionName: "VerifiedEmail",
    startTime: new Date().toISOString(),
    totalApiCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    totalRetries: 0,
    runName: `Email_${new Date().toISOString()}`
  };

  try {
    endRow = endRow || startRow;
    const rows = [];
    
    for (let row = startRow; row <= endRow; row++) {
      rows.push({ 
        firstNameCell: `${sourceCol}${row}`,
        lastNameCell: `${String.fromCharCode(sourceCol.charCodeAt(0) + 1)}${row}`,
        fullNameCell: `${String.fromCharCode(sourceCol.charCodeAt(0) + 2)}${row}`,
        companyCell: `${String.fromCharCode(sourceCol.charCodeAt(0) + 3)}${row}`,
        linkedInSlugCell: `${String.fromCharCode(sourceCol.charCodeAt(0) + 4)}${row}`,
        destCell: `${destCol}${row}`,
        sheetId: sheet.getSheetId()
      });
    }

    return handleBatchProcessing(rows, range, sheet, scriptProperties, userEmail, 'pendingVerifiedEmailUpdates', runStats);
  } catch (error) {
    runStats.endTime = new Date().toISOString();
    saveRunHistory(userEmail, runStats);
    return `Error: ${error.message}`;
  }
}

/**
 * Process pending email updates
 */
function processPendingVerifiedEmailUpdates() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const updates = JSON.parse(scriptProperties.getProperty('pendingVerifiedEmailUpdates') || '{}');
  
  if (Object.keys(updates).length === 0) return;

  for (const updateKey in updates) {
    const update = updates[updateKey];
    if (update.processed) continue;

    const sheet = spreadsheet.getSheets().find(s => s.getSheetId() === update.rows[0].sheetId);
    if (!sheet) continue;

    const rowsToProcess = update.rows.slice(0, 10);
    rowsToProcess.forEach(row => {
      const inputs = {
        firstName: sheet.getRange(row.firstNameCell).getValue(),
        lastName: sheet.getRange(row.lastNameCell).getValue(),
        fullName: sheet.getRange(row.fullNameCell).getValue(),
        company: sheet.getRange(row.companyCell).getValue(),
        linkedInSlug: sheet.getRange(row.linkedInSlugCell).getValue()
      };

      const validation = validateInputs(validationSchema, inputs, row);
      if (!validation.isValid) {
        showAlert(validation.messages);
        return;
      }

      let attempts = 0;
      while (attempts <= SIDEBAR_MAX_RETRIES) {
        try {
          const apiId = "tuQscxhN";
          const apiUrl = `https://gateway.datagma.net/api/ingress/v8/findEmail?apiId=${apiId}&firstName=${encodeURIComponent(inputs.firstName)}&lastName=${encodeURIComponent(inputs.lastName)}&fullName=${encodeURIComponent(inputs.fullName)}&company=${encodeURIComponent(inputs.company)}&linkedInSlug=${encodeURIComponent(inputs.linkedInSlug)}`;
          
          const response = UrlFetchApp.fetch(apiUrl, {
            method: 'GET',
            headers: { accept: 'application/json' },
            muteHttpExceptions: true,
            timeoutInSeconds: API_TIMEOUT / 1000
          });

          if (response.getResponseCode() === 403) {
            throw new Error("Access denied: " + JSON.parse(response.getContentText()).message);
          }

          update.runStats.totalApiCalls++;
          update.runStats.successfulCalls++;
          update.runStats.totalRetries += attempts;

          const verifiedEmail = JSON.parse(response.getContentText()).email || "No verified email found";
          sheet.getRange(row.destCell).setValue(verifiedEmail);
          break;

        } catch (error) {
          attempts++;
          if (attempts <= SIDEBAR_MAX_RETRIES) {
            Utilities.sleep(RETRY_DELAY);
            continue;
          }
          update.runStats.totalApiCalls++;
          update.runStats.failedCalls++;
          sheet.getRange(row.destCell).setValue("Error: " + error.message);
        }
      }
    });

    update.rows.splice(0, 10);
    if (update.rows.length === 0) {
      update.runStats.endTime = new Date().toISOString();
      saveRunHistory(update.userEmail, update.runStats);
      sheet.getRange(updateKey.split('_')[1]).clearContent();
      update.processed = true;
    } else {
      update.remainingMinutes -= 1;
      sheet.getRange(updateKey.split('_')[1]).setValue(
        `Processing remaining rows. Approx ${update.remainingMinutes} min(s) left.`
      );
    }
  }

  scriptProperties.setProperty('pendingVerifiedEmailUpdates', 
    JSON.stringify(Object.fromEntries(Object.entries(updates).filter(([_, update]) => !update.processed)))
  );
}

/**
 * @customfunction
 */
function TEST(promptText, destCol, startRow, endRow) {
 const range = SpreadsheetApp.getActiveRange();
 const sheet = range.getSheet();
 const scriptProperties = PropertiesService.getScriptProperties();
 const userEmail = scriptProperties.getProperty('userEmail');

 if (!userEmail) return "Error: Please open sidebar first";

 const runStats = {
   functionName: "ComparisonTest", 
   startTime: new Date().toISOString(),
   totalApiCalls: 0,
   successfulCalls: 0,
   failedCalls: 0,
   totalRetries: 0,
   runName: `Test_${new Date().toISOString()}`
 };

 try {
   endRow = endRow || startRow;
   const colLetters = promptText.match(/\[([A-Z])\]/g);
   if (!colLetters || colLetters.length < 2) {
     return "Error: Not enough columns specified in the prompt.";
   }

   const promptCol = colLetters[0].replace(/[\[\]]/g, '');
   const websiteCol = colLetters[1].replace(/[\[\]]/g, '');

   const rows = [];
   for (let row = startRow; row <= endRow; row++) {
     rows.push({
       userPrompt: promptText,
       promptCell: `${promptCol}${row}`,
       websiteCell: `${websiteCol}${row}`,
       outputs: {
         gemini: `${destCol}${row}`,
         gpt4t: `${String.fromCharCode(destCol.charCodeAt(0) + 1)}${row}`,
         gpt4o: `${String.fromCharCode(destCol.charCodeAt(0) + 2)}${row}`,
         hyper: `${String.fromCharCode(destCol.charCodeAt(0) + 3)}${row}`
       },
       sheetId: sheet.getSheetId()
     });
   }

   return handleBatchProcessing(rows, range, sheet, scriptProperties, userEmail, 'pendingTestUpdates', runStats);
 } catch (error) {
   runStats.endTime = new Date().toISOString();
   saveRunHistory(userEmail, runStats);
   return `Error: ${error.message}`;
 }
}

function processPendingTestUpdates() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const updates = JSON.parse(scriptProperties.getProperty('pendingTestUpdates') || '{}');

  for (const [key, update] of Object.entries(updates)) {
    if (update.processed) continue;

    const sheet = spreadsheet.getSheets().find(s => s.getSheetId() === update.rows[0].sheetId);
    if (!sheet) continue;

    update.rows.forEach(row => {
      const inputs = {
        website: sheet.getRange(row.websiteCell).getValue(),
        prompt: sheet.getRange(row.promptCell).getValue()
      };

      const validation = validateInputs(validationSchema, inputs, {
        websiteCell: row.websiteCell,
        promptCell: row.promptCell
      });

      if (!validation.isValid) {
        showAlert(validation.messages);
        return;
      }

      const filledPrompt = row.userPrompt.replace(/\[([A-Z])\]/g, (match, col) => {
        return sheet.getRange(`${col}${row.promptCell.match(/\d+/)[0]}`).getValue();
      });

      try {
        const { response: geminiResponse, retries: geminiRetries } = callApiWithStats('gemini', filledPrompt, inputs.prompt, inputs.website);
        const { response: gpt4tResponse, retries: gpt4tRetries } = callApiWithStats('gpt4t', filledPrompt, inputs.prompt, inputs.website);
        const { response: gpt4oResponse, retries: gpt4oRetries } = callApiWithStats('gpt4o', filledPrompt, inputs.prompt, inputs.website);
        const { response: hyperResponse, retries: hyperRetries } = callApiWithStats('hyper', filledPrompt, inputs.prompt, inputs.website);

        update.runStats.totalApiCalls += 4;
        update.runStats.successfulCalls += 4;
        update.runStats.totalRetries += (geminiRetries + gpt4tRetries + gpt4oRetries + hyperRetries);

        sheet.getRange(row.outputs.gemini).setValue(geminiResponse);
        sheet.getRange(row.outputs.gpt4t).setValue(gpt4tResponse);
        sheet.getRange(row.outputs.gpt4o).setValue(gpt4oResponse);
        sheet.getRange(row.outputs.hyper).setValue(hyperResponse);
        
        Utilities.sleep(CONFIG.DELAY_MS);
      } catch (error) {
        update.runStats.totalApiCalls++;
        update.runStats.failedCalls++;
        Logger.log(`Error processing row: ${error.message}`);
      }
    });

    update.runStats.endTime = new Date().toISOString();
    saveRunHistory(update.userEmail, update.runStats);
    sheet.getRange(key).clearContent();
    update.processed = true;
  }

  scriptProperties.setProperty('pendingTestUpdates', JSON.stringify({}));
}

function callApiWithStats(type, userPrompt, prompt, website) {
 let response, retries = 0;

 switch(type) {
   case 'gemini':
     response = callGeminiAPI(userPrompt, prompt, website);
     break;
   case 'gpt4t':
     response = callOpenAI(userPrompt, prompt, website, 'gpt-3.5-turbo');
     break;
   case 'gpt4o':
     response = callOpenAI(userPrompt, prompt, website, 'gpt-4o-mini');
     break;
   case 'hyper':
     response = callHyperAPI(userPrompt, prompt, website);
     break;
 }

 return { response, retries };
}

function formatHyperResponse(result) {
 // Return raw JSON response
 return JSON.stringify(result, null, 2);
}

function callGeminiAPI(userPrompt, prompt, website) {
  const payload = {
    contents: [{
      parts: [{
        text: `Website: ${website}\nPrompt: ${prompt}. ${userPrompt}`
      }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1000
    }
  };

  let attempts = 0;
  while (attempts <= GEMINI_MAX_RETRIES) {
    try {
      const response = UrlFetchApp.fetch(GEMINI_API_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        timeoutInSeconds: API_TIMEOUT / 1000
      });

      const result = JSON.parse(response.getContentText());
      return result.candidates[0].content.parts[0].text;
    } catch (error) {
      attempts++;
      if (attempts <= GEMINI_MAX_RETRIES) {
        Logger.log(`API request attempt ${attempts} failed, retrying...`);
        Utilities.sleep(RETRY_DELAY);
        continue;
      }
      throw error;
    }
  }
}

function callOpenAI(userPrompt, prompt, website, model) {
  const payload = {
    model: model,
    messages: [{
      role: "user", 
      content: `Website: ${website}\nPrompt: ${prompt}. ${userPrompt}`
    }],
    store: true,
    temperature: 0.7
  };

  let attempts = 0;
  while (attempts <= GEMINI_MAX_RETRIES) {
    try {
      const response = UrlFetchApp.fetch(OPENAI_API_URL, {
        method: 'post',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
        timeoutInSeconds: API_TIMEOUT / 1000
      });

      const result = JSON.parse(response.getContentText());
      return result.choices ? result.choices[0].message.content : result;
    } catch (error) {
      attempts++;
      if (attempts <= GEMINI_MAX_RETRIES) {
        Logger.log(`API request attempt ${attempts} failed, retrying...`);
        Utilities.sleep(RETRY_DELAY);
        continue;
      }
      throw error;
    }
  }
}

function callHyperAPI(userPrompt, prompt, website) {
  const payload = {
    payload: [{ id: 1, website }],
    selected_keys: {
      company_name: true,
      industry: true,
      services: true,
      pain_points: true
    },
    External_dynamic_keys: {
      "Prompt Response": prompt + userPrompt
    },
    length: "medium",
    format: "json"
  };

  let attempts = 0;
  while (attempts <= GEMINI_MAX_RETRIES) {
    try {
      const response = UrlFetchApp.fetch(HYPER_API_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        timeoutInSeconds: API_TIMEOUT / 1000
      });

      const result = JSON.parse(response.getContentText());
      return Object.entries(result.results[0].result)
        .map(([key, value]) => {
          const valStr = Array.isArray(value) ? value.join(', ') : value;
          return `${key}: ${valStr}`;
        })
        .join('\n');
    } catch (error) {
      attempts++;
      if (attempts <= GEMINI_MAX_RETRIES) {
        Logger.log(`API request attempt ${attempts} failed, retrying...`);
        Utilities.sleep(RETRY_DELAY);
        continue;
      }
      throw error;
    }
  }
}


/**
 * Custom formula for finding LinkedIn URLs from websites
 * @param {string} sourceCol Column containing website URLs
 * @param {string} destCol Column where LinkedIn URLs should be written
 * @param {number} startRow Starting row number
 * @param {number} [endRow] Optional ending row number
 * @return {string} Status message
 * @customfunction
 */
function FIND_COMPANY_LINKEDIN(sourceCol, destCol, startRow, endRow) {
 const range = SpreadsheetApp.getActiveRange();
 const sheet = range.getSheet();
 const scriptProperties = PropertiesService.getScriptProperties();
 const userEmail = scriptProperties.getProperty('userEmail');

 if (!userEmail) return "Error: Unable to fetch user email. Please open the sidebar first.";

 const runStats = {
   functionName: "CompanyLinkedIn",
   startTime: new Date().toISOString(),
   totalApiCalls: 0,
   successfulCalls: 0,
   failedCalls: 0,
   totalRetries: 0,
   runName: `LinkedIn_${new Date().toISOString()}`
 };

 try {
   endRow = endRow || startRow;
   const rows = [];
   
   for (let row = startRow; row <= endRow; row++) {
     rows.push({ 
       sourceCell: `${sourceCol}${row}`, 
       destCell: `${destCol}${row}`,
       sheetId: sheet.getSheetId()
     });
   }

   return handleBatchProcessing(rows, range, sheet, scriptProperties, userEmail, 'pendingLinkedInUpdates', runStats);
 } catch (error) {
   runStats.endTime = new Date().toISOString();
   saveRunHistory(userEmail, runStats);
   return `Error: ${error.message}`;
 }
}

function findLinkedInUrls(website) {
 let totalRetries = 0;
 const domain = website.replace(/^https?:\/\//, '').replace(/\/$/, '');
 
 let attempts = 0;
 while (attempts <= SIDEBAR_MAX_RETRIES) {
   try {
     const hunterApiUrl = `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=f8e5244a4bf986d7a9ca204803c5240bc81877e9`;
     const hunterResponse = UrlFetchApp.fetch(hunterApiUrl, {
       timeoutInSeconds: API_TIMEOUT / 1000
     });
     const hunterData = JSON.parse(hunterResponse.getContentText());
     
     if (hunterData.data?.linkedin) {
       return { result: hunterData.data.linkedin, retries: totalRetries };
     }
     break;
   } catch (error) {
     attempts++;
     totalRetries++;
     if (attempts <= SIDEBAR_MAX_RETRIES) {
       Utilities.sleep(RETRY_DELAY);
       continue;
     }
   }
 }

 attempts = 0;
 while (attempts <= SIDEBAR_MAX_RETRIES) {
   try {
     const fullUrl = website.startsWith('http') ? website : `https://${website}`;
     const response = UrlFetchApp.fetch(fullUrl, {
       muteHttpExceptions: true,
       followRedirects: true,
       validateHttpsCertificates: false,
       timeoutInSeconds: API_TIMEOUT / 1000
     });
     
     const linkedInUrls = [];
     const patterns = [
       /https?:\/\/(www\.)?linkedin\.com\/company\/[^"\s<>)]+/g,
       /https?:\/\/(www\.)?linkedin\.com\/in\/[^"\s<>)]+/g
     ];
     
     patterns.forEach(pattern => {
       const matches = response.getContentText().match(pattern);
       if (matches) linkedInUrls.push(...matches);
     });
     
     return { 
       result: linkedInUrls.length ? [...new Set(linkedInUrls)].join('\n') : "No LinkedIn URLs found",
       retries: totalRetries 
     };
   } catch (error) {
     attempts++;
     totalRetries++;
     if (attempts <= SIDEBAR_MAX_RETRIES) {
       Utilities.sleep(RETRY_DELAY);
       continue;
     }
     return { result: `Error: Unable to process website`, retries: totalRetries };
   }
 }
}

function processPendingLinkedInUpdates() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const updates = JSON.parse(scriptProperties.getProperty('pendingLinkedInUpdates') || '{}');
  
  if (Object.keys(updates).length === 0) return;

  for (const updateKey in updates) {
    const update = updates[updateKey];
    if (update.processed) continue;

    const sheet = spreadsheet.getSheets().find(s => s.getSheetId() === update.rows[0].sheetId);
    if (!sheet) continue;

    const rowsToProcess = update.rows.slice(0, CONFIG.BATCH_SIZE);
    const validationErrors = [];
    const validRows = [];

    rowsToProcess.forEach(row => {
      const inputs = {
        website: sheet.getRange(row.sourceCell).getValue()
      };

      const validation = validateInputs(validationSchema, inputs, {
        websiteCell: row.sourceCell
      });

      if (!validation.isValid) {
        validationErrors.push(...validation.messages);
      } else {
        validRows.push(row);
      }
    });

    if (validationErrors.length > 0) {
      showAlert(validationErrors);
    }

    if (validRows.length === 0) {
      sheet.getRange(updateKey.split('_')[1]).setValue('No valid rows to process');
      continue;
    }

    sheet.getRange(updateKey.split('_')[1]).setValue(
      `Processing ${validRows.length} valid row(s)...`
    );

    validRows.forEach(row => {
      const website = sheet.getRange(row.sourceCell).getValue();

      try {
        const { result, retries } = findLinkedInUrls(website);
        update.runStats.totalApiCalls++;
        update.runStats.totalRetries += retries;
        update.runStats.successfulCalls++;

        const destRange = sheet.getRange(row.destCell);
        destRange.setWrap(true);
        destRange.setValue(result);
      } catch (error) {
        update.runStats.totalApiCalls++;
        update.runStats.failedCalls++;
        sheet.getRange(row.destCell).setValue("Error finding LinkedIn URLs");
      }
      Utilities.sleep(CONFIG.DELAY_MS);
    });

    update.rows.splice(0, CONFIG.BATCH_SIZE);
    if (update.rows.length === 0) {
      update.runStats.endTime = new Date().toISOString();
      saveRunHistory(update.userEmail, update.runStats);
      sheet.getRange(updateKey.split('_')[1]).clearContent();
      update.processed = true;
    } else {
      update.remainingMinutes -= 1;
      sheet.getRange(updateKey.split('_')[1]).setValue(
        `Processing remaining ${update.rows.length} row(s). Approx ${update.remainingMinutes} min(s) left.`
      );
    }
  }

  scriptProperties.setProperty('pendingLinkedInUpdates', 
    JSON.stringify(Object.fromEntries(Object.entries(updates).filter(([_, update]) => !update.processed)))
  );
}

function clearPendingUpdates() {
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.deleteProperty('pendingContentUpdates');
}

/**
 * Custom formula that retrieves email addresses associated with input domains
 * @param {string} sourceCol The column with input URLs
 * @param {string} destCol The column to output emails
 * @param {number} startRow Starting row number
 * @param {number} [endRow] Optional ending row number
 * @return {string} Loading message with estimated time
 * @customfunction
 */
function FIND_EMAIL(sourceCol, destCol, startRow, endRow) {
 const range = SpreadsheetApp.getActiveRange();
 const sheet = range.getSheet();
 const scriptProperties = PropertiesService.getScriptProperties();
 const userEmail = scriptProperties.getProperty('userEmail');

 if (!userEmail) return "Error: Unable to fetch user email. Please open the sidebar first.";

 const runStats = {
   functionName: "EmailFinder",
   startTime: new Date().toISOString(),
   totalApiCalls: 0,
   successfulCalls: 0,
   failedCalls: 0,
   totalRetries: 0,
   runName: `Email_${new Date().toISOString()}`
 };

 try {
   endRow = endRow || startRow;
   const rows = [];
   for (let row = startRow; row <= endRow; row++) {
     rows.push({ 
       sourceCell: `${sourceCol}${row}`,
       destCell: `${destCol}${row}`,
       sheetId: sheet.getSheetId()
     });
   }

   return handleBatchProcessing(rows, range, sheet, scriptProperties, userEmail, 'pendingEmailUpdates', runStats);
 } catch (error) {
   runStats.endTime = new Date().toISOString();
   saveRunHistory(userEmail, runStats);
   return `Error: ${error.message}`;
 }
}

function processPendingEmailUpdates() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const updates = JSON.parse(scriptProperties.getProperty('pendingEmailUpdates') || '{}');
  
  if (Object.keys(updates).length === 0) return;

  for (const updateKey in updates) {
    const update = updates[updateKey];
    if (update.processed) continue;

    const sheet = spreadsheet.getSheets().find(s => s.getSheetId() === update.rows[0].sheetId);
    if (!sheet) continue;

    const rowsToProcess = update.rows.slice(0, CONFIG.BATCH_SIZE);
    const validationErrors = [];
    const validRows = [];

    rowsToProcess.forEach(row => {
      const inputs = {
        website: sheet.getRange(row.sourceCell).getValue()
      };

      const validation = validateInputs(validationSchema, inputs, {
        websiteCell: row.sourceCell
      });

      if (!validation.isValid) {
        validationErrors.push(...validation.messages);
      } else {
        validRows.push(row);
      }
    });

    if (validationErrors.length > 0) {
      showAlert(validationErrors);
    }

    if (validRows.length === 0) {
      sheet.getRange(updateKey.split('_')[1]).setValue('No valid rows to process');
      continue;
    }

    sheet.getRange(updateKey.split('_')[1]).setValue(
      `Processing ${validRows.length} valid row(s)...`
    );

    validRows.forEach(row => {
      const domain = sheet.getRange(row.sourceCell).getValue();
      let attempts = 0;

      while (attempts <= SIDEBAR_MAX_RETRIES) {
        try {
          const apiUrl = `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=f8e5244a4bf986d7a9ca204803c5240bc81877e9`;
          const response = UrlFetchApp.fetch(apiUrl, {
            muteHttpExceptions: true,
            timeoutInSeconds: API_TIMEOUT / 1000
          });
          
          if (response.getResponseCode() !== 200) {
            throw new Error(`API returned status ${response.getResponseCode()}`);
          }
          
          update.runStats.totalApiCalls++;
          update.runStats.successfulCalls++;
          update.runStats.totalRetries += attempts;
          
          const data = JSON.parse(response.getContentText());
          const email = data.data.emails.length > 0 ? data.data.emails[0].value : "No emails";
          sheet.getRange(row.destCell).setValue(email);
          break;

        } catch (error) {
          attempts++;
          if (attempts <= SIDEBAR_MAX_RETRIES) {
            Utilities.sleep(RETRY_DELAY);
            continue;
          }
          update.runStats.totalApiCalls++;
          update.runStats.failedCalls++;
          sheet.getRange(row.destCell).setValue("Error fetching data");
        }
      }
    });

    update.rows.splice(0, CONFIG.BATCH_SIZE);
    if (update.rows.length === 0) {
      update.runStats.endTime = new Date().toISOString();
      saveRunHistory(update.userEmail, update.runStats);
      sheet.getRange(updateKey.split('_')[1]).clearContent();
      update.processed = true;
    } else {
      update.remainingMinutes -= 1;
      sheet.getRange(updateKey.split('_')[1]).setValue(
        `Processing remaining ${update.rows.length} row(s). Approx ${update.remainingMinutes} min(s) left.`
      );
    }
  }

  scriptProperties.setProperty('pendingEmailUpdates', 
    JSON.stringify(Object.fromEntries(Object.entries(updates).filter(([_, update]) => !update.processed)))
  );
}

/**
 * Deduct user credits
 */
function deductUserCredits(userEmail, usedCredits) {
  const userUrl = `https://firestore.googleapis.com/v1/projects/sheetusermanagement/databases/(default)/documents/users/${encodeURIComponent(userEmail)}`;
  const currentCredits = getUserCredits(userEmail);

  const newCredits = Math.max(0, currentCredits - usedCredits);
  const payload = {
    fields: {
      credits: { integerValue: newCredits },
    },
  };

  const options = {
    method: 'PATCH',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  UrlFetchApp.fetch(userUrl, options);
}

/**
 * Get user credits
 */
function getUserCredits(userEmail) {
  const userUrl = `https://firestore.googleapis.com/v1/projects/sheetusermanagement/databases/(default)/documents/users/${encodeURIComponent(userEmail)}`;
  const response = UrlFetchApp.fetch(userUrl, { method: 'get', muteHttpExceptions: true });

  if (response.getResponseCode() === 200) {
    const userData = JSON.parse(response.getContentText());
    return parseInt(userData.fields.credits.integerValue, 10);
  }

  return 0;
}

/**
 * Updated createEditTrigger to handle all updates on edit event
 */
function createEditTrigger() {
  const functions = [
    'processPendingEmailUpdates',
    'processPendingVerifiedEmailUpdates',
    'processPendingLinkedInUpdates',
    'processPendingTestUpdates',
    'genProcessContentBatch',
    'genProcessIcebreakBatch',
    'genProcessPostBatch',
    'genProcessSummaryBatch',
    'genProcessIndustryBatch'
  ];

  // Remove existing triggers
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (functions.includes(trigger.getHandlerFunction())) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  // Create onEdit triggers
  functions.forEach(func => {
    ScriptApp.newTrigger(func)
      .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
      .onEdit()
      .create();
  });
}
