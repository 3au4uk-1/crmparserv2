import { getDb } from '../db/connection.js';
import { loadBlacklist } from './blacklist.js';
import { getItemsForTwenty } from './twenty-items.js';
import { syncDealToTwenty } from './twenty-sync.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

export async function processAutoApprovals() {
  const mode = getSetting('approval_mode');
  if (mode !== 'auto' && mode !== 'semi') {
    return { mode, processed: 0, synced: 0, failed: 0, skipped: 0, errors: [] };
  }

  const db = getDb();
  const blacklist = loadBlacklist(db);
  const pending = db
    .prepare("SELECT id FROM deals WHERE approval_status = 'pending'")
    .all();

  const results = { mode, processed: 0, synced: 0, failed: 0, skipped: 0, errors: [] };

  for (let i = 0; i < pending.length; i++) {
    const { id } = pending[i];
    const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(id);
    if (!shouldAutoApproveDeal(items, blacklist, mode)) {
      results.skipped++;
      continue;
    }

    if (results.processed > 0) await delay(1000);

    results.processed++;
    try {
      await syncDealToTwenty(id);
      results.synced++;
    } catch (err) {
      results.failed++;
      results.errors.push({ dealId: id, error: err.message });
      console.error(`[auto-approve] sync failed for deal ${id}:`, err.message);
    }
  }

  if (results.processed > 0) {
    console.log(
      `[auto-approve] mode=${mode} processed=${results.processed} synced=${results.synced} failed=${results.failed}`
    );
  }

  return results;
}
