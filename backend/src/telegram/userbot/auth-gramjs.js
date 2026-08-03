import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { Api } from 'telegram';
import { getGramjsProxy } from '../proxy.js';

/**
 * Production GramJS adapter for interactive login.
 * @returns {import('./auth-login.js').TelegramAuthApi}
 */
export function createGramJsAuthApi() {
  return {
    async sendCode({ apiId, apiHash, phone }) {
      const client = new TelegramClient(
        new StringSession(''),
        Number(apiId),
        apiHash,
        { connectionRetries: 3, ...(getGramjsProxy() ? { proxy: getGramjsProxy(), useWSS: false } : {}) },
      );
      await client.connect();
      const { phoneCodeHash } = await client.sendCode(
        { apiId: Number(apiId), apiHash },
        phone,
      );
      return { phoneCodeHash, clientHandle: client };
    },

    async signIn({ clientHandle, phone, code, phoneCodeHash }) {
      const client = clientHandle;
      try {
        const result = await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: phone,
            phoneCodeHash,
            phoneCode: code,
          }),
        );
        if (result instanceof Api.auth.AuthorizationSignUpRequired) {
          throw Object.assign(new Error('Telegram account registration required'), { status: 400 });
        }
        return { session: client.session.save() };
      } catch (err) {
        if (err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          return { needPassword: true };
        }
        throw err;
      }
    },

    async checkPassword({ clientHandle, password }) {
      const client = clientHandle;
      await client.signInWithPassword(
        { apiId: Number(client.apiId), apiHash: client.apiHash },
        {
          password: async () => password,
          onError: async (err) => {
            throw err;
          },
        },
      );
      return { session: client.session.save() };
    },

    async disconnect(clientHandle) {
      await clientHandle?.disconnect?.();
    },
  };
}
