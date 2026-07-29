/**
 * @typedef {{ key: string, modifiedAt?: Date }} BackupFileEntry
 */

const MODIFIED_AT_FIELDS = [
  'modifiedAt',
  'lastModified',
  'LastModified',
  'mtime',
  'createdAt',
  'created',
];

/**
 * @param {unknown} item
 * @returns {BackupFileEntry | null}
 */
export function parseBackupFileEntry(item) {
  if (typeof item === 'string') return { key: item };
  if (!item || typeof item !== 'object') return null;

  const obj = /** @type {Record<string, unknown>} */ (item);
  const key = obj.key ?? obj.Key ?? obj.path ?? obj.Path ?? obj.name;
  if (key == null || key === '') return null;

  const modifiedAt = parseModifiedAt(obj);
  return modifiedAt ? { key: String(key), modifiedAt } : { key: String(key) };
}

/**
 * @param {Record<string, unknown>} item
 * @returns {Date | undefined}
 */
function parseModifiedAt(item) {
  for (const field of MODIFIED_AT_FIELDS) {
    const raw = item[field];
    if (raw == null) continue;
    const d = raw instanceof Date ? raw : new Date(String(raw));
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

/**
 * Shape Dokploy backup.listBackupFiles responses (path strings or objects with metadata).
 * @param {unknown} response
 * @returns {BackupFileEntry[]}
 */
export function normalizeBackupFileEntries(response) {
  const items = extractRawItems(response);
  return items.map(parseBackupFileEntry).filter(Boolean);
}

function extractRawItems(response) {
  if (Array.isArray(response)) return response;
  if (response && typeof response === 'object') {
    const obj = /** @type {Record<string, unknown>} */ (response);
    if (Array.isArray(obj.files)) return obj.files;
    if (Array.isArray(obj.data)) return obj.data;
  }
  return [];
}

/**
 * Shape Dokploy backup.listBackupFiles responses (array of path strings or wrapped).
 * @param {unknown} response
 * @returns {string[]}
 */
export function normalizeBackupFileList(response) {
  return normalizeBackupFileEntries(response).map((e) => e.key);
}

/**
 * Pick the best new backup key after a trigger.
 * When entries include modifiedAt, prefers the newest among new keys with mtime >= since.
 * Otherwise uses set-diff and Dokploy newest-first ordering (see README concurrency note).
 * @param {string[]} beforeKeys
 * @param {BackupFileEntry[]} afterEntries
 * @param {{ since?: Date }} [opts]
 * @returns {string | null}
 */
export function findNewBackupKey(beforeKeys, afterEntries, { since } = {}) {
  const before = new Set(beforeKeys);
  const newcomers = afterEntries.filter((e) => !before.has(e.key));
  if (newcomers.length === 0) return null;

  const sinceMs = since?.getTime();
  const timed = newcomers.filter((e) => e.modifiedAt != null);

  if (timed.length > 0 && sinceMs != null) {
    const eligible = timed.filter((e) => e.modifiedAt.getTime() >= sinceMs);
    if (eligible.length > 0) return pickNewestByTime(eligible).key;
    if (timed.length === newcomers.length) return null;
  }

  return newcomers[0].key;
}

/** @param {BackupFileEntry[]} entries */
function pickNewestByTime(entries) {
  return entries.reduce((best, cur) =>
    cur.modifiedAt.getTime() > best.modifiedAt.getTime() ? cur : best,
  );
}

/**
 * @param {() => Promise<BackupFileEntry[]>} listFn
 * @param {string[]} knownKeys
 * @param {{ timeoutMs?: number, intervalMs?: number, since?: Date, sleep?: (ms: number) => Promise<void> }} opts
 * @returns {Promise<string>}
 */
export async function pollForNewBackupKey(
  listFn,
  knownKeys,
  { timeoutMs = 600_000, intervalMs = 15_000, since, sleep = defaultSleep } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await listFn();
    const key = findNewBackupKey(knownKeys, current, { since });
    if (key) return key;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for new backup file after ${timeoutMs}ms`);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
