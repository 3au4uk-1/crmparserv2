import { google } from 'googleapis';
import { config } from '../config.js';

export function getPrintSheetClient() {
  if (!config.googleServiceAccountEmail || !config.googleServiceAccountPrivateKey) {
    return null;
  }
  const auth = new google.auth.JWT({
    email: config.googleServiceAccountEmail,
    key: config.googleServiceAccountPrivateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}
