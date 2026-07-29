export function createDokployClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  if (!baseUrl) throw new Error('DOKPLOY_URL required');
  if (!apiKey) throw new Error('DOKPLOY_API_KEY required');
  const root = baseUrl.replace(/\/$/, '');

  async function request(method, path, { body, query } = {}) {
    const url = new URL(`${root}/api${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetchImpl(url, {
      method,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new Error(
        `Dokploy ${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
      );
    }
    return data;
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    manualBackupCompose: (backupId) =>
      request('POST', '/backup.manualBackupCompose', { body: { backupId } }),
    runVolumeBackup: (volumeBackupId) =>
      request('POST', '/volumeBackups.runManually', { body: { volumeBackupId } }),
    listBackupFiles: (destinationId, search) =>
      request('GET', '/backup.listBackupFiles', { query: { destinationId, search } }),
    composeDeploy: (composeId, title, description) =>
      request('POST', '/compose.deploy', { body: { composeId, title, description } }),
  };
}
