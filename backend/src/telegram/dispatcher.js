import { listHooks } from './hooks.js';

export async function emit(event, ctx = {}) {
  const hooks = listHooks(event);
  for (const hook of hooks) {
    await hook(ctx);
  }
  return ctx;
}
