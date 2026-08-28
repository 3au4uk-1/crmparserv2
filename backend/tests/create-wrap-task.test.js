import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWrapOkleykaTask, wrapTaskTitle } from '../src/telegram/create-wrap-task.js';

describe('wrapTaskTitle', () => {
  it('prefixes line item name', () => {
    expect(wrapTaskTitle('Позиция')).toBe('Оклейка: Позиция');
  });
});

describe('createWrapOkleykaTask', () => {
  let findDealLineItemForOffice;
  let findOpenTasksByKindAndLineItem;
  let createTask;
  let updateTask;
  let createTaskTarget;
  let attachFileFromUrl;

  beforeEach(() => {
    findDealLineItemForOffice = vi.fn().mockResolvedValue({
      id: 'li-1',
      name: 'Позиция',
      opportunity: { id: 'opp-1', name: 'Сделка' },
    });
    findOpenTasksByKindAndLineItem = vi.fn().mockResolvedValue([]);
    createTask = vi.fn().mockResolvedValue({ id: 'task-new' });
    updateTask = vi.fn().mockResolvedValue({ id: 'task-open' });
    createTaskTarget = vi.fn().mockResolvedValue({ id: 'tt-1' });
    attachFileFromUrl = vi.fn().mockResolvedValue({ id: 'att-1' });
  });

  function deps() {
    return {
      findDealLineItemForOffice,
      findOpenTasksByKindAndLineItem,
      createTask,
      updateTask,
      createTaskTarget,
      attachFileFromUrl,
    };
  }

  it('creates WRAP_OKLEYKA task, target, and attachments when none open', async () => {
    const result = await createWrapOkleykaTask(
      {
        lineItemId: 'li-1',
        opportunityId: 'opp-1',
        text: 'Заказ: t',
        fileUrls: ['https://cdn.example.com/a.jpg'],
        force: false,
      },
      deps(),
    );

    expect(findOpenTasksByKindAndLineItem).toHaveBeenCalledWith({
      taskKind: 'WRAP_OKLEYKA',
      lineItemId: 'li-1',
    });
    expect(createTask).toHaveBeenCalledWith({
      title: 'Оклейка: Позиция',
      taskKind: 'WRAP_OKLEYKA',
      body: 'Заказ: t',
    });
    expect(createTask.mock.calls[0][0]).not.toHaveProperty('assigneeId');
    expect(createTaskTarget).toHaveBeenCalledWith({
      taskId: 'task-new',
      dealLineItemId: 'li-1',
    });
    expect(attachFileFromUrl).toHaveBeenCalledWith({
      taskId: 'task-new',
      url: 'https://cdn.example.com/a.jpg',
    });
    expect(updateTask).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'task-new' });
  });

  it('no-ops when an open wrap task exists and force is false', async () => {
    findOpenTasksByKindAndLineItem.mockResolvedValue([
      { id: 'task-open', status: 'TODO', pipelineStage: 'NEW', taskKind: 'WRAP_OKLEYKA' },
    ]);

    const result = await createWrapOkleykaTask(
      {
        lineItemId: 'li-1',
        text: 'Заказ: t',
        fileUrls: ['https://cdn.example.com/a.jpg'],
        force: false,
      },
      deps(),
    );

    expect(result).toEqual({ id: 'task-open' });
    expect(createTask).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
    expect(attachFileFromUrl).not.toHaveBeenCalled();
  });

  it('updates open wrap task body and attachments when force is true', async () => {
    findOpenTasksByKindAndLineItem.mockResolvedValue([
      { id: 'task-open', status: 'TODO', pipelineStage: 'NEW', taskKind: 'WRAP_OKLEYKA' },
    ]);

    const result = await createWrapOkleykaTask(
      {
        lineItemId: 'li-1',
        text: 'Заказ: updated',
        fileUrls: ['https://cdn.example.com/b.jpg'],
        force: true,
      },
      deps(),
    );

    expect(createTask).not.toHaveBeenCalled();
    expect(createTaskTarget).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenCalledWith('task-open', {
      bodyV2: { markdown: 'Заказ: updated' },
    });
    expect(attachFileFromUrl).toHaveBeenCalledWith({
      taskId: 'task-open',
      url: 'https://cdn.example.com/b.jpg',
    });
    expect(result).toEqual({ id: 'task-open' });
  });
});
