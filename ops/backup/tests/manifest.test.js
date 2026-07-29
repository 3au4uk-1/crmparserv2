import { describe, it, expect } from 'vitest';
import { createManifest, assertManifest } from '../lib/manifest.js';

describe('manifest', () => {
  it('createManifest fills required shape', () => {
    const m = createManifest({
      snapshotId: '20260729T153045Z',
      components: {
        twentyPg: { key: 'twenty-pg/x.sql.gz', source: 'dokploy-compose' },
        twentyFiles: { key: 'full-snapshots/20260729T153045Z/twenty-files.tar.gz', source: 'dokploy-volume' },
        crmparserSqlite: { key: 'full-snapshots/20260729T153045Z/crmparser-data.tar.gz', source: 'dokploy-volume' },
      },
      versions: {
        crmparserImage: 'ghcr.io/3au4uk-1/crmparserv2:abc123',
        crmparserDigest: 'sha256:deadbeef',
        twentyAppVersion: '0.5.4',
      },
    });
    expect(m.retentionDays).toBe(7);
    expect(m.environment).toBe('production');
    expect(() => assertManifest(m)).not.toThrow();
  });

  it('assertManifest allows optional twentyAppGitSha', () => {
    const m = createManifest({
      snapshotId: '20260729T153045Z',
      components: {
        twentyPg: { key: 'twenty-pg/x.sql.gz', source: 'dokploy-compose' },
        twentyFiles: { key: 'full-snapshots/20260729T153045Z/twenty-files.tar.gz', source: 'dokploy-volume' },
        crmparserSqlite: { key: 'full-snapshots/20260729T153045Z/crmparser-data.tar.gz', source: 'dokploy-volume' },
      },
      versions: {
        crmparserImage: 'ghcr.io/3au4uk-1/crmparserv2:abc123',
        twentyAppVersion: '0.5.4',
        twentyAppGitSha: 'a1b2c3d4e5f6789012345678901234567890abcd',
      },
    });
    expect(m.versions.twentyAppGitSha).toBe('a1b2c3d4e5f6789012345678901234567890abcd');
  });

  it('assertManifest rejects non-string twentyAppGitSha', () => {
    expect(() =>
      assertManifest({
        snapshotId: 'x',
        createdAt: new Date().toISOString(),
        retentionDays: 7,
        environment: 'production',
        components: {
          twentyPg: { key: 'a', source: 'dokploy-compose' },
          twentyFiles: { key: 'b', source: 'dokploy-volume' },
          crmparserSqlite: { key: 'c', source: 'dokploy-volume' },
        },
        versions: { crmparserImage: 'img', twentyAppVersion: '1.0.0', twentyAppGitSha: 123 },
      }),
    ).toThrow(/twentyAppGitSha/);
  });

  it('assertManifest rejects missing component key', () => {
    expect(() =>
      assertManifest({
        snapshotId: 'x',
        createdAt: new Date().toISOString(),
        retentionDays: 7,
        environment: 'production',
        components: {
          twentyPg: { key: 'a', source: 'dokploy-compose' },
          twentyFiles: { key: '', source: 'dokploy-volume' },
          crmparserSqlite: { key: 'c', source: 'dokploy-volume' },
        },
        versions: { crmparserImage: 'img', twentyAppVersion: '1.0.0' },
      }),
    ).toThrow(/twentyFiles/);
  });
});
