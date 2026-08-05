import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { CRM_TIMEZONE } from '../src/utils/crm-dates.js';

const scheduleMock = vi.fn();
const stopMock = vi.fn();
const runPrintSheetCycleMock = vi.fn();
const createTwentyGqlClientMock = vi.fn();
const requireTwentyConfigMock = vi.fn();

vi.mock('node-cron', () => ({
  default: {
    schedule: (...args) => scheduleMock(...args),
  },
}));

vi.mock('../src/services/print-sheet-cycle.js', () => ({
  runPrintSheetCycle: (...args) => runPrintSheetCycleMock(...args),
}));

vi.mock('../src/services/twenty-gql.js', () => ({
  createTwentyGqlClient: (...args) => createTwentyGqlClientMock(...args),
}));

vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: (...args) => requireTwentyConfigMock(...args),
}));

import { initPrintSheetCron, runPrintSheetRefresh } from '../src/services/print-sheet-cron.js';
import { __resetPrintSheetRunnerForTests } from '../src/services/print-sheet-runner.js';

describe('print-sheet-cron', () => {
  const originalPrintSheetId = config.printSheetId;
  const originalGoogleEmail = config.googleServiceAccountEmail;
  const originalGoogleKey = config.googleServiceAccountPrivateKey;

  beforeEach(() => {
    __resetPrintSheetRunnerForTests();
    scheduleMock.mockReset();
    stopMock.mockReset();
    runPrintSheetCycleMock.mockReset();
    createTwentyGqlClientMock.mockReset();
    requireTwentyConfigMock.mockReset();

    scheduleMock.mockReturnValue({ stop: stopMock });
    createTwentyGqlClientMock.mockReturnValue(vi.fn());
    requireTwentyConfigMock.mockReturnValue({
      apiUrl: 'https://twenty.test/graphql',
      apiToken: 'token',
    });

    config.printSheetId = originalPrintSheetId;
    config.googleServiceAccountEmail = originalGoogleEmail;
    config.googleServiceAccountPrivateKey = originalGoogleKey;
  });

  it('skips refresh when print sheet id is missing', async () => {
    config.printSheetId = '';
    config.googleServiceAccountEmail = 'service@test.local';
    config.googleServiceAccountPrivateKey = 'key';

    await runPrintSheetRefresh();

    expect(requireTwentyConfigMock).not.toHaveBeenCalled();
    expect(runPrintSheetCycleMock).not.toHaveBeenCalled();
  });

  it('skips refresh when Google credentials are missing', async () => {
    config.printSheetId = 'sheet-id';
    config.googleServiceAccountEmail = '';
    config.googleServiceAccountPrivateKey = '';

    await runPrintSheetRefresh();

    expect(requireTwentyConfigMock).not.toHaveBeenCalled();
    expect(runPrintSheetCycleMock).not.toHaveBeenCalled();
  });

  it('runs print sheet cycle when configured', async () => {
    config.printSheetId = 'sheet-id';
    config.googleServiceAccountEmail = 'service@test.local';
    config.googleServiceAccountPrivateKey = 'private-key';

    const gqlClient = vi.fn();
    createTwentyGqlClientMock.mockReturnValue(gqlClient);
    runPrintSheetCycleMock.mockResolvedValue({
      exported: 2,
      readbackUpdated: 1,
      sessionsCleared: 0,
    });

    await runPrintSheetRefresh();

    expect(createTwentyGqlClientMock).toHaveBeenCalledWith(
      'https://twenty.test/graphql',
      'token'
    );
    expect(runPrintSheetCycleMock).toHaveBeenCalledWith(gqlClient);
  });

  it('schedules cron each minute in CRM timezone', () => {
    config.printSheetId = 'sheet-id';

    initPrintSheetCron();

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const [expression, callback, options] = scheduleMock.mock.calls[0];
    expect(expression).toBe('* * * * *');
    expect(typeof callback).toBe('function');
    expect(options).toEqual({ timezone: CRM_TIMEZONE });
  });

  it('skips overlapping refresh and runs once more when dirty', async () => {
    config.printSheetId = 'sheet-id';
    config.googleServiceAccountEmail = 'service@test.local';
    config.googleServiceAccountPrivateKey = 'private-key';

    let release;
    let callCount = 0;
    runPrintSheetCycleMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          callCount += 1;
          if (callCount === 1) {
            release = () => resolve({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });
            return;
          }
          resolve({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });
        }),
    );

    const first = runPrintSheetRefresh();
    const second = runPrintSheetRefresh();
    await Promise.resolve();
    expect(runPrintSheetCycleMock).toHaveBeenCalledTimes(1);

    release();
    await first;
    await second;
    expect(runPrintSheetCycleMock).toHaveBeenCalledTimes(2);
  });

  it('logs cycle result', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    config.printSheetId = 'sheet-id';
    config.googleServiceAccountEmail = 'service@test.local';
    config.googleServiceAccountPrivateKey = 'private-key';

    const gqlClient = vi.fn();
    createTwentyGqlClientMock.mockReturnValue(gqlClient);
    runPrintSheetCycleMock.mockResolvedValue({
      exported: 1,
      readbackUpdated: 2,
      sessionsCleared: 0,
    });

    await runPrintSheetRefresh();

    expect(logSpy).toHaveBeenCalledWith('[print-sheet] cycle done', {
      exported: 1,
      readbackUpdated: 2,
      sessionsCleared: 0,
    });

    logSpy.mockRestore();
  });
});
