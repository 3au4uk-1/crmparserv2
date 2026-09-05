import { registerHook } from './hooks.js';
import { handleWorkRequestInbound } from './work-requests/handle-inbound.js';

export function registerDefaultTelegramHooks() {
  registerHook('okleyka.send.after', async () => {});
  registerHook('telegram.inbound', async (ctx) => {
    await handleWorkRequestInbound(ctx);
  });
}
