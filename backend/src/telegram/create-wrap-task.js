import {
  attachFileFromUrl as attachFileFromUrlDefault,
  createTask as createTaskDefault,
  createTaskTarget as createTaskTargetDefault,
  findDealLineItemForOffice as findDealLineItemForOfficeDefault,
  findOpenTasksByKindAndLineItem as findOpenDefault,
  updateTask as updateTaskDefault,
} from '../services/twenty-tasks.js';

export function wrapTaskTitle(name) {
  return `Оклейка: ${name}`;
}

async function attachAll(attachFileFromUrl, taskId, fileUrls) {
  const urls = Array.isArray(fileUrls) ? fileUrls : [];
  for (const url of urls) {
    if (!url) continue;
    await attachFileFromUrl({ taskId, url });
  }
}

export async function createWrapOkleykaTask(input, deps = {}) {
  const lineItemId = input?.lineItemId;
  const text = input?.text;
  const fileUrls = Array.isArray(input?.fileUrls) ? input.fileUrls : [];
  const force = Boolean(input?.force);

  const findDealLineItemForOffice =
    deps.findDealLineItemForOffice ?? findDealLineItemForOfficeDefault;
  const findOpenTasksByKindAndLineItem =
    deps.findOpenTasksByKindAndLineItem ?? findOpenDefault;
  const createTask = deps.createTask ?? createTaskDefault;
  const updateTask = deps.updateTask ?? updateTaskDefault;
  const createTaskTarget = deps.createTaskTarget ?? createTaskTargetDefault;
  const attachFileFromUrl = deps.attachFileFromUrl ?? attachFileFromUrlDefault;

  const item = await findDealLineItemForOffice(lineItemId);
  if (!item) {
    throw new Error(`Deal line item not found: ${lineItemId}`);
  }

  const openTasks = await findOpenTasksByKindAndLineItem({
    taskKind: 'WRAP_OKLEYKA',
    lineItemId,
  });
  const existing = openTasks[0];

  if (existing) {
    if (!force) {
      return { id: existing.id };
    }
    await updateTask(existing.id, { bodyV2: { markdown: text } });
    await attachAll(attachFileFromUrl, existing.id, fileUrls);
    return { id: existing.id };
  }

  const task = await createTask({
    title: wrapTaskTitle(item.name),
    taskKind: 'WRAP_OKLEYKA',
    body: text,
  });
  await createTaskTarget({ taskId: task.id, dealLineItemId: lineItemId });
  await attachAll(attachFileFromUrl, task.id, fileUrls);
  return task;
}
