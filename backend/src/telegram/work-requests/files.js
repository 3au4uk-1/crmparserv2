import { gql } from '../../services/twenty-gql.js';

export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const UPLOAD_FILES_FIELD_FILE = `
  mutation UploadFilesFieldFile($file: Upload!, $fieldMetadataId: String!) {
    uploadFilesFieldFile(file: $file, fieldMetadataId: $fieldMetadataId) {
      id
    }
  }
`;

const TELEGRAM_REQUEST_FILES_FIELD_METADATA = `
  query TelegramRequestFilesFieldMetadataId($cursor: ConnectionCursor) {
    objects(paging: { first: 100, after: $cursor }) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          nameSingular
          fieldsList { id name type }
        }
      }
    }
  }
`;

let cachedTelegramRequestFilesFieldMetadataId = null;

function toMetadataUrl(apiUrl) {
  return String(apiUrl).replace(/\/graphql\/?$/, '/metadata');
}

function assertMetadataResponse(resp) {
  if (resp.status >= 400) {
    throw new Error(`resolveTelegramRequestFilesFieldMetadataId: HTTP ${resp.status}`);
  }
  const errors = resp.data?.errors;
  if (errors?.length) throw new Error(errors[0].message);
}

function findTelegramRequestFilesFieldMetadataId(objects) {
  for (const object of objects) {
    if (object.nameSingular !== 'telegramRequest') continue;
    const fields = object.fieldsList ?? object.fields ?? [];
    const requestFiles = fields.find(
      (field) => field.name === 'requestFiles' && String(field.type).toUpperCase() === 'FILES',
    );
    if (requestFiles?.id) return requestFiles.id;
  }
  return null;
}

export async function resolveTelegramRequestFilesFieldMetadataId({
  fieldMetadataId,
  apiUrl,
  apiToken,
  gqlImpl = gql,
} = {}) {
  if (fieldMetadataId) return fieldMetadataId;
  const fromEnv = process.env.TWENTY_TELEGRAM_REQUEST_FILES_FIELD_METADATA_ID?.trim();
  if (fromEnv) return fromEnv;
  if (cachedTelegramRequestFilesFieldMetadataId) {
    return cachedTelegramRequestFilesFieldMetadataId;
  }

  const metadataUrl = toMetadataUrl(apiUrl);
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const resp = await gqlImpl(
      metadataUrl,
      apiToken,
      TELEGRAM_REQUEST_FILES_FIELD_METADATA,
      { cursor },
    );
    assertMetadataResponse(resp);
    const connection = resp.data?.data?.objects;
    const objects = (connection?.edges ?? []).map((edge) => edge.node).filter(Boolean);
    const found = findTelegramRequestFilesFieldMetadataId(objects);
    if (found) {
      cachedTelegramRequestFilesFieldMetadataId = found;
      return found;
    }
    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
    cursor = connection.pageInfo.endCursor;
  }

  throw new Error('Twenty telegramRequest requestFiles field metadata not found');
}

export function classifyTelegramFile({ fileSize }) {
  return fileSize > MAX_FILE_BYTES ? 'link' : 'upload';
}

export async function downloadTelegramFile({ token, fileId, callTelegram, fetchImpl = globalThis.fetch }) {
  const fileInfo = await callTelegram(token, 'getFile', { file_id: fileId });
  const filePath = fileInfo.file_path;
  const url = `https://api.telegram.org/file/bot${token}/${filePath}`;
  const resp = await fetchImpl(url);
  if (!resp.ok) {
    throw new Error(`download failed: HTTP ${resp.status}`);
  }
  const contentType =
    typeof resp.headers?.get === 'function'
      ? resp.headers.get('content-type') ?? 'application/octet-stream'
      : 'application/octet-stream';
  const buffer = Buffer.from(await resp.arrayBuffer());
  const filename = filePath.split('/').pop() || 'file';
  return { buffer, filename, contentType, fileSize: buffer.length };
}

export async function uploadFilesFieldFileForWorkRequest({
  apiUrl,
  apiToken,
  buffer,
  filename,
  contentType,
  fieldMetadataId,
  fetchImpl = globalThis.fetch,
}) {
  const form = new FormData();
  form.append(
    'operations',
    JSON.stringify({
      query: UPLOAD_FILES_FIELD_FILE,
      variables: { file: null, fieldMetadataId },
    }),
  );
  form.append('map', JSON.stringify({ '0': ['variables.file'] }));
  const bytes = new Uint8Array(buffer);
  const file =
    typeof File === 'function'
      ? new File([bytes], filename, { type: contentType })
      : new Blob([bytes], { type: contentType });
  if (typeof File === 'function') {
    form.append('0', file);
  } else {
    form.append('0', file, filename);
  }

  const resp = await fetchImpl(toMetadataUrl(apiUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}` },
    body: form,
  });

  const payload = await resp.json();
  if (!resp.ok || payload.errors?.length) {
    const message = payload.errors?.[0]?.message ?? resp.statusText;
    throw new Error(`Twenty file upload failed (${resp.status}): ${message}`);
  }
  const id = payload.data?.uploadFilesFieldFile?.id;
  if (!id) {
    throw new Error('Twenty file upload returned no file id');
  }
  return { id };
}

export async function uploadRequestFile({
  buffer,
  filename,
  contentType,
  fieldMetadataId,
  uploadFilesFieldFile = uploadFilesFieldFileForWorkRequest,
  ...rest
}) {
  const result = await uploadFilesFieldFile({
    buffer,
    filename,
    contentType,
    fieldMetadataId,
    ...rest,
  });
  return { fileId: result.id };
}
