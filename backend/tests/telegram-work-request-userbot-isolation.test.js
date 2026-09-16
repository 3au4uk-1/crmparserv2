import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../src/telegram/userbot');
const files = [
  'mention-forward.js',
  'digest-commands.js',
  'team-app-mirror.js',
  'actions.js',
  'client.js',
];

describe('userbot does not own work requests', () => {
  it('does not import work-requests inbound', () => {
    for (const f of files) {
      const src = readFileSync(path.join(root, f), 'utf8');
      expect(src).not.toMatch(/work-requests\/handle-inbound/);
      expect(src).not.toMatch(/createTelegramRequest/);
    }
  });
});
