#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDokployClient } from './lib/dokploy-client.js';
import {
  wrapRemoteScript,
  buildSyncScript,
  runScheduleJob,
} from './lib/schedule-remote.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNC_RELATIVE_PATHS = [
  'restore-host.sh',
  'lib/pg-restore-format.sh',
  'lib/manifest.js',
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function clientFromEnv() {
  return createDokployClient({
    baseUrl: requireEnv('DOKPLOY_URL'),
    apiKey: requireEnv('DOKPLOY_API_KEY'),
  });
}

async function cmdSync() {
  const scheduleId = requireEnv('DOKPLOY_SCHEDULE_OPS_SYNC');
  const files = SYNC_RELATIVE_PATHS.map((relativePath) => ({
    relativePath,
    content: readFileSync(resolve(__dirname, relativePath), 'utf8'),
  }));
  const script = buildSyncScript(files);
  const result = await runScheduleJob({
    client: clientFromEnv(),
    scheduleId,
    script,
    timeoutMs: Number(process.env.REMOTE_TIMEOUT_MS || 600_000),
  });
  process.stdout.write(result.logs);
}

async function cmdRun(argv) {
  const envName = (() => {
    const i = argv.indexOf('--schedule-env');
    return i >= 0 ? argv[i + 1] : 'DOKPLOY_SCHEDULE_OPS_RUN';
  })();
  const scheduleId = requireEnv(envName);
  let body;
  const fileIdx = argv.indexOf('--script-file');
  if (fileIdx >= 0) {
    body = readFileSync(argv[fileIdx + 1], 'utf8');
  } else {
    body = readFileSync(0, 'utf8');
  }
  const timeoutMs = Number(process.env.REMOTE_TIMEOUT_MS || 2_700_000);
  const result = await runScheduleJob({
    client: clientFromEnv(),
    scheduleId,
    script: wrapRemoteScript(body),
    timeoutMs,
  });
  process.stdout.write(result.logs);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'sync') await cmdSync();
  else if (cmd === 'run') await cmdRun(rest);
  else {
    console.error('Usage: remote-run.mjs sync | run [--schedule-env NAME] [--script-file PATH]');
    process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(`[remote-run] ERROR: ${err.message}\n`);
  process.exit(1);
});
