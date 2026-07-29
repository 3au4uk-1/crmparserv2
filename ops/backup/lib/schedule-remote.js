export const HOST_OPS_ROOT = '/etc/dokploy/ops-backup';
export const REMOTE_OK_MARKER = '[remote-ok]';

export function wrapRemoteScript(bodyScript) {
  return `set -euo pipefail\n${bodyScript}\necho '${REMOTE_OK_MARKER}'`;
}

/** Heredoc delimiter unlikely to appear in synced ops files (restore-host.sh uses EOF). */
export const SYNC_HEREDOC_DELIMITER = 'CRMOPS_SYNC_EOF';

export function buildSyncScript(files, hostRoot = HOST_OPS_ROOT) {
  const delim = SYNC_HEREDOC_DELIMITER;
  for (const file of files) {
    if (
      file.content.split(/\r?\n/).some((line) => line === delim)
    ) {
      throw new Error(
        `File content must not contain a line that is exactly ${delim}: ${file.relativePath}`,
      );
    }
  }

  const parts = [];
  const dirs = new Set();

  for (const file of files) {
    const fullPath = `${hostRoot}/${file.relativePath}`;
    const lastSlash = fullPath.lastIndexOf('/');
    if (lastSlash > 0) {
      dirs.add(fullPath.slice(0, lastSlash));
    }
  }

  for (const dir of [...dirs].sort()) {
    parts.push(`mkdir -p '${dir}'`);
  }

  for (const file of files) {
    const fullPath = `${hostRoot}/${file.relativePath}`;
    parts.push(`cat > '${fullPath}' <<'${delim}'`);
    parts.push(file.content.replace(/\r?\n$/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
    parts.push(delim);
    if (file.relativePath.endsWith('.sh')) {
      parts.push(`chmod +x '${fullPath}'`);
    }
  }

  parts.push(`ls -la '${hostRoot}'`);

  return wrapRemoteScript(parts.join('\n'));
}

export function parseRemoteOk(logs) {
  return logs.split('\n').some((line) => line === REMOTE_OK_MARKER);
}

export function parseMarkerValue(logs, key) {
  const match = logs.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match ? match[1] : null;
}

export function normalizeDeployments(data) {
  let list = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object' && Array.isArray(data.deployments)) {
    list = data.deployments;
  }
  return list.map((d) => ({
    deploymentId: d.deploymentId ?? d.id,
    status: d.status,
    createdAt: d.createdAt,
  }));
}

export function pickNewestDeployment(list) {
  if (!list?.length) return null;
  return [...list].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  })[0];
}

export function isTerminalStatus(status) {
  return status === 'done' || status === 'error';
}

function normalizeLogs(rawLogs) {
  if (typeof rawLogs === 'string') return rawLogs;
  if (rawLogs && typeof rawLogs === 'object' && typeof rawLogs.logs === 'string') {
    return rawLogs.logs;
  }
  return String(rawLogs ?? '');
}

function pickRunDeployment(deployments, startedAt) {
  const threshold = startedAt.getTime() - 2000;
  const eligible = deployments.filter((d) => {
    if (!d.createdAt) return false;
    const createdMs = new Date(d.createdAt).getTime();
    if (createdMs >= threshold) return true;
    return !isTerminalStatus(d.status);
  });
  if (eligible.length === 0) return null;
  return pickNewestDeployment(eligible);
}

function logTail(logs, lines = 20) {
  const parts = logs.split('\n');
  return parts.slice(Math.max(0, parts.length - lines)).join('\n');
}

export async function runScheduleJob({
  client,
  scheduleId,
  script,
  command,
  pollIntervalMs = 5000,
  timeoutMs = 300000,
  now = () => new Date(),
}) {
  await client.scheduleUpdate({
    scheduleId,
    script,
    command: command ?? 'bash',
    shellType: 'bash',
  });

  const startedAt = now();
  await client.scheduleRunManually(scheduleId);

  const deadline = startedAt.getTime() + timeoutMs;
  let deployment = null;

  while (now().getTime() < deadline) {
    const raw = await client.deploymentAllByType(scheduleId, 'schedule');
    deployment = pickRunDeployment(normalizeDeployments(raw), startedAt);

    if (deployment && isTerminalStatus(deployment.status)) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  if (!deployment) {
    throw new Error('Schedule job: no deployment found');
  }

  if (!isTerminalStatus(deployment.status)) {
    throw new Error(
      `Schedule job timed out (deployment ${deployment.deploymentId} status=${deployment.status})`,
    );
  }

  const logs = normalizeLogs(await client.deploymentReadLogs(deployment.deploymentId));

  if (deployment.status !== 'done' || !parseRemoteOk(logs)) {
    throw new Error(
      `Schedule job failed (status=${deployment.status}, remote-ok=${parseRemoteOk(logs)}): ${logTail(logs)}`,
    );
  }

  return {
    deploymentId: deployment.deploymentId,
    status: deployment.status,
    logs,
  };
}
