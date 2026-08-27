import { describe, expect, it } from 'vitest';
import { decodeMirrorAttachment } from '../src/routes/team-app-mirror.js';

describe('decodeMirrorAttachment', () => {
  it('accepts a decoded attachment up to 20 MB', () => {
    const bytes = Buffer.alloc(20 * 1024 * 1024);
    expect(decodeMirrorAttachment({ bytesBase64: bytes.toString('base64') })).toHaveLength(bytes.length);
  });

  it('rejects a decoded attachment larger than 20 MB', () => {
    const bytes = Buffer.alloc(20 * 1024 * 1024 + 1);
    expect(() => decodeMirrorAttachment({ bytesBase64: bytes.toString('base64') }))
      .toThrow(/20 MB/);
    try {
      decodeMirrorAttachment({ bytesBase64: bytes.toString('base64') });
    } catch (error) {
      expect(error.status).toBe(413);
    }
  });
});
