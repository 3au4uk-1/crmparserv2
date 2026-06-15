import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  crmBaseUrl: process.env.CRM_BASE_URL || 'https://apihide.com/bitrix/calendar/',
  crmLogin: process.env.CRM_LOGIN || '',
  crmPassword: process.env.CRM_PASSWORD || '',
  llmApiUrl: process.env.LLM_API_URL || '',
  llmApiKey: process.env.LLM_API_KEY || '',
  llmModel: process.env.LLM_MODEL || '',
  twentyApiUrl: process.env.TWENTY_API_URL || '',
  twentyApiToken: process.env.TWENTY_API_TOKEN || '',
  twentyApiTimeoutMs: parseInt(process.env.TWENTY_API_TIMEOUT_MS || '60000', 10),
  twentyApiRateLimitMax: parseInt(process.env.TWENTY_API_RATE_LIMIT_MAX || '95', 10),
  twentyApiRateLimitWindowMs: parseInt(process.env.TWENTY_API_RATE_LIMIT_WINDOW_MS || '60000', 10),
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  appPassword: process.env.APP_PASSWORD || '',
  dbPath: process.env.DB_PATH || './data/crmparser.db',
  printSheetId: process.env.PRINT_SHEET_ID || '',
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  googleServiceAccountPrivateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  printSheetCacheTtlMs: parseInt(process.env.PRINT_SHEET_CACHE_TTL_MS || '60000', 10),
};
