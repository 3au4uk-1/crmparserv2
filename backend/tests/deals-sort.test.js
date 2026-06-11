import { describe, it, expect } from 'vitest';
import { buildDealsOrderClause } from '../src/routes/deals.js';

describe('buildDealsOrderClause', () => {
  it('defaults to start_date desc', () => {
    expect(buildDealsOrderClause(undefined, undefined)).toBe('ORDER BY d.start_date DESC');
  });
  it('sorts budget numerically', () => {
    expect(buildDealsOrderClause('budget', 'asc')).toContain('CAST(d.budget AS REAL)');
    expect(buildDealsOrderClause('budget', 'asc')).toContain('d.budget IS NULL');
  });
  it('falls back for unknown sortBy', () => {
    expect(buildDealsOrderClause('DROP TABLE', 'asc')).toBe('ORDER BY d.start_date ASC');
  });
});
