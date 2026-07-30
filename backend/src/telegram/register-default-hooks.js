import { registerHook } from './hooks.js';

export function registerDefaultTelegramHooks() {
  // Extension points for future stage→chat / inbound handlers.
  registerHook('okleyka.send.after', async () => {});
  registerHook('telegram.inbound', async () => {});
}
