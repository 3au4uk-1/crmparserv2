import { describe, expect, it } from 'vitest';
import {
  classifyOkleykaError,
  isTransportError,
  retryDelaySeconds,
} from '../src/telegram/okleyka-errors.js';

describe('classifyOkleykaError', () => {
  it('classifies TIMEOUT as transient', () => {
    expect(classifyOkleykaError(new Error('Error: TIMEOUT'))).toBe('transient');
  });

  it('classifies userbot not configured as permanent', () => {
    expect(classifyOkleykaError(new Error('userbot not configured'))).toBe('permanent');
  });

  it('classifies download HTTP 404 as permanent', () => {
    expect(classifyOkleykaError(new Error('download failed: HTTP 404'))).toBe('permanent');
  });

  it('classifies download HTTP 5xx as transient', () => {
    expect(classifyOkleykaError(new Error('download failed: HTTP 502'))).toBe('transient');
  });

  it('classifies HTTP status 400 as permanent', () => {
    expect(classifyOkleykaError({ status: 400, message: 'bad request' })).toBe('permanent');
  });

  it('classifies HTTP status 503 as permanent', () => {
    expect(classifyOkleykaError({ status: 503, message: 'unavailable' })).toBe('permanent');
  });

  it('classifies unknown errors as permanent', () => {
    expect(classifyOkleykaError(new Error('something else'))).toBe('permanent');
  });
});

describe('isTransportError', () => {
  it('returns true for TIMEOUT', () => {
    expect(isTransportError(new Error('Error: TIMEOUT'))).toBe(true);
  });

  it('returns true for disconnected and Connection errors', () => {
    expect(isTransportError(new Error('disconnected from server'))).toBe(true);
    expect(isTransportError(new Error('Connection closed'))).toBe(true);
  });

  it('returns true for ECONNRESET, ETIMEDOUT, fetch failed, SOCKS, proxy', () => {
    expect(isTransportError(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransportError(new Error('connect ETIMEDOUT'))).toBe(true);
    expect(isTransportError(new Error('fetch failed'))).toBe(true);
    expect(isTransportError(new Error('SOCKS connection failed'))).toBe(true);
    expect(isTransportError(new Error('proxy handshake failed'))).toBe(true);
  });

  it('returns false for download HTTP 5xx', () => {
    expect(isTransportError(new Error('download failed: HTTP 502'))).toBe(false);
  });

  it('returns false for download HTTP 404', () => {
    expect(isTransportError(new Error('download failed: HTTP 404'))).toBe(false);
  });

  it('returns false for userbot not configured', () => {
    expect(isTransportError(new Error('userbot not configured'))).toBe(false);
  });
});

describe('retryDelaySeconds', () => {
  it('maps attempt counts after increment to 5, 15, 45, 120, 300', () => {
    expect(retryDelaySeconds(1)).toBe(5);
    expect(retryDelaySeconds(2)).toBe(15);
    expect(retryDelaySeconds(3)).toBe(45);
    expect(retryDelaySeconds(4)).toBe(120);
    expect(retryDelaySeconds(5)).toBe(300);
    expect(retryDelaySeconds(6)).toBe(300);
    expect(retryDelaySeconds(99)).toBe(300);
  });
});
