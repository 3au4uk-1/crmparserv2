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
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret',
  dbPath: process.env.DB_PATH || './data/crmparser.db',
};
