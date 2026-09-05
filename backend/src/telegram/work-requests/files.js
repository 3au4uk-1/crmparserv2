export const MAX_FILE_BYTES = 20 * 1024 * 1024;

const UPLOAD_FILES_FIELD_FILE = `
  mutation UploadFilesFieldFile($file: Upload!, $fieldMetadataId: String!) {
    uploadFilesFieldFile(file: $file, fieldMetadataId: $fieldMetadataId) {
      id
    }
  }
`;

function toMetadataUrl(apiUrl) {
  return String(apiUrl).replace(/\/graphql\/?$/, '/metadata');
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
  uploadFilesFieldFile,
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
