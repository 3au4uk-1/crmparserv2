/**
 * Shape Dokploy backup.listBackupFiles responses (array of path strings or wrapped).
 * @param {unknown} response
 * @returns {string[]}
 */
export function normalizeBackupFileList(response) {
  if (Array.isArray(response)) return response.map(String);
  if (response && typeof response === 'object') {
    if (Array.isArray(response.files)) return response.files.map(String);
    if (Array.isArray(response.data)) return response.data.map(String);
  }
  return [];
}

/**
 * First new key after a backup trigger (Dokploy returns paths sorted newest-first).
 * @param {string[]} beforeKeys
 * @param {string[]} afterKeys
 * @returns {string | null}
 */
export function findNewBackupKey(beforeKeys, afterKeys) {
  const before = new Set(beforeKeys);
  for (const key of afterKeys) {
    if (!before.has(key)) return key;
  }
  return null;
}

/**
 * @param {() => Promise<string[]>} listFn
 * @param {string[]} knownKeys
 * @param {{ timeoutMs?: number, intervalMs?: number, sleep?: (ms: number) => Promise<void> }} opts
 * @returns {Promise<string>}
 */
export async function pollForNewBackupKey(
  listFn,
  knownKeys,
  { timeoutMs = 600_000, intervalMs = 15_000, sleep = defaultSleep } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await listFn();
    const key = findNewBackupKey(knownKeys, current);
    if (key) return key;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for new backup file after ${timeoutMs}ms`);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
