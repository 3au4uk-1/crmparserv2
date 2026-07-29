import { describe, it, expect } from 'vitest';
import { listExpiredSnapshotPrefixes } from '../lib/prune.js';

describe('listExpiredSnapshotPrefixes', () => {
  it('keeps snapshots inside 7 days', () => {
    const now = new Date('2026-07-29T12:00:00Z');
    const prefixes = [
      'full-snapshots/20260729T010000Z/',
      'full-snapshots/20260720T010000Z/',
      'full-snapshots/20260721T120000Z/',
    ];
    const expired = listExpiredSnapshotPrefixes(prefixes, now, 7);
    expect(expired).toEqual(['full-snapshots/20260720T010000Z/']);
  });
});
