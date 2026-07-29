import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDokployClient } from '../lib/dokploy-client.js';

describe('createDokployClient', () => {
  let fetchImpl;

  beforeEach(() => {
    fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));
  });

  it('throws when baseUrl is missing', () => {
    expect(() => createDokployClient({ apiKey: 'key' })).toThrow('DOKPLOY_URL required');
  });

  it('throws when apiKey is missing', () => {
    expect(() => createDokployClient({ baseUrl: 'https://dokploy.example' })).toThrow(
      'DOKPLOY_API_KEY required',
    );
  });

  it('sends x-api-key header and JSON body on post', async () => {
    const client = createDokployClient({
      baseUrl: 'https://dokploy.example/',
      apiKey: 'secret-key',
      fetchImpl,
    });

    await client.post('/backup.manualBackupCompose', { backupId: 'abc' });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url.toString()).toBe('https://dokploy.example/api/backup.manualBackupCompose');
    expect(opts.method).toBe('POST');
    expect(opts.headers['x-api-key']).toBe('secret-key');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.body).toBe(JSON.stringify({ backupId: 'abc' }));
  });

  it('appends query params on get', async () => {
    const client = createDokployClient({
      baseUrl: 'https://dokploy.example',
      apiKey: 'secret-key',
      fetchImpl,
    });

    await client.get('/backup.listBackupFiles', {
      destinationId: 'dest-1',
      search: 'full-snapshots',
    });

    const [url] = fetchImpl.mock.calls[0];
    expect(url.toString()).toBe(
      'https://dokploy.example/api/backup.listBackupFiles?destinationId=dest-1&search=full-snapshots',
    );
  });

  it('throws with status and body on non-ok response', async () => {
    fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ message: 'bad request' }),
    }));

    const client = createDokployClient({
      baseUrl: 'https://dokploy.example',
      apiKey: 'secret-key',
      fetchImpl,
    });

    await expect(client.get('/backup.one', { backupId: 'x' })).rejects.toThrow(
      'Dokploy GET /backup.one → 400:',
    );
  });

  it('exposes convenience methods with correct paths', async () => {
    const client = createDokployClient({
      baseUrl: 'https://dokploy.example',
      apiKey: 'secret-key',
      fetchImpl,
    });

    await client.manualBackupCompose('pg-id');
    await client.runVolumeBackup('vol-id');
    await client.listBackupFiles('dest-1', 'prefix');
    await client.composeDeploy('compose-id', 'title', 'desc');

    const paths = fetchImpl.mock.calls.map(([url]) => url.pathname);
    expect(paths).toEqual([
      '/api/backup.manualBackupCompose',
      '/api/volumeBackups.runManually',
      '/api/backup.listBackupFiles',
      '/api/compose.deploy',
    ]);
  });
});
