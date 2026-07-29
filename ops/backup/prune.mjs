#!/usr/bin/env node
import { createDokployClient } from './lib/dokploy-client.js';
import { normalizeBackupFileList } from './lib/backup-files.js';
import { extractSnapshotPrefixesFromKeys, listExpiredSnapshotPrefixes } from './lib/prune.js';

const FULL_SNAPSHOTS_SEARCH = 'full-snapshots/';

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} required`);
  return v;
}

function parseArgs(argv) {
  let retentionDays = 7;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--retention-days' && argv[i + 1]) {
      retentionDays = Number(argv[++i]);
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  if (!Number.isFinite(retentionDays) || retentionDays < 1) {
    throw new Error('--retention-days must be a positive number');
  }
  return { retentionDays };
}

function printHelp() {
  console.log(`Usage: node prune.mjs [--retention-days 7]

Lists snapshot folder prefixes older than retention (default 7 days).
Outputs JSON to stdout: { "expiredPrefixes": ["full-snapshots/YYYYMMDDTHHMMSSZ/", ...] }

Deletion is performed by the GitHub workflow (mc rm --recursive over SSH) — see README.

Environment:
  DOKPLOY_URL, DOKPLOY_API_KEY, DOKPLOY_DESTINATION_ID (required)
`);
}

async function prune({ retentionDays }) {
  const destinationId = requireEnv('DOKPLOY_DESTINATION_ID');
  const client = createDokployClient({
    baseUrl: process.env.DOKPLOY_URL,
    apiKey: process.env.DOKPLOY_API_KEY,
  });

  const raw = await client.listBackupFiles(destinationId, FULL_SNAPSHOTS_SEARCH);
  const keys = normalizeBackupFileList(raw);
  const prefixes = extractSnapshotPrefixesFromKeys(keys);
  const expiredPrefixes = listExpiredSnapshotPrefixes(prefixes, new Date(), retentionDays);

  const payload = { expiredPrefixes };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

  if (expiredPrefixes.length > 0) {
    process.stderr.write(
      `[prune] ${expiredPrefixes.length} expired prefix(es); workflow should delete via mc rm --recursive\n`,
    );
  } else {
    process.stderr.write('[prune] no expired snapshot prefixes\n');
  }
}

const args = parseArgs(process.argv);
prune(args).catch((err) => {
  process.stderr.write(`[prune] ERROR: ${err.message}\n`);
  process.exit(1);
});
