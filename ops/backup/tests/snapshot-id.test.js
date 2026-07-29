import { describe, it, expect } from 'vitest';
import { buildSnapshotId } from '../lib/snapshot-id.js';

describe('buildSnapshotId', () => {
  it('formats UTC compact timestamp with Z', () => {
    const d = new Date('2026-07-29T15:30:45.123Z');
    expect(buildSnapshotId(d)).toBe('20260729T153045Z');
  });
});
