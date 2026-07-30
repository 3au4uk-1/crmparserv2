/**
 * One-shot GramJS login → prints TELEGRAM_USER_SESSION (StringSession).
 * Run only on a trusted machine; paste the output into Dokploy secrets.
 *
 * Usage (from repo root):
 *   TELEGRAM_API_ID=... TELEGRAM_API_HASH=... node backend/scripts/telegram-userbot-login.mjs
 * Or put api_id/hash in repo .env and run:
 *   node backend/scripts/telegram-userbot-login.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import readline from 'readline/promises';
import { stdin, stdout } from 'process';
import { fileURLToPath } from 'url';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
dotenv.config({ path: path.join(repoRoot, '.env') });

const apiIdRaw = process.env.TELEGRAM_API_ID?.trim();
const apiHash = process.env.TELEGRAM_API_HASH?.trim();

if (!apiIdRaw || !apiHash) {
  console.error(
    'Missing TELEGRAM_API_ID or TELEGRAM_API_HASH.\n' +
      'Set them in repo .env or export before running this script.',
  );
  process.exit(1);
}

const apiId = Number(apiIdRaw);
if (!Number.isFinite(apiId) || apiId <= 0) {
  console.error('TELEGRAM_API_ID must be a positive integer.');
  process.exit(1);
}

const rl = readline.createInterface({ input: stdin, output: stdout });

try {
  console.log('Telegram user-bot login (GramJS StringSession generator)');
  console.log('Obtain api_id / api_hash at https://my.telegram.org\n');

  const client = new TelegramClient(new StringSession(''), apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => rl.question('Phone number (international, e.g. +79001234567): '),
    phoneCode: async () => rl.question('Login code from Telegram: '),
    password: async () => rl.question('2FA password (leave empty if none): '),
    onError: (err) => console.error(err),
  });

  const session = client.session.save();
  if (!session) {
    console.error('Login finished but session string is empty.');
    process.exit(1);
  }

  console.log('\n--- TELEGRAM_USER_SESSION (copy once, store in Dokploy secrets) ---\n');
  console.log(session);
  console.log('\n--- end ---\n');
  console.log('Do not commit this string. Redeploy crmparser after setting env vars.');
} finally {
  rl.close();
}
