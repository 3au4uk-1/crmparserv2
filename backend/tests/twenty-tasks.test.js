import { describe, it, expect, vi, beforeEach } from 'vitest';

const gqlMock = vi.fn();
vi.mock('../src/services/twenty-gql.js', () => ({
  gql: (...args) => gqlMock(...args),
}));

vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
}));

import {
  findDealLineItemForOffice,
  findOpenTasksByKindAndLineItem,
  createTask,
  updateTask,
  createTaskTarget,
  attachFileFromUrl,
} from '../src/services/twenty-tasks.js';

function gqlOk(data) {
  return { status: 200, data: { data } };
}

describe('createTask', () => {
  beforeEach(() => gqlMock.mockReset());

  it('sends taskKind OFFICE_PHOTO and omits assigneeId', async () => {
    gqlMock.mockResolvedValue(gqlOk({ createTask: { id: 'task-1' } }));

    const result = await createTask({
      title: 'Сфотографировать баннер: Позиция',
      taskKind: 'OFFICE_PHOTO',
      dueAt: '2026-08-27T21:00:00.000Z',
      body: 'Приложите фото',
    });

    expect(result).toEqual({ id: 'task-1' });
    expect(gqlMock).toHaveBeenCalledOnce();
    const [, , query, variables] = gqlMock.mock.calls[0];
    expect(query).toContain('mutation CreateTask');
    expect(query).toContain('createTask(data: $data)');
    expect(variables.data).toMatchObject({
      title: 'Сфотографировать баннер: Позиция',
      status: 'TODO',
      pipelineStage: 'NEW',
      taskKind: 'OFFICE_PHOTO',
      dueAt: '2026-08-27T21:00:00.000Z',
      bodyV2: { markdown: 'Приложите фото' },
    });
    expect(variables.data).not.toHaveProperty('assigneeId');
  });
});

describe('updateTask', () => {
  beforeEach(() => gqlMock.mockReset());

  it('patches task by id', async () => {
    gqlMock.mockResolvedValue(gqlOk({ updateTask: { id: 'task-1' } }));
    const result = await updateTask('task-1', { title: 'Оклейка: X' });
    expect(result).toEqual({ id: 'task-1' });
    const [, , query, variables] = gqlMock.mock.calls[0];
    expect(query).toContain('mutation UpdateTask');
    expect(variables).toEqual({ id: 'task-1', data: { title: 'Оклейка: X' } });
  });
});

describe('createTaskTarget', () => {
  beforeEach(() => gqlMock.mockReset());

  it('links task to dealLineItemId', async () => {
    gqlMock.mockResolvedValue(gqlOk({ createTaskTarget: { id: 'tt-1' } }));
    const result = await createTaskTarget({ taskId: 'task-1', dealLineItemId: 'li-9' });
    expect(result).toEqual({ id: 'tt-1' });
    const [, , query, variables] = gqlMock.mock.calls[0];
    expect(query).toContain('mutation CreateTaskTarget');
    expect(variables.data).toEqual({ taskId: 'task-1', dealLineItemId: 'li-9' });
  });
});

describe('findOpenTasksByKindAndLineItem', () => {
  beforeEach(() => gqlMock.mockReset());

  it('keeps matching open taskKind and drops DONE or other kinds', async () => {
    gqlMock.mockResolvedValue(
      gqlOk({
        taskTargets: {
          edges: [
            {
              node: {
                id: 'tt-open',
                task: { id: 't-open', status: 'TODO', pipelineStage: 'NEW', taskKind: 'OFFICE_PHOTO' },
              },
            },
            {
              node: {
                id: 'tt-done',
                task: { id: 't-done', status: 'DONE', pipelineStage: 'NEW', taskKind: 'OFFICE_PHOTO' },
              },
            },
            {
              node: {
                id: 'tt-wrap',
                task: { id: 't-wrap', status: 'TODO', pipelineStage: 'NEW', taskKind: 'WRAP_OKLEYKA' },
              },
            },
          ],
        },
      }),
    );

    const found = await findOpenTasksByKindAndLineItem({
      taskKind: 'OFFICE_PHOTO',
      lineItemId: 'li-1',
    });

    expect(found.map((t) => t.id)).toEqual(['t-open']);
    const [, , query, variables] = gqlMock.mock.calls[0];
    expect(query).toContain('taskTargets');
    expect(variables.filter).toEqual({ dealLineItemId: { eq: 'li-1' } });
  });
});

describe('findDealLineItemForOffice', () => {
  beforeEach(() => gqlMock.mockReset());

  it('loads line item with opportunity loadDate', async () => {
    const item = {
      id: 'li-1',
      name: 'Позиция',
      tip: 'BANNERA',
      stage: 'NOVYY',
      opportunity: { id: 'opp-1', name: 'Сделка', stage: 'NOVYY', loadDate: '2026-08-28' },
    };
    gqlMock.mockResolvedValue(gqlOk({ dealLineItem: item }));
    expect(await findDealLineItemForOffice('li-1')).toEqual(item);
    const [, , query, variables] = gqlMock.mock.calls[0];
    expect(query).toContain('query LineItemForOffice');
    expect(variables).toEqual({ id: 'li-1' });
  });
});

describe('attachFileFromUrl', () => {
  beforeEach(() => gqlMock.mockReset());

  it('downloads bytes, uploads via uploadFilesFieldFile, then createAttachment', async () => {
    gqlMock.mockResolvedValue(gqlOk({ createAttachment: { id: 'att-1' } }));

    const fetchImpl = vi.fn(async (url) => {
      if (String(url).includes('/metadata')) {
        return {
          ok: true,
          json: async () => ({ data: { uploadFilesFieldFile: { id: 'file-99' } } }),
        };
      }
      return {
        ok: true,
        headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : null) },
        arrayBuffer: async () => new Uint8Array([9, 8, 7]).buffer,
      };
    });

    const result = await attachFileFromUrl({
      taskId: 'task-1',
      url: 'https://cdn.example.com/previews/shot.jpg',
      fieldMetadataId: 'field-meta-1',
      fetchImpl,
    });

    expect(result).toEqual({ id: 'att-1' });
    expect(fetchImpl).toHaveBeenCalled();
    const uploadCall = fetchImpl.mock.calls.find(([url]) => String(url).includes('/metadata'));
    expect(uploadCall).toBeTruthy();
    expect(uploadCall[0]).toBe('https://crm.example/metadata');

    const [, , query, variables] = gqlMock.mock.calls[0];
    expect(query).toContain('mutation CreateAttachment');
    expect(variables.data).toEqual({
      name: 'shot.jpg',
      targetTaskId: 'task-1',
      file: [{ fileId: 'file-99', label: 'shot.jpg' }],
    });
  });
});
