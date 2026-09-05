import { describe, expect, it, vi } from 'vitest';
import {
  MAX_FILE_BYTES,
  classifyTelegramFile,
  downloadTelegramFile,
  uploadRequestFile,
} from '../src/telegram/work-requests/files.js';

describe('MAX_FILE_BYTES', () => {
  it('is 20 MiB', () => {
    expect(MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
  });
});

describe('classifyTelegramFile', () => {
  it('links oversized files', () => {
    expect(classifyTelegramFile({ fileSize: MAX_FILE_BYTES + 1 })).toBe('link');
    expect(classifyTelegramFile({ fileSize: 100 })).toBe('upload');
  });
});

describe('downloadTelegramFile', () => {
  it('fetches file via getFile then bot file URL', async () => {
    const callTelegram = vi.fn().mockResolvedValue({ file_path: 'photos/file.jpg' });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });

    const result = await downloadTelegramFile({
      token: 'bot-token',
      fileId: 'ABC',
      callTelegram,
      fetchImpl,
    });

    expect(callTelegram).toHaveBeenCalledWith('bot-token', 'getFile', { file_id: 'ABC' });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.telegram.org/file/botbot-token/photos/file.jpg');
    expect(result.buffer).toEqual(Buffer.from([1, 2, 3]));
    expect(result.filename).toBe('file.jpg');
    expect(result.contentType).toBe('image/jpeg');
    expect(result.fileSize).toBe(3);
  });
});

describe('uploadRequestFile', () => {
  it('delegates to uploadFilesFieldFile and returns fileId', async () => {
    const uploadFilesFieldFile = vi.fn().mockResolvedValue({ id: 'file-uuid' });
    const result = await uploadRequestFile({
      buffer: Buffer.from('x'),
      filename: 'doc.pdf',
      contentType: 'application/pdf',
      fieldMetadataId: 'field-1',
      uploadFilesFieldFile,
      apiUrl: 'https://crm.example/graphql',
      apiToken: 'tok',
    });
    expect(uploadFilesFieldFile).toHaveBeenCalledWith({
      buffer: Buffer.from('x'),
      filename: 'doc.pdf',
      contentType: 'application/pdf',
      fieldMetadataId: 'field-1',
      apiUrl: 'https://crm.example/graphql',
      apiToken: 'tok',
    });
    expect(result).toEqual({ fileId: 'file-uuid' });
  });
});
