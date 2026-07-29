import { describe, it, expect, vi } from 'vitest';
import {
  wrapRemoteScript,
  buildSyncScript,
  parseRemoteOk,
  parseMarkerValue,
  normalizeDeployments,
  pickNewestDeployment,
  isTerminalStatus,
  runScheduleJob,
  HOST_OPS_ROOT,
  REMOTE_OK_MARKER,
  SYNC_HEREDOC_DELIMITER,
} from '../lib/schedule-remote.js';

describe('wrapRemoteScript', () => {
  it('adds set -euo pipefail and remote-ok marker', () => {
    const out = wrapRemoteScript('echo hi');
    expect(out.startsWith('set -euo pipefail\n')).toBe(true);
    expect(out).toContain('echo hi');
    expect(out.trimEnd().endsWith(`echo '${REMOTE_OK_MARKER}'`)).toBe(true);
  });
});

describe('buildSyncScript', () => {
  it('writes files under host root with heredocs', () => {
    const script = buildSyncScript([
      { relativePath: 'restore-host.sh', content: '#!/bin/bash\necho x\n' },
      { relativePath: 'lib/manifest.js', content: 'export const x = 1;\n' },
    ]);
    expect(script).toContain(`mkdir -p '${HOST_OPS_ROOT}/lib'`);
    expect(script).toContain(
      `cat > '${HOST_OPS_ROOT}/restore-host.sh' <<'${SYNC_HEREDOC_DELIMITER}'`,
    );
    expect(script).toContain('#!/bin/bash');
    expect(script).toContain(`chmod +x '${HOST_OPS_ROOT}/restore-host.sh'`);
    expect(script).toContain(
      `cat > '${HOST_OPS_ROOT}/lib/manifest.js' <<'${SYNC_HEREDOC_DELIMITER}'`,
    );
  });

  it('allows files that contain a plain EOF heredoc line', () => {
    const script = buildSyncScript([
      { relativePath: 'restore-host.sh', content: "cat <<'EOF'\nhelp\nEOF\n" },
    ]);
    expect(script).toContain("cat <<'EOF'");
    expect(script).toContain(SYNC_HEREDOC_DELIMITER);
  });

  it('throws when file content contains the sync delimiter line', () => {
    expect(() =>
      buildSyncScript([
        {
          relativePath: 'bad.txt',
          content: `hello\n${SYNC_HEREDOC_DELIMITER}\nworld\n`,
        },
      ]),
    ).toThrow(new RegExp(`exactly ${SYNC_HEREDOC_DELIMITER}`));
  });
});

describe('parseRemoteOk / parseMarkerValue', () => {
  it('detects marker line', () => {
    expect(parseRemoteOk('a\n[remote-ok]\n')).toBe(true);
    expect(parseRemoteOk('nope')).toBe(false);
  });
  it('parses KEY=value lines', () => {
    expect(parseMarkerValue('SNAPSHOT_ID=20260729T170122Z\n', 'SNAPSHOT_ID')).toBe(
      '20260729T170122Z',
    );
    expect(parseMarkerValue('x', 'SNAPSHOT_ID')).toBe(null);
  });
});

describe('deployments helpers', () => {
  it('normalizes array payloads and picks newest by createdAt', () => {
    const list = normalizeDeployments([
      { deploymentId: 'a', status: 'done', createdAt: '2026-07-29T10:00:00.000Z' },
      { deploymentId: 'b', status: 'running', createdAt: '2026-07-29T11:00:00.000Z' },
    ]);
    expect(pickNewestDeployment(list).deploymentId).toBe('b');
  });
  it('isTerminalStatus', () => {
    expect(isTerminalStatus('done')).toBe(true);
    expect(isTerminalStatus('error')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
  });
});

describe('runScheduleJob', () => {
  it('updates, runs, polls until done with remote-ok', async () => {
    const client = {
      scheduleUpdate: vi.fn(async () => ({})),
      scheduleRunManually: vi.fn(async () => ({})),
      deploymentAllByType: vi
        .fn()
        .mockResolvedValueOnce([
          { deploymentId: 'd1', status: 'running', createdAt: '2026-07-29T12:00:01.000Z' },
        ])
        .mockResolvedValueOnce([
          { deploymentId: 'd1', status: 'done', createdAt: '2026-07-29T12:00:01.000Z' },
        ]),
      deploymentReadLogs: vi.fn(async () => 'ok\n[remote-ok]\n'),
    };

    const result = await runScheduleJob({
      client,
      scheduleId: 'sch-1',
      script: wrapRemoteScript('echo ok'),
      pollIntervalMs: 1,
      timeoutMs: 1000,
      now: () => new Date('2026-07-29T12:00:00.000Z'),
    });

    expect(client.scheduleUpdate).toHaveBeenCalled();
    expect(client.scheduleRunManually).toHaveBeenCalledWith('sch-1');
    expect(result.status).toBe('done');
    expect(result.logs).toContain('[remote-ok]');
  });

  it('throws when done without remote-ok', async () => {
    const client = {
      scheduleUpdate: vi.fn(async () => ({})),
      scheduleRunManually: vi.fn(async () => ({})),
      deploymentAllByType: vi.fn(async () => [
        { deploymentId: 'd1', status: 'done', createdAt: '2026-07-29T12:00:01.000Z' },
      ]),
      deploymentReadLogs: vi.fn(async () => 'finished without marker\n'),
    };
    await expect(
      runScheduleJob({
        client,
        scheduleId: 'sch-1',
        script: 'echo x',
        pollIntervalMs: 1,
        timeoutMs: 500,
        now: () => new Date('2026-07-29T12:00:00.000Z'),
      }),
    ).rejects.toThrow(/remote-ok/);
  });

  it('throws when deployment status is error even with remote-ok', async () => {
    const client = {
      scheduleUpdate: vi.fn(async () => ({})),
      scheduleRunManually: vi.fn(async () => ({})),
      deploymentAllByType: vi.fn(async () => [
        { deploymentId: 'd1', status: 'error', createdAt: '2026-07-29T12:00:01.000Z' },
      ]),
      deploymentReadLogs: vi.fn(async () => 'failed\n[remote-ok]\n'),
    };
    await expect(
      runScheduleJob({
        client,
        scheduleId: 'sch-1',
        script: 'echo x',
        pollIntervalMs: 1,
        timeoutMs: 500,
        now: () => new Date('2026-07-29T12:00:00.000Z'),
      }),
    ).rejects.toThrow(/Schedule job failed/);
  });
});
