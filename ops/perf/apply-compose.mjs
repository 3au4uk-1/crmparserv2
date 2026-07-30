#!/usr/bin/env node
// Usage: node ops/perf/apply-compose.mjs <composeId> --set-compose <path-to-full-compose.yaml> [--deploy]
// Prints current compose, writes new compose via compose.update, optionally deploys.
import { readFileSync } from 'node:fs';
import { createDokployClient } from '../backup/lib/dokploy-client.js';

const [composeId, flag, file] = process.argv.slice(2);
if (!composeId || flag !== '--set-compose' || !file) {
  console.error('Usage: apply-compose.mjs <composeId> --set-compose <file.yaml> [--deploy]');
  process.exit(2);
}
const deploy = process.argv.includes('--deploy');
const client = createDokployClient({ baseUrl: process.env.DOKPLOY_URL, apiKey: process.env.DOKPLOY_API_KEY });
const current = await client.composeOne(composeId);
console.error('--- CURRENT compose.type/appName ---', current.composeType, current.appName);
const composeFile = readFileSync(file, 'utf8');
await client.composeUpdate({ composeId, composeFile });
console.error('[updated] composeFile set');
if (deploy) {
  const r = await client.composeDeploy(composeId, 'perf tuning', 'apply perf compose');
  console.error('[deploy] triggered', JSON.stringify(r));
}
