import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  config: { twentyAppApiSecret: 'test-secret' },
}));

import { twentyAppAuthMiddleware, verifyTwentyAppSecret } from '../src/middleware/twenty-app-auth.js';

describe('twenty-app-auth', () => {
  it('verifyTwentyAppSecret accepts matching bearer token', () => {
    expect(verifyTwentyAppSecret('test-secret')).toBe(true);
    expect(verifyTwentyAppSecret('wrong')).toBe(false);
  });

  it('middleware returns 401 without token', () => {
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    twentyAppAuthMiddleware(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('middleware calls next with valid token', () => {
    const req = { headers: { authorization: 'Bearer test-secret' } };
    const res = { status: vi.fn(), json: vi.fn() };
    const next = vi.fn();
    twentyAppAuthMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
