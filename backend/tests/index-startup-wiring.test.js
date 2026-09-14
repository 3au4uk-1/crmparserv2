import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recoverStaleOkleykaSending } from '../src/telegram/okleyka-outbox.js';
import { kickOkleykaDrain } from '../src/telegram/okleyka-drain.js';
import { initUserbotWatchdog } from '../src/telegram/userbot/reconnect.js';

const indexSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/index.js'),
  'utf8',
);

describe('index.js startup wiring', () => {
  it('exports recoverStaleOkleykaSending as a function', () => {
    expect(typeof recoverStaleOkleykaSending).toBe('function');
  });

  it('exports initUserbotWatchdog as a function', () => {
    expect(typeof initUserbotWatchdog).toBe('function');
  });

  it('exports kickOkleykaDrain as a function', () => {
    expect(typeof kickOkleykaDrain).toBe('function');
  });

  it('calls recoverStaleOkleykaSending(getDb()) after migrate', () => {
    expect(indexSrc).toMatch(/recoverStaleOkleykaSending\(getDb\(\)\)/);
    const migrateIdx = indexSrc.indexOf('migrate()');
    const recoverIdx = indexSrc.indexOf('recoverStaleOkleykaSending(getDb())');
    expect(migrateIdx).toBeGreaterThan(-1);
    expect(recoverIdx).toBeGreaterThan(migrateIdx);
  });

  it('calls initUserbotWatchdog(getDb()) after initDigestCommands', () => {
    expect(indexSrc).toMatch(/initUserbotWatchdog\(getDb\(\)\)/);
    const digestIdx = indexSrc.indexOf('initDigestCommands()');
    const watchdogIdx = indexSrc.indexOf('initUserbotWatchdog(getDb())');
    expect(digestIdx).toBeGreaterThan(-1);
    expect(watchdogIdx).toBeGreaterThan(digestIdx);
  });

  it('kicks okleyka drain after initDigestCommands with catch logging', () => {
    expect(indexSrc).toMatch(
      /void kickOkleykaDrain\(getDb\(\)\)\.catch\(\(err\) => console\.error\('\[telegram\] okleyka drain kick:', err\.message\)\)/,
    );
    const digestIdx = indexSrc.indexOf('initDigestCommands()');
    const kickIdx = indexSrc.indexOf('kickOkleykaDrain(getDb())');
    expect(digestIdx).toBeGreaterThan(-1);
    expect(kickIdx).toBeGreaterThan(digestIdx);
  });

  it('exports initOkleykaDrainTicker as a function', async () => {
    const { initOkleykaDrainTicker } = await import('../src/telegram/okleyka-drain.js');
    expect(typeof initOkleykaDrainTicker).toBe('function');
  });

  it('calls initOkleykaDrainTicker(getDb()) next to the watchdog', () => {
    expect(indexSrc).toMatch(/initOkleykaDrainTicker\(getDb\(\)\)/);
    const watchdogIdx = indexSrc.indexOf('initUserbotWatchdog(getDb())');
    const tickerIdx = indexSrc.indexOf('initOkleykaDrainTicker(getDb())');
    expect(watchdogIdx).toBeGreaterThan(-1);
    expect(tickerIdx).toBeGreaterThan(watchdogIdx);
  });
});
