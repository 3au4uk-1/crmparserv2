import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadPrintSheetDepartmentMap() {
  const envJson = process.env.PRINT_SHEET_DEPARTMENT_MAP || '';
  if (envJson.trim()) {
    try {
      return JSON.parse(envJson);
    } catch {
      console.warn('[config] Invalid PRINT_SHEET_DEPARTMENT_MAP JSON, using file fallback');
    }
  }
  const filePath = path.join(__dirname, '../config/print-sheet-departments.json');
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}
// Repo-root .env (local dev: npm run dev from backend/) then cwd fallback (Docker: /app)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  crmBaseUrl: process.env.CRM_BASE_URL || 'https://apihide.com/bitrix/calendar/',
  crmLogin: process.env.CRM_LOGIN || '',
  crmPassword: process.env.CRM_PASSWORD || '',
  tonyBaseUrl: process.env.TONY_BASE_URL || 'https://crm.apihide.com',
  tonyLogin: process.env.TONY_LOGIN || '',
  tonyPassword: process.env.TONY_PASSWORD || '',
  tonyRequestDelayMs: parseInt(process.env.TONY_REQUEST_DELAY_MS || '350', 10),
  fetchConcurrency: parseInt(process.env.FETCH_CONCURRENCY || '4', 10),
  parsePipeline: process.env.PARSE_PIPELINE || 'parallel',
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
  importApiSecret: process.env.IMPORT_API_SECRET || '',
  twentyAppApiSecret: process.env.TWENTY_APP_API_SECRET || '',
  twentyAppCorsOrigin: process.env.TWENTY_APP_CORS_ORIGIN || '',
  dbPath: process.env.DB_PATH || './data/crmparser.db',
  printSheetId: process.env.PRINT_SHEET_ID || '',
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  googleServiceAccountPrivateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  printSheetCacheTtlMs: parseInt(process.env.PRINT_SHEET_CACHE_TTL_MS || '60000', 10),
  printSheetDepartmentMap: loadPrintSheetDepartmentMap(),
};
