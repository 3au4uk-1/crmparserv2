import { describe, expect, it, vi } from 'vitest';
import {
  MAX_FILE_BYTES,
  classifyTelegramFile,
  downloadTelegramFile,
  resolveTelegramRequestFilesFieldMetadataId,
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

  it('uses the multipart uploader by default', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { uploadFilesFieldFile: { id: 'file-default' } } }),
    });

    const result = await uploadRequestFile({
      buffer: Buffer.from('x'),
      filename: 'doc.pdf',
      contentType: 'application/pdf',
      fieldMetadataId: 'field-1',
      apiUrl: 'https://crm.example/graphql',
      apiToken: 'tok',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://crm.example/metadata',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer tok' },
        body: expect.any(FormData),
      }),
    );
    expect(result).toEqual({ fileId: 'file-default' });
  });
});

describe('resolveTelegramRequestFilesFieldMetadataId', () => {
  it('prefers the explicit argument and then the environment override', async () => {
    const previous = process.env.TWENTY_TELEGRAM_REQUEST_FILES_FIELD_METADATA_ID;
    process.env.TWENTY_TELEGRAM_REQUEST_FILES_FIELD_METADATA_ID = 'field-from-env';
    try {
      await expect(resolveTelegramRequestFilesFieldMetadataId({
        fieldMetadataId: 'field-explicit',
      })).resolves.toBe('field-explicit');
      await expect(resolveTelegramRequestFilesFieldMetadataId()).resolves.toBe('field-from-env');
    } finally {
      if (previous === undefined) {
        delete process.env.TWENTY_TELEGRAM_REQUEST_FILES_FIELD_METADATA_ID;
      } else {
        process.env.TWENTY_TELEGRAM_REQUEST_FILES_FIELD_METADATA_ID = previous;
      }
    }
  });

  it('throws when requestFiles metadata is absent', async () => {
    const gqlImpl = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          objects: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [{ node: { nameSingular: 'telegramRequest', fieldsList: [] } }],
          },
        },
      },
    });

    await expect(resolveTelegramRequestFilesFieldMetadataId({
      apiUrl: 'https://missing.example/graphql',
      apiToken: 'tok',
      gqlImpl,
    })).rejects.toThrow('telegramRequest requestFiles field metadata not found');
  });

  it('finds the FILES field through paged metadata', async () => {
    const gqlImpl = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            objects: {
              pageInfo: { hasNextPage: true, endCursor: 'next-page' },
              edges: [{ node: { nameSingular: 'company', fieldsList: [] } }],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          data: {
            objects: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [{
                node: {
                  nameSingular: 'telegramRequest',
                  fieldsList: [
                    { id: 'wrong-type', name: 'requestFiles', type: 'TEXT' },
                    { id: 'field-from-metadata', name: 'requestFiles', type: 'FILES' },
                  ],
                },
              }],
            },
          },
        },
      });

    await expect(resolveTelegramRequestFilesFieldMetadataId({
      apiUrl: 'https://crm.example/graphql',
      apiToken: 'tok',
      gqlImpl,
    })).resolves.toBe('field-from-metadata');
    expect(gqlImpl).toHaveBeenNthCalledWith(
      2,
      'https://crm.example/metadata',
      'tok',
      expect.stringContaining('query TelegramRequestFilesFieldMetadataId'),
      { cursor: 'next-page' },
    );
  });
});
