import { describe, it, expect, afterEach } from 'vitest';
import {
  isParsingInProgress,
  tryAcquireParsingLock,
  releaseParsingLock,
} from '../src/services/parsing-lock.js';

describe('parsing-lock', () => {
  afterEach(() => {
    releaseParsingLock();
  });

  it('starts unlocked', () => {
    expect(isParsingInProgress()).toBe(false);
  });

  it('tryAcquire succeeds once, fails while held', () => {
    expect(tryAcquireParsingLock()).toBe(true);
    expect(isParsingInProgress()).toBe(true);
    expect(tryAcquireParsingLock()).toBe(false);
  });

  it('release allows re-acquire', () => {
    tryAcquireParsingLock();
    releaseParsingLock();
    expect(isParsingInProgress()).toBe(false);
    expect(tryAcquireParsingLock()).toBe(true);
  });
});
