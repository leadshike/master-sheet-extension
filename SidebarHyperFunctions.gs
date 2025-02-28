function logToSheet(message) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  const timestamp = new Date().toLocaleString();
  sheet.getRange(lastRow + 1, 1).setValue(`[${timestamp}] ${message}`);
}

function callHyperRecipe(recipe, description, websiteColRef, outputColRef, startRow, endRow) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const scriptProperties = PropertiesService.getScriptProperties();
  const userEmail = scriptProperties.getProperty('userEmail');

  console.log(`Starting new processing run from row ${startRow} to ${endRow}`);
  console.log(`Recipe: ${recipe}, Description: ${description}`);

  if (!userEmail) {
    console.log("Error: User email not found. Please open sidebar first");
    return "Error: Please open sidebar first";
  }

  const runStats = {
    functionName: "HyperRecipe",
    startTime: new Date().toISOString(),
    totalApiCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    totalRetries: 0,
    runName: `${recipe}_${new Date().toISOString()}`
  };

  try {
    endRow = endRow || startRow;
    const websiteCol = websiteColRef.replace(/[0-9]/g, '');
    const outputCol = outputColRef.replace(/[0-9]/g, '');

    let totalBatches = Math.ceil((endRow - startRow + 1) / SIDEBAR_MAX_API_CALLS_PER_BATCH);
    console.log(`Total batches to process: ${totalBatches}`);

    // Process rows in batches
    for (let batchStart = startRow; batchStart <= endRow; batchStart += SIDEBAR_MAX_API_CALLS_PER_BATCH) {
      const batchEnd = Math.min(batchStart + SIDEBAR_MAX_API_CALLS_PER_BATCH - 1, endRow);
      const batchStartTime = new Date().getTime();
      const currentBatch = Math.ceil((batchStart - startRow + 1) / SIDEBAR_MAX_API_CALLS_PER_BATCH);
      
      console.log(`Starting Batch ${currentBatch}/${totalBatches} (Rows ${batchStart}-${batchEnd})`);
      
      // Process each row in the current batch
      for (let currentRow = batchStart; currentRow <= batchEnd; currentRow++) {
        const websiteValue = sheet.getRange(`${websiteCol}${currentRow}`).getValue();
        
        if (!websiteValue) {
          console.log(`Row ${currentRow}: Skipping empty website value`);
          continue;
        }

        console.log(`Row ${currentRow}: Processing website: ${websiteValue}`);
        
        try {
          const startTime = new Date().getTime();
          const { result, retries } = callHyperAPIWithStats(websiteValue, recipe, description);
          const endTime = new Date().getTime();
          
          sheet.getRange(`${outputCol}${currentRow}`).setValue(result);
          
          runStats.totalApiCalls++;
          runStats.totalRetries += retries;
          runStats.successfulCalls++;

          console.log(`Row ${currentRow}: Success - Took ${(endTime - startTime)/1000}s with ${retries} retries`);
          
        } catch (error) {
          runStats.totalApiCalls++;
          runStats.failedCalls++;
          sheet.getRange(`${outputCol}${currentRow}`).setValue(`Error: ${error.message}`);
          console.log(`Row ${currentRow}: Failed - ${error.message}`);
        }
      }

      // After processing batch, wait if needed
      const batchEndTime = new Date().getTime();
      const batchDuration = batchEndTime - batchStartTime;
      
      console.log(`Batch ${currentBatch} completed in ${batchDuration/1000}s`);
      
      // If there are more rows to process and batch took less than 10 seconds
      if (batchEnd < endRow && batchDuration < BATCH_WINDOW) {
        const waitTime = BATCH_WINDOW - batchDuration;
        console.log(`Waiting ${waitTime/1000}s before next batch`);
        Utilities.sleep(waitTime);
      }
    }

    runStats.endTime = new Date().toISOString();
    saveRunHistory(userEmail, runStats);
    
    const totalDuration = (new Date(runStats.endTime) - new Date(runStats.startTime)) / 1000;
    console.log(`Run completed in ${totalDuration}s`);
    console.log(`Final stats: ${runStats.successfulCalls} successful, ${runStats.failedCalls} failed, ${runStats.totalRetries} total retries`);
    
    return "Success: Processing completed";

  } catch (error) {
    runStats.endTime = new Date().toISOString();
    saveRunHistory(userEmail, runStats);
    console.log(`Fatal error: ${error.message}`);
    return `Error: ${error.message}`;
  }
}

function callHyperAPIWithStats(website, recipe, description) {
  let retries = 0;
  const payload = {
    payload: [{ id: 1, website }],
    selected_keys: {
      company_name: true,
      industry: true,
      services: true,
      pain_points: true
    },
    External_dynamic_keys: { [recipe]: description },
    length: "medium",
    format: "json"
  };

  while (retries <= SIDEBAR_MAX_RETRIES) {
    try {
      const apiStartTime = new Date().getTime();
      
      const response = UrlFetchApp.fetch(HYPER_API_URL, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
        timeoutInSeconds: 30
      });

      const apiEndTime = new Date().getTime();
      console.log(`API call took ${(apiEndTime - apiStartTime)/1000}s`);

      if (response.getResponseCode() !== 200) {
        throw new Error(`API returned status ${response.getResponseCode()}`);
      }

      const result = JSON.parse(response.getContentText());
      if (result?.results?.[0]?.result === "Unable to parse website") {
        return { result: "Error: Invalid website format or URL", retries };
      }

      return { result: formatHyperResponse(result), retries };

    } catch (error) {
      retries++;
      if (retries <= SIDEBAR_MAX_RETRIES) {
        console.log(`API call failed, retry ${retries}/${SIDEBAR_MAX_RETRIES}`);
        Utilities.sleep(1000);
        continue;
      }
      throw error;
    }
  }
}
  /**
   * Format Hyper API response
   */
  function formatHyperResponse(result) {
    const response = result.results[0].result;
    return Object.entries(response)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('\n');
  }

/**
 * Generate multiple dynamic prompts
 */
function generateMultipleDynamicPrompts(prompt, tone, modal, apiKey, destinationCol, startRow, endRow) {
 const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
 const scriptProperties = PropertiesService.getScriptProperties();
 const userEmail = scriptProperties.getProperty('userEmail');

 if (!userEmail) return "Error: Please open sidebar first";

 const runStats = {
   functionName: "DynamicPrompts",
   startTime: new Date().toISOString(),
   totalApiCalls: 0,
   successfulCalls: 0, 
   failedCalls: 0,
   totalRetries: 0,
   runName: `${modal}_${new Date().toISOString()}`
 };

 try {
   const sourceCols = [...prompt.matchAll(/\[(.*?)\]/g)].map(match => match[1]);
   endRow = endRow || startRow;

   // Validate API key first with first row
   const firstRowValues = sourceCols.map(col => sheet.getRange(`${col}${startRow}`).getValue());
   try {
     callAPIWithRetry(modal, prompt, tone, firstRowValues, apiKey);
   } catch (error) {
     return `Error: ${error.message}`;
   }

   let hasErrors = false;

   for (let batchStart = startRow; batchStart <= endRow; batchStart += SIDEBAR_MAX_API_CALLS_PER_BATCH) {
     const batchEnd = Math.min(batchStart + SIDEBAR_MAX_API_CALLS_PER_BATCH - 1, endRow);
     const batchStartTime = new Date().getTime();

     for (let currentRow = batchStart; currentRow <= batchEnd; currentRow++) {
       try {
         const inputValues = sourceCols.map(col => sheet.getRange(`${col}${currentRow}`).getValue());
         const { response, retries } = callAPIWithRetry(modal, prompt, tone, inputValues, apiKey);

         sheet.getRange(`${destinationCol}${currentRow}`).setValue(response);
         runStats.totalApiCalls++;
         runStats.successfulCalls++;
         runStats.totalRetries += retries;

       } catch (error) {
         hasErrors = true;
         runStats.totalApiCalls++;
         runStats.failedCalls++;
         sheet.getRange(`${destinationCol}${currentRow}`).setValue(`Error: ${error.message}`);
       }
     }

     const batchDuration = new Date().getTime() - batchStartTime;
     if (batchEnd < endRow && batchDuration < BATCH_WINDOW) {
       Utilities.sleep(BATCH_WINDOW - batchDuration);
     }
   }

   runStats.endTime = new Date().toISOString();
   saveRunHistory(userEmail, runStats);

   if (hasErrors) {
     return `Error: Some rows failed to process. Check spreadsheet for details.`;
   }
   return runStats.successfulCalls > 0 ? 
     `Success: Processed ${runStats.successfulCalls} rows` : 
     `Error: No rows were processed successfully`;

 } catch (error) {
   runStats.endTime = new Date().toISOString();
   saveRunHistory(userEmail, runStats);
   return `Error: ${error.message}`;
 }
}

function callAPIWithRetry(modal, prompt, tone, inputValues, apiKey) {
  let retries = 0;
  let lastError;

  while (retries <= SIDEBAR_MAX_RETRIES) {
    try {
      console.log(`API call attempt ${retries + 1} for modal: ${modal}`);
      const apiStartTime = new Date().getTime();
      
      const response = getApiResponse(modal, prompt, tone, inputValues, apiKey);
      
      const apiEndTime = new Date().getTime();
      console.log(`API call successful, took ${(apiEndTime - apiStartTime)/1000}s`);
      
      return { response, retries };
    } catch (error) {
      lastError = error;
      retries++;
      if (retries <= SIDEBAR_MAX_RETRIES) {
        console.log(`API call failed, retry ${retries}/${SIDEBAR_MAX_RETRIES}`);
        Utilities.sleep(1000);
        continue;
      }
    }
  }
  throw lastError;
}

/**
 * Get API response based on selected modal
 */
function getApiResponse(modal, prompt, tone, inputValues, apiKey) {
  switch (modal) {
    case "Gemini 1.5 flash":
      return callGeminiDynamic(prompt, tone, inputValues, apiKey);
    case "Open AI gpt-3.5-turbo":
      return callOpenAIDynamic(prompt, tone, 'gpt-3.5-turbo', inputValues, apiKey);
    case "Open AI gpt-4o-mini":
      return callOpenAIDynamic(prompt, tone, 'gpt-4o-mini', inputValues, apiKey);
    case "DeepSeek":
      return callDeepSeekDynamic(prompt, tone, inputValues, apiKey);
    case "Hyper modal":
      return callHyperModalDynamic(prompt, tone, inputValues);
    default:
      throw new Error(`Unsupported modal: ${modal}`);
  }
}

/**
 * Call DeepSeek API
 */
function callDeepSeekDynamic(prompt, tone, input = [], apiKey) {
  try {
    const payload = {
      model: "deepseek-chat",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant. Please respond in a ${tone} tone.`
        },
        {
          role: "user",
          content: `${prompt}${input.length > 0 ? `\nInput: ${input.join(', ')}` : ''}`
        }
      ],
      stream: false,
      temperature: 0.7
    };

    const response = UrlFetchApp.fetch('https://api.deepseek.com/chat/completions', {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeoutInSeconds: 30
    });

    const result = JSON.parse(response.getContentText());

    if (result.error) {
      if (result.error.type === "invalid_request_error" && result.error.code === "invalid_api_key") {
        throw new Error("Invalid DeepSeek API key. Please provide a valid API key.");
      }
      throw new Error(result.error.message);
    }

    return result?.choices?.[0]?.message?.content || 'No response found';

  } catch (error) {
    throw new Error(`DeepSeek API error: ${error.message}`);
  }
}

/**
 * Call Gemini API
 */
function callGeminiDynamic(prompt, tone, input = [], apiKey) {
  try {
    const payload = {
      contents: [{
        parts: [{
          text: `Prompt: ${prompt}\nTone: ${tone}${input.length > 0 ? `\nInput: ${input.join(', ')}` : ''}`
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1000
      }
    };

    const response = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeoutInSeconds: 30
    });

    const result = JSON.parse(response.getContentText());

    if (result.error) {
      if (result.error.status === "INVALID_ARGUMENT" && result.error.details?.some(d => d.reason === "API_KEY_INVALID")) {
        throw new Error("Invalid Gemini API key. Please provide a valid API key.");
      }
      throw new Error(result.error.message);
    }

    return result?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response found';

  } catch (error) {
    throw new Error(`Gemini API error: ${error.message}`);
  }
}



/**
 * Call OpenAI API
 */
function callOpenAIDynamic(prompt, tone, model, input = [], apiKey) {
  try {
    const payload = {
      model: model,
      messages: [{
        role: "user",
        content: `Prompt: ${prompt}${input.length > 0 ? `\nDescription: ${input.join(', ')}` : ''}\nTone: ${tone}`
      }],
      temperature: 0.7
    };

    const response = UrlFetchApp.fetch(OPENAI_API_URL, {
      method: 'post',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeoutInSeconds: 30
    });

    const result = JSON.parse(response.getContentText());

    if (result.error) {
      if (result.error.code === "invalid_api_key") {
        throw new Error("Invalid OpenAI API key. Please provide a valid API key.");
      }
      throw new Error(result.error.message);
    }

    return result?.choices?.[0]?.message?.content || 'No response found';

  } catch (error) {
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}


/**
 * Call Hyper Modal API
 */
function callHyperModalDynamic(prompt, tone, input = []) {
  try {
    const payload = {
      ...(input.length > 0 && { payload: [{ id: 1, website: input[0] }] }),
      selected_keys: {
        company_name: true,
        industry: true,
        services: true,
        pain_points: true
      },
      External_dynamic_keys: {
        "Custom Response": prompt
      },
      length: "medium",
      format: "json"
    };

    const response = UrlFetchApp.fetch(HYPER_API_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeoutInSeconds: 30
    });

    if (response.getResponseCode() !== 200) {
      throw new Error(`API returned status ${response.getResponseCode()}`);
    }

    const result = JSON.parse(response.getContentText());
    return formatHyperResponse(result);

  } catch (error) {
    throw new Error(`Hyper Modal API error: ${error.message}`);
  }
}
