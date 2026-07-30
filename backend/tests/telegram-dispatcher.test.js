import { beforeEach, describe, expect, it } from 'vitest';
import { clearHooksForTests, listHooks, registerHook } from '../src/telegram/hooks.js';
import { emit } from '../src/telegram/dispatcher.js';

describe('telegram dispatcher', () => {
  beforeEach(() => clearHooksForTests());

  it('runs hooks in registration order and shares ctx', async () => {
    const order = [];
    registerHook('okleyka.send', async (ctx) => {
      order.push('a');
      ctx.mark = 'from-a';
    });
    registerHook('okleyka.send', async (ctx) => {
      order.push('b');
      ctx.result = { ok: true, from: ctx.mark };
    });
    const ctx = await emit('okleyka.send', { lineItemId: 'li-1' });
    expect(order).toEqual(['a', 'b']);
    expect(listHooks('okleyka.send')).toHaveLength(2);
    expect(ctx.result).toEqual({ ok: true, from: 'from-a' });
  });

  it('no-ops when no hooks registered', async () => {
    const ctx = await emit('unknown', { x: 1 });
    expect(ctx).toEqual({ x: 1 });
  });
});
