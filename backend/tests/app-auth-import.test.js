import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/config.js', () => ({
  config: {
    appPassword: 'ui-password',
    sessionSecret: 'session-secret',
    importApiSecret: 'import-secret',
  },
}));

import { appAuthMiddleware, verifyImportSecret } from '../src/middleware/app-auth.js';

function mockReq(path, method = 'GET', token = null) {
  return {
    path,
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
}

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

describe('appAuthMiddleware import-by-booking', () => {
  it('accepts IMPORT_API_SECRET on POST /deals/import-by-booking', () => {
    const req = mockReq('/deals/import-by-booking', 'POST', 'import-secret');
    const res = mockRes();
    let nextCalled = false;
    appAuthMiddleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('rejects wrong token on import-by-booking', () => {
    const req = mockReq('/deals/import-by-booking', 'POST', 'wrong');
    const res = mockRes();
    let nextCalled = false;
    appAuthMiddleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('still requires UI session token on other API routes', () => {
    const req = mockReq('/deals', 'GET', 'import-secret');
    const res = mockRes();
    let nextCalled = false;
    appAuthMiddleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});

describe('verifyImportSecret', () => {
  it('matches configured secret', () => {
    expect(verifyImportSecret('import-secret')).toBe(true);
    expect(verifyImportSecret('nope')).toBe(false);
  });
});
