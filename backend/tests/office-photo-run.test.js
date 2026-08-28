import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/twenty-gql.js', () => ({ gql: vi.fn() }));
vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
}));
vi.mock('../src/services/twenty-tasks.js', () => ({
  findOpenTasksByKindAndLineItem: vi.fn(),
  findTasksByKindAndLineItem: vi.fn(),
  createTask: vi.fn(),
  createTaskTarget: vi.fn(),
  isOpenTask: (status, pipelineStage) => status !== 'DONE' && pipelineStage !== 'DONE',
}));

import { crmOffsetSuffix } from '../src/utils/crm-dates.js';
import { runOfficePhotoTasks } from '../src/services/office-photo-tasks/run.js';

function crmDayStart(ymd) {
  return `${ymd}T00:00:00${crmOffsetSuffix()}`;
}

const NOW = new Date('2026-08-27T12:00:00+03:00');

function gqlEdges(nodes) {
  return async () => ({
    data: {
      data: {
        dealLineItems: {
          pageInfo: { hasNextPage: false },
          edges: nodes.map((node) => ({ node })),
        },
      },
    },
  });
}

function bannerItem(overrides = {}) {
  return {
    id: 'li-banner',
    name: 'Позиция',
    tip: 'BANNERA',
    stage: 'NOVYY',
    opportunity: {
      id: 'opp-1',
      name: 'Свадьба Ивановых',
      stage: 'NOVYY',
      loadDate: '2026-08-28T00:00:00.000Z',
    },
    ...overrides,
  };
}

function podryadItem() {
  return {
    id: 'li-podryad',
    name: 'X',
    tip: 'PODRYAD',
    stage: 'NOVYY',
    opportunity: {
      id: 'opp-2',
      name: 'Корпоратив',
      stage: 'NOVYY',
      loadDate: '2026-08-27T00:00:00.000Z',
    },
  };
}

describe('runOfficePhotoTasks', () => {
  let findTasks;
  let createTask;
  let createTaskTarget;

  beforeEach(() => {
    findTasks = vi.fn().mockResolvedValue([]);
    createTask = vi.fn().mockResolvedValue({ id: 'task-1' });
    createTaskTarget = vi.fn().mockResolvedValue({ id: 'tt-1' });
  });

  function runDeps(overrides = {}) {
    return {
      now: NOW,
      findTasksByKindAndLineItem: findTasks,
      createTask,
      createTaskTarget,
      ...overrides,
    };
  }

  it('queries BANNERA/PODRYAD line items in today–tomorrow loadDate window', async () => {
    const gqlImpl = vi.fn().mockImplementation(gqlEdges([]));
    await runOfficePhotoTasks({
      gqlImpl,
      ...runDeps(),
    });

    expect(gqlImpl).toHaveBeenCalled();
    const [query, variables] = gqlImpl.mock.calls[0];
    expect(query).toContain('query OfficePhotoLineItems');
    expect(query).toContain('dealLineItems');
    expect(variables.filter.and[0].or).toEqual([
      { tip: { eq: 'BANNERA' } },
      { tip: { eq: 'PODRYAD' } },
    ]);
    const loadFilter = variables.filter.and[1].opportunity.and;
    expect(loadFilter).toEqual([
      { loadDate: { gte: crmDayStart('2026-08-27') } },
      { loadDate: { lt: crmDayStart('2026-08-29') } },
    ]);
  });

  it('creates OFFICE_PHOTO task and target for tomorrow BANNERA', async () => {
    const result = await runOfficePhotoTasks({
      gqlImpl: gqlEdges([bannerItem()]),
      ...runDeps(),
    });

    expect(result).toMatchObject({ created: 1, skipped: 0 });
    expect(createTask).toHaveBeenCalledWith({
      title: 'Сфотографировать баннер: Позиция',
      taskKind: 'OFFICE_PHOTO',
      dueAt: crmDayStart('2026-08-28'),
      body: 'Свадьба Ивановых\n2026-08-28\nПриложите фото баннера',
    });
    expect(createTask.mock.calls[0][0]).not.toHaveProperty('assigneeId');
    expect(createTaskTarget).toHaveBeenCalledWith({
      taskId: 'task-1',
      dealLineItemId: 'li-banner',
    });
  });

  it('creates catch-up PODRYAD task for today loadDate', async () => {
    await runOfficePhotoTasks({
      gqlImpl: gqlEdges([podryadItem()]),
      ...runDeps(),
    });

    expect(createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Сфотографировать подряд: X',
        taskKind: 'OFFICE_PHOTO',
        body: 'Корпоратив\n2026-08-27\nПриложите фото подряда',
      }),
    );
  });

  it('skips cancelled opportunity without creating a task', async () => {
    const item = bannerItem({
      opportunity: {
        id: 'opp-1',
        name: 'Отмена',
        stage: 'OTMENA',
        loadDate: '2026-08-28T00:00:00.000Z',
      },
    });
    const result = await runOfficePhotoTasks({
      gqlImpl: gqlEdges([item]),
      ...runDeps(),
    });

    expect(result.skipped).toBe(1);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('skips when an open OFFICE_PHOTO task already exists', async () => {
    findTasks.mockResolvedValue([{ id: 'existing', status: 'TODO', pipelineStage: 'NEW' }]);
    const result = await runOfficePhotoTasks({
      gqlImpl: gqlEdges([bannerItem()]),
      ...runDeps(),
    });

    expect(findTasks).toHaveBeenCalledWith({
      taskKind: 'OFFICE_PHOTO',
      lineItemId: 'li-banner',
    });
    expect(result.skipped).toBe(1);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('skips when a DONE OFFICE_PHOTO has dueAt on the same loadDate day', async () => {
    findTasks.mockResolvedValue([
      {
        id: 'done-same-day',
        status: 'DONE',
        pipelineStage: 'DONE',
        dueAt: crmDayStart('2026-08-28'),
      },
    ]);
    const result = await runOfficePhotoTasks({
      gqlImpl: gqlEdges([bannerItem()]),
      ...runDeps(),
    });

    expect(result.skipped).toBe(1);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('creates when previous OFFICE_PHOTO is DONE on a different dueAt day', async () => {
    findTasks.mockResolvedValue([
      {
        id: 'done-other-day',
        status: 'DONE',
        pipelineStage: 'DONE',
        dueAt: crmDayStart('2026-08-20'),
      },
    ]);
    const result = await runOfficePhotoTasks({
      gqlImpl: gqlEdges([bannerItem()]),
      ...runDeps(),
    });

    expect(result.created).toBe(1);
    expect(createTask).toHaveBeenCalledOnce();
  });

  it('continues after a per-item create failure', async () => {
    createTask
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'task-2' });

    const result = await runOfficePhotoTasks({
      gqlImpl: gqlEdges([bannerItem(), { ...podryadItem() }]),
      ...runDeps(),
    });

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(createTaskTarget).toHaveBeenCalledOnce();
  });
});
