// Constants.gs

// Add your Gemini API key here
const GEMINI_API_KEY = 'AIzaSyBd-1JcjN9eJWPL1h9cVWvsSLwEQK6XOYw';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const OPENAI_API_KEY = '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';
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const HYPER_API_URL = 'http://api.hyperpersonalization.ai/ai_web_search';
const DEEPSEEK_API_KEY = 'sk-be0a605b871342929fb64b94803bbff0'

const SIDEBAR_MAX_API_CALLS_PER_BATCH = 15;  // Increased to 15 calls per batch
const SIDEBAR_MAX_RETRIES = 3;

const GEMINI_MAX_API_CALLS_PER_MINUTE = 10;  // Adjusted to match new rate (15 calls/10sec = 90 calls/minute)
const GEMINI_MAX_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds
const BATCH_WINDOW = 10000; // Keep 10 second window
const RETRIES_WINDOW = 900000 // 900 sec/ 15mins
const API_TIMEOUT = 30000; // 30 seconds

const FIRESTORE_BASE_URL = 'https://firestore.googleapis.com/v1/projects/sheetusermanagement/databases/(default)/documents';
const DEFAULT_CREDITS = 50;
const MENU_TITLE = 'My Extension';
const SIDEBAR_TITLE = 'Master Sheet Extension';
const SIDEBAR_WIDTH = 1000;


const CONFIG = {
  BATCH_SIZE: 10,
  DELAY_MS: 1000,
  API_SETTINGS: {
    DEFAULT_TEMP: 0.7,
    BLOG_TOKENS: 1000,
    SOCIAL_TOKENS: 500,
    PROFILE_TOKENS: 250,
    ICEBREAK_TOKENS: 300,
    INDUSTRY_TOKENS: 100,
  }
};

// API Configuration Values
const API_CONFIG = {
  BATCH_SIZE: 10,
  MAX_RETRIES: 3,
  RETRY_DELAY: 900000,
  ERROR_CLEANUP_TIME: 5000,
  BATCH_DELAY: 10000,
  API_SETTINGS: {
    temperature: 0.7,
    maxTokens: 1000
  }
};

// Templates for different content types
const PROMPT_TEMPLATES = {
  POST: `Create a social media post about topic.Include these keywords naturally. Format as a concise, engaging post with relevant hashtags.Keep it platform-agnostic and under 280 characters.`,

  CONTENT: `Create a content based on topic, keywords, tone and style social media post about topic. Include these keywords naturally. Format as a concise, engaging post with relevant hashtags. Keep it platform-agnostic and under 280 characters.`,

  PROFILE: {
    template: (linkedinUrl, userPrompt) =>
      `Given this LinkedIn profile URL: ${linkedinUrl}
       Create a concise professional summary of 2-3 sentences highlighting key professional 
       characteristics, expertise areas, and notable achievements. ${userPrompt}`,
    maxTokens: CONFIG.API_SETTINGS.PROFILE_TOKENS,
  },

  ICEBREAKER: `Based on this person's description below, generate exactly 2 different engaging ice breaker 
       questions that would start meaningful professional conversations. Make them specific to 
       their experience and interests. Keep each question concise and conversational.
      Description: `,

  INDUSTRY: `Based on the domain name, provide the company's industry and a brief description.Format your response exactly as: Industry: [single word or short phrase] | Description: [one brief sentence]"`,

  SUMMARY: `Create a summary of this content. Keep it under at max of 2 sentence.`,
};

const ERROR_MESSAGES = {
  NO_EMAIL: "Error: Unable to fetch user email. Please open the sidebar first.",
  NO_START_ROW: "Error: Invalid start row",
  INVALID_COLUMNS: "Error: Not enough columns specified in the prompt.",
  NO_CREDITS: "We can't process your cells because of insufficient credits.",
  SHEET_NOT_FOUND: "Error: Sheet not found",
  INVALID_URL: "Error: Invalid URL format",
  API_ERROR: "Error: API request failed",
  FETCH_USER: 'Error occurred while fetching user data. Please try again.',
 REGISTER_USER: 'Error registering user:',
 UPDATE_HEADERS: 'Error updating headers:',
 SAVE_HISTORY: 'Error saving run history:',
 SAVE_FORMULA: 'Error saving custom formula:',
 SAVE_RECIPE: 'Error saving custom recipe:',
 FETCH_RECIPES: 'Error fetching custom recipes:',
 FETCH_FORMULAS: 'Error fetching custom formulas:'
};

const validationSchema = {
  firstName: {
    required: true,
    validate: (value) => /^[A-Za-z\s-']{2,50}$/.test(value.trim()),
    message: (cell) => `Invalid first name format at ${cell}. Must be 2-50 characters, letters only.`
  },
  lastName: {
    required: true,
    validate: (value) => /^[A-Za-z\s-']{2,50}$/.test(value.trim()),
    message: (cell) => `Invalid last name format at ${cell}. Must be 2-50 characters, letters only.`
  },
  fullName: {
    required: true,
    validate: (value) => /^[A-Za-z\s-']{2,100}$/.test(value.trim()),
    message: (cell) => `Invalid full name format at ${cell}. Must be 2-100 characters, letters only.`
  },
  company: {
    required: true,
    validate: (value) => /^[\w\s-'&,.]{2,100}$/.test(value),
    message: (cell) => `Invalid company name format at ${cell}. Must be 2-100 characters.`
  },
  linkedInSlug: {
    required: true,
    validate: (value) => /^https:\/\/(www\.)?linkedin\.com\/(in|company)\/[a-zA-Z0-9-]{3,100}\/?$/.test(value),
    message: (cell) => `Invalid LinkedIn URL at ${cell}. Must be a valid profile or company URL (e.g., "https://www.linkedin.com/in/slug" or "https://www.linkedin.com/company/slug").`
  },
  website: {
    required: true,
    validate: (value) => /^(https?:\/\/)?([\w-]+(\.[\w-]+)+\/?)([\w.,@?^=%&:/~+#-]*[\w@?^=%&/~+#-])?$/.test(value),
    message: (cell) => `Invalid website URL format at ${cell}. Must be a valid domain.`
  },
  prompt: {
    required: true,
    validate: (value) => value.length >= 10 && value.length <= 1000,
    message: (cell) => `Invalid prompt at ${cell}. Must be between 10 and 1000 characters.`
  },
  contentString: {
   required: true,
   validate: (value) => /^[\w\s-'&,.]{3,100}$/.test(value),
   message: (cell) => `Invalid format at ${cell}. Must be between 3 and 100 characters.`
  },
 topic: {
    required: true,
    validate: (value) => value && value.toString().length >= 10 && value.toString().length <= 1000,
    message: (cell) => `Invalid topic at ${cell}. Must be between 10 and 1000 characters.`
  },
  keywords: {
    required: true,
    validate: (value) => value && value.toString().length >= 5 && value.toString().length <= 1000,
    message: (cell) => `Invalid keywords at ${cell}. Must be between 5 and 1000 characters.`
  },
  tone: {
    required: true,
    validate: (value) => value && value.toString().length >= 3 && value.toString().length <= 1000,
    message: (cell) => `Invalid tone at ${cell}. Must be between 3 and 1000 characters.`
  },
  style: {
    required: true,
    validate: (value) => value && value.toString().length >= 3 && value.toString().length <= 1000,
    message: (cell) => `Invalid style at ${cell}. Must be between 3 and 1000 characters.`
  }

};
