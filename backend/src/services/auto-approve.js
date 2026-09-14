import { getDb } from '../db/connection.js';
import { loadBlacklist } from './blacklist.js';
import { getItemsForTwenty } from './twenty-items.js';

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

/**
 * Whether a pending deal should be auto-synced. LLM classifications are ignored —
 * only keyword_match and manual include count toward auto-approval.
 */
export function shouldAutoApproveDeal(items, blacklist, mode) {
  const eligible = getItemsForTwenty(items, blacklist);
  if (eligible.length === 0) return false;

  const hasKeywordMatch = eligible.some((item) => item.classification === 'keyword_match');
  const hasManualInclude = eligible.some((item) => item.sync_override === 'include');

  if (mode === 'semi') return hasKeywordMatch;
  if (mode === 'auto') return hasKeywordMatch || hasManualInclude;
  return false;
}

export function collectAutoApproveDealIds() {
  const mode = getSetting('approval_mode');
  if (mode !== 'auto' && mode !== 'semi') return [];
  const db = getDb();
  const blacklist = loadBlacklist(db);
  const pending = db.prepare("SELECT id FROM deals WHERE approval_status = 'pending'").all();
  const ids = [];
  for (const { id } of pending) {
    const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(id);
    if (shouldAutoApproveDeal(items, blacklist, mode)) ids.push(id);
  }
  return ids;
}

export function processAutoApprovals() {
  const mode = getSetting('approval_mode');
  const dealIds = collectAutoApproveDealIds();
  return {
    mode,
    processed: 0,
    synced: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    dealIds,
  };
}
