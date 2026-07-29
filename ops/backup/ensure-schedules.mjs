#!/usr/bin/env node
import { createDokployClient } from './lib/dokploy-client.js';

const PLACEHOLDER_SCRIPT = "set -euo pipefail\necho '[remote-ok]'\n";

const SCHEDULES = [
  { name: 'ops-backup-sync', envVar: 'DOKPLOY_SCHEDULE_OPS_SYNC' },
  { name: 'ops-backup-run', envVar: 'DOKPLOY_SCHEDULE_OPS_RUN' },
];

function requireEnv(name) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function parseScheduleId(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.scheduleId) return result.scheduleId;
  if (result.id) return result.id;
  if (result.schedule?.scheduleId) return result.schedule.scheduleId;
  if (result.schedule?.id) return result.schedule.id;
  return null;
}

function findScheduleByName(list, name) {
  const schedules = Array.isArray(list) ? list : list?.schedules ?? [];
  return schedules.find((s) => s.name === name) ?? null;
}

async function resolveScheduleId(client, serverId, name, createResult) {
  const direct = parseScheduleId(createResult);
  if (direct) return direct;

  const list = await client.scheduleList(serverId, 'server');
  const match = findScheduleByName(list, name);
  const fromList = match?.scheduleId ?? match?.id ?? null;
  if (fromList) return fromList;

  throw new Error(`Could not resolve schedule id for ${name}`);
}

async function createSchedule(client, serverId, name) {
  return client.scheduleCreate({
    name,
    description: 'crmparser ops backup (manual only)',
    cronExpression: '0 0 1 1 *',
    command: 'true',
    script: PLACEHOLDER_SCRIPT,
    scheduleType: 'server',
    serverId,
    enabled: false,
    shellType: 'bash',
    timezone: 'UTC',
  });
}

async function main() {
  const syncId = process.env.DOKPLOY_SCHEDULE_OPS_SYNC?.trim();
  const runId = process.env.DOKPLOY_SCHEDULE_OPS_RUN?.trim();

  if (syncId && runId) {
    console.log(`DOKPLOY_SCHEDULE_OPS_SYNC=${syncId}`);
    console.log(`DOKPLOY_SCHEDULE_OPS_RUN=${runId}`);
    return;
  }

  const serverId = requireEnv('DOKPLOY_SERVER_ID');
  const client = createDokployClient({
    baseUrl: requireEnv('DOKPLOY_URL'),
    apiKey: requireEnv('DOKPLOY_API_KEY'),
  });

  const ids = {};
  for (const { name, envVar } of SCHEDULES) {
    const existing = process.env[envVar]?.trim();
    if (existing) {
      ids[envVar] = existing;
      continue;
    }
    const result = await createSchedule(client, serverId, name);
    ids[envVar] = await resolveScheduleId(client, serverId, name, result);
  }

  console.log(`DOKPLOY_SCHEDULE_OPS_SYNC=${ids.DOKPLOY_SCHEDULE_OPS_SYNC}`);
  console.log(`DOKPLOY_SCHEDULE_OPS_RUN=${ids.DOKPLOY_SCHEDULE_OPS_RUN}`);
}

main().catch((err) => {
  process.stderr.write(`[ensure-schedules] ERROR: ${err.message}\n`);
  process.exit(1);
});
