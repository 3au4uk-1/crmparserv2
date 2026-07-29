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
    listBackupFiles: (destinationId, search, serverId) => {
      const query = { destinationId, search };
      if (serverId != null) query.serverId = serverId;
      return request('GET', '/backup.listBackupFiles', { query });
    },
    composeDeploy: (composeId, title, description) =>
      request('POST', '/compose.deploy', { body: { composeId, title, description } }),
    composeOne: (composeId) => request('GET', '/compose.one', { query: { composeId } }),
    composeUpdate: (body) => request('POST', '/compose.update', { body }),
    scheduleCreate: (body) => request('POST', '/schedule.create', { body }),
    scheduleUpdate: (body) => request('POST', '/schedule.update', { body }),
    scheduleOne: (scheduleId) =>
      request('GET', '/schedule.one', { query: { scheduleId } }),
    scheduleRunManually: (scheduleId) =>
      request('POST', '/schedule.runManually', { body: { scheduleId } }),
    scheduleList: (id, scheduleType) =>
      request('GET', '/schedule.list', { query: { id, scheduleType } }),
    deploymentAllByType: (id, type) =>
      request('GET', '/deployment.allByType', { query: { id, type } }),
    deploymentReadLogs: (deploymentId, tail = 500) =>
      request('GET', '/deployment.readLogs', { query: { deploymentId, tail } }),
  };
}
