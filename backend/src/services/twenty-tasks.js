import { gql } from './twenty-gql.js';
import { requireTwentyConfig } from './twenty-config.js';
import { guessUploadFileName } from '../telegram/outbound.js';

const LINE_ITEM_FOR_OFFICE = `
  query LineItemForOffice($id: UUID!) {
    dealLineItem(id: $id) {
      id name tip stage
      opportunity { id name stage loadDate }
    }
  }
`;

const TASK_TARGETS_BY_LINE_ITEM = `
  query TaskTargetsByLineItem($filter: TaskTargetFilterInput!) {
    taskTargets(filter: $filter, first: 50) {
      edges {
        node {
          id
          dealLineItemId
          task { id status pipelineStage taskKind dueAt }
        }
      }
    }
  }
`;

const CREATE_TASK = `
  mutation CreateTask($data: TaskCreateInput!) {
    createTask(data: $data) { id }
  }
`;

const UPDATE_TASK = `
  mutation UpdateTask($id: UUID!, $data: TaskUpdateInput!) {
    updateTask(id: $id, data: $data) { id }
  }
`;

const CREATE_TASK_TARGET = `
  mutation CreateTaskTarget($data: TaskTargetCreateInput!) {
    createTaskTarget(data: $data) { id }
  }
`;

const CREATE_ATTACHMENT = `
  mutation CreateAttachment($data: AttachmentCreateInput!) {
    createAttachment(data: $data) { id }
  }
`;

const UPLOAD_FILES_FIELD_FILE = `
  mutation UploadFilesFieldFile($file: Upload!, $fieldMetadataId: String!) {
    uploadFilesFieldFile(file: $file, fieldMetadataId: $fieldMetadataId) {
      id
    }
  }
`;

const ATTACHMENT_FILE_FIELD_METADATA = `
  query AttachmentFileFieldMetadataId($cursor: ConnectionCursor) {
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

let cachedAttachmentFileFieldMetadataId = null;

export function isOpenTask(status, pipelineStage) {
  return status !== 'DONE' && pipelineStage !== 'DONE';
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined));
}

function assertTwentyResponse(resp, context) {
  if (resp.status >= 400) {
    throw new Error(`${context}: HTTP ${resp.status}`);
  }
  const errors = resp.data?.errors;
  if (errors?.length) throw new Error(errors[0].message);
}

function toMetadataUrl(apiUrl) {
  return String(apiUrl).replace(/\/graphql\/?$/, '/metadata');
}

function findAttachmentFileFieldMetadataId(objects) {
  for (const object of objects) {
    if (object.nameSingular !== 'attachment') continue;
    const fields = object.fieldsList ?? object.fields ?? [];
    const fileField = fields.find(
      (field) => field.name === 'file' && String(field.type).toUpperCase() === 'FILES',
    );
    if (fileField?.id) return fileField.id;
  }
  return null;
}

async function downloadFile(url, fetchImpl) {
  const resp = await fetchImpl(url);
  if (!resp.ok) {
    throw new Error(`download failed: HTTP ${resp.status}`);
  }
  const contentType =
    typeof resp.headers?.get === 'function' ? resp.headers.get('content-type') : null;
  const buffer = Buffer.from(await resp.arrayBuffer());
  const filename = guessUploadFileName(url, contentType);
  return { buffer, filename, contentType: contentType || 'application/octet-stream' };
}

export async function findDealLineItemForOffice(id) {
  const { apiUrl, apiToken } = requireTwentyConfig();
  const resp = await gql(apiUrl, apiToken, LINE_ITEM_FOR_OFFICE, { id });
  assertTwentyResponse(resp, 'findDealLineItemForOffice');
  return resp.data?.data?.dealLineItem ?? null;
}

export async function findTasksByKindAndLineItem({ taskKind, lineItemId }) {
  const { apiUrl, apiToken } = requireTwentyConfig();
  const resp = await gql(apiUrl, apiToken, TASK_TARGETS_BY_LINE_ITEM, {
    filter: { dealLineItemId: { eq: lineItemId } },
  });
  assertTwentyResponse(resp, 'findTasksByKindAndLineItem');
  const edges = resp.data?.data?.taskTargets?.edges ?? [];
  const tasks = [];
  for (const edge of edges) {
    const task = edge?.node?.task;
    if (!task?.id) continue;
    if (task.taskKind !== taskKind) continue;
    tasks.push(task);
  }
  return tasks;
}

export async function findOpenTasksByKindAndLineItem({ taskKind, lineItemId }) {
  const tasks = await findTasksByKindAndLineItem({ taskKind, lineItemId });
  return tasks.filter((task) => isOpenTask(task.status, task.pipelineStage));
}

export async function createTask(input) {
  const { apiUrl, apiToken } = requireTwentyConfig();
  const data = compact({
    title: input.title,
    status: input.status ?? 'TODO',
    pipelineStage: input.pipelineStage ?? 'NEW',
    taskKind: input.taskKind,
    dueAt: input.dueAt,
    bodyV2: input.bodyV2 ?? (input.body != null ? { markdown: input.body } : undefined),
  });
  const resp = await gql(apiUrl, apiToken, CREATE_TASK, { data });
  assertTwentyResponse(resp, 'createTask');
  return resp.data?.data?.createTask;
}

export async function updateTask(id, input) {
  const { apiUrl, apiToken } = requireTwentyConfig();
  const resp = await gql(apiUrl, apiToken, UPDATE_TASK, { id, data: input });
  assertTwentyResponse(resp, 'updateTask');
  return resp.data?.data?.updateTask;
}

export async function createTaskTarget({ taskId, dealLineItemId }) {
  const { apiUrl, apiToken } = requireTwentyConfig();
  const resp = await gql(apiUrl, apiToken, CREATE_TASK_TARGET, {
    data: { taskId, dealLineItemId },
  });
  assertTwentyResponse(resp, 'createTaskTarget');
  return resp.data?.data?.createTaskTarget;
}

export async function resolveAttachmentFileFieldMetadataId({
  fieldMetadataId,
  apiUrl,
  apiToken,
} = {}) {
  if (fieldMetadataId) return fieldMetadataId;
  const fromEnv = process.env.TWENTY_ATTACHMENT_FILE_FIELD_METADATA_ID?.trim();
  if (fromEnv) return fromEnv;
  if (cachedAttachmentFileFieldMetadataId) return cachedAttachmentFileFieldMetadataId;

  const twenty = apiUrl && apiToken ? { apiUrl, apiToken } : requireTwentyConfig();
  const metadataUrl = toMetadataUrl(twenty.apiUrl);
  let cursor = null;

  for (let page = 0; page < 20; page += 1) {
    const resp = await gql(metadataUrl, twenty.apiToken, ATTACHMENT_FILE_FIELD_METADATA, { cursor });
    assertTwentyResponse(resp, 'resolveAttachmentFileFieldMetadataId');
    const connection = resp.data?.data?.objects;
    const objects = (connection?.edges ?? []).map((edge) => edge.node).filter(Boolean);
    const found = findAttachmentFileFieldMetadataId(objects);
    if (found) {
      cachedAttachmentFileFieldMetadataId = found;
      return found;
    }
    if (!connection?.pageInfo?.hasNextPage || !connection?.pageInfo?.endCursor) break;
    cursor = connection.pageInfo.endCursor;
  }

  throw new Error('Twenty attachment file field metadata not found');
}

async function uploadFilesFieldFile({
  apiUrl,
  apiToken,
  buffer,
  filename,
  contentType,
  fieldMetadataId,
  fetchImpl,
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

export async function attachFileFromUrl({
  taskId,
  url,
  fieldMetadataId,
  fetchImpl = globalThis.fetch,
}) {
  const { apiUrl, apiToken } = requireTwentyConfig();
  const downloaded = await downloadFile(url, fetchImpl);
  const resolvedFieldId = await resolveAttachmentFileFieldMetadataId({
    fieldMetadataId,
    apiUrl,
    apiToken,
  });
  const uploaded = await uploadFilesFieldFile({
    apiUrl,
    apiToken,
    buffer: downloaded.buffer,
    filename: downloaded.filename,
    contentType: downloaded.contentType,
    fieldMetadataId: resolvedFieldId,
    fetchImpl,
  });

  const resp = await gql(apiUrl, apiToken, CREATE_ATTACHMENT, {
    data: {
      name: downloaded.filename,
      targetTaskId: taskId,
      file: [{ fileId: uploaded.id, label: downloaded.filename }],
    },
  });
  assertTwentyResponse(resp, 'createAttachment');
  return resp.data?.data?.createAttachment;
}
