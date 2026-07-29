import { describe, it, expect, vi } from 'vitest';
import {
  normalizeBackupFileList,
  findNewBackupKey,
  pollForNewBackupKey,
} from '../lib/backup-files.js';
import { extractSnapshotPrefixesFromKeys } from '../lib/prune.js';
import { resolveVersions } from '../lib/versions.js';

describe('normalizeBackupFileList', () => {
  it('accepts bare string array from Dokploy', () => {
    expect(normalizeBackupFileList(['twenty-pg/a.sql.gz', 'twenty-pg/b.sql.gz'])).toEqual([
      'twenty-pg/a.sql.gz',
      'twenty-pg/b.sql.gz',
    ]);
  });

  it('accepts wrapped files array', () => {
    expect(normalizeBackupFileList({ files: ['x'] })).toEqual(['x']);
  });

  it('returns empty for unknown shapes', () => {
    expect(normalizeBackupFileList(null)).toEqual([]);
    expect(normalizeBackupFileList({})).toEqual([]);
  });
});

describe('findNewBackupKey', () => {
  it('returns first new key preserving Dokploy newest-first order', () => {
    const before = ['twenty-pg/old.sql.gz'];
    const after = ['twenty-pg/new.sql.gz', 'twenty-pg/old.sql.gz'];
    expect(findNewBackupKey(before, after)).toBe('twenty-pg/new.sql.gz');
  });

  it('returns null when no new keys', () => {
    const keys = ['a', 'b'];
    expect(findNewBackupKey(keys, keys)).toBeNull();
  });
});

describe('extractSnapshotPrefixesFromKeys', () => {
  it('derives unique snapshot-id folder prefixes', () => {
    const keys = [
      'full-snapshots/20260729T153045Z/manifest.json',
      'full-snapshots/20260729T153045Z/twenty-files.tar.gz',
      'full-snapshots/20260720T010000Z/manifest.json',
      'full-snapshots/twenty-files/job-1.tar.gz',
    ];
    expect(extractSnapshotPrefixesFromKeys(keys)).toEqual([
      'full-snapshots/20260720T010000Z/',
      'full-snapshots/20260729T153045Z/',
    ]);
  });
});

describe('pollForNewBackupKey', () => {
  it('resolves when a new key appears', async () => {
    let n = 0;
    const listFn = vi.fn(async () => {
      n++;
      return n === 1 ? ['a'] : ['b', 'a'];
    });
    const key = await pollForNewBackupKey(listFn, ['a'], {
      timeoutMs: 1000,
      intervalMs: 1,
      sleep: async () => {},
    });
    expect(key).toBe('b');
    expect(listFn).toHaveBeenCalledTimes(2);
  });

  it('throws on timeout', async () => {
    const listFn = vi.fn(async () => ['same']);
    await expect(
      pollForNewBackupKey(listFn, ['same'], {
        timeoutMs: 5,
        intervalMs: 1,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/timeout/);
  });
});

describe('resolveVersions', () => {
  it('builds version object from env', () => {
    expect(
      resolveVersions({
        TWENTY_APP_VERSION: '0.5.4',
        CRMPARSER_IMAGE: 'ghcr.io/org/crmparserv2:abc',
        CRMPARSER_DIGEST: 'sha256:deadbeef',
      }),
    ).toEqual({
      crmparserImage: 'ghcr.io/org/crmparserv2:abc',
      crmparserDigest: 'sha256:deadbeef',
      twentyAppVersion: '0.5.4',
    });
  });

  it('requires TWENTY_APP_VERSION by default', () => {
    expect(() => resolveVersions({ CRMPARSER_IMAGE: 'img' })).toThrow(/TWENTY_APP_VERSION/);
  });

  it('allows unknown placeholders with --skip-versions', () => {
    expect(resolveVersions({}, { skipVersions: true })).toEqual({
      crmparserImage: 'unknown',
      twentyAppVersion: 'unknown',
    });
  });
});
