#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { createDokployClient } from './lib/dokploy-client.js';
import { buildSnapshotId } from './lib/snapshot-id.js';
import { createManifest } from './lib/manifest.js';
import { normalizeBackupFileList, pollForNewBackupKey } from './lib/backup-files.js';
import { resolveVersions } from './lib/versions.js';

const PG_SEARCH = 'twenty-pg';
const TWENTY_FILES_SEARCH = 'full-snapshots/twenty-files';
const CRMPARSER_SEARCH = 'full-snapshots/crmparser-sqlite';
const PG_TIMEOUT_MS = 10 * 60 * 1000;
const VOLUME_TIMEOUT_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MS = 15_000;

function parseArgs(argv) {
  let out = './manifest.json';
  let skipVersions = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) {
      out = argv[++i];
    } else if (argv[i] === '--skip-versions') {
      skipVersions = true;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return { out, skipVersions };
}

function printHelp() {
  console.log(`Usage: node capture.mjs [--out ./manifest.json] [--skip-versions]

Environment:
  DOKPLOY_URL, DOKPLOY_API_KEY (required)
  DOKPLOY_TWENTY_PG_BACKUP_ID, DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID,
  DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID, DOKPLOY_DESTINATION_ID (required)
  TWENTY_APP_VERSION, CRMPARSER_IMAGE (required unless --skip-versions)
  CRMPARSER_DIGEST (optional)
`);
}

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} required`);
  return v;
}

function loadConfig() {
  return {
    pgBackupId: requireEnv('DOKPLOY_TWENTY_PG_BACKUP_ID'),
    twentyFilesBackupId: requireEnv('DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID'),
    crmparserBackupId: requireEnv('DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID'),
    destinationId: requireEnv('DOKPLOY_DESTINATION_ID'),
  };
}

async function listKeys(client, destinationId, search) {
  const raw = await client.listBackupFiles(destinationId, search);
  return normalizeBackupFileList(raw);
}

async function capture({ out, skipVersions }) {
  const config = loadConfig();
  const client = createDokployClient({
    baseUrl: process.env.DOKPLOY_URL,
    apiKey: process.env.DOKPLOY_API_KEY,
  });

  const snapshotId = buildSnapshotId();
  const createdAt = new Date().toISOString();

  process.stderr.write(`[capture] snapshotId=${snapshotId}\n`);

  const pgBefore = await listKeys(client, config.destinationId, PG_SEARCH);
  process.stderr.write('[capture] triggering PG backup…\n');
  await client.manualBackupCompose(config.pgBackupId);

  const twentyPgKey = await pollForNewBackupKey(
    () => listKeys(client, config.destinationId, PG_SEARCH),
    pgBefore,
    { timeoutMs: PG_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS },
  );
  process.stderr.write(`[capture] PG key: ${twentyPgKey}\n`);

  const filesBefore = await listKeys(client, config.destinationId, TWENTY_FILES_SEARCH);
  const crmparserBefore = await listKeys(client, config.destinationId, CRMPARSER_SEARCH);

  process.stderr.write('[capture] triggering volume backups…\n');
  await Promise.all([
    client.runVolumeBackup(config.twentyFilesBackupId),
    client.runVolumeBackup(config.crmparserBackupId),
  ]);

  const [twentyFilesKey, crmparserKey] = await Promise.all([
    pollForNewBackupKey(
      () => listKeys(client, config.destinationId, TWENTY_FILES_SEARCH),
      filesBefore,
      { timeoutMs: VOLUME_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS },
    ),
    pollForNewBackupKey(
      () => listKeys(client, config.destinationId, CRMPARSER_SEARCH),
      crmparserBefore,
      { timeoutMs: VOLUME_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS },
    ),
  ]);
  process.stderr.write(`[capture] twenty-files key: ${twentyFilesKey}\n`);
  process.stderr.write(`[capture] crmparser key: ${crmparserKey}\n`);

  const versions = resolveVersions(process.env, { skipVersions });

  const manifest = createManifest({
    snapshotId,
    createdAt,
    components: {
      twentyPg: { key: twentyPgKey, source: 'dokploy-compose' },
      twentyFiles: { key: twentyFilesKey, source: 'dokploy-volume' },
      crmparserSqlite: { key: crmparserKey, source: 'dokploy-volume' },
    },
    versions,
  });

  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(out, json, 'utf8');
  process.stdout.write(json);
}

const args = parseArgs(process.argv);
capture(args).catch((err) => {
  process.stderr.write(`[capture] ERROR: ${err.message}\n`);
  process.exit(1);
});
