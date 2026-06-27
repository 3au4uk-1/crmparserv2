import { beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';
import { CRM_TIMEZONE } from '../src/utils/crm-dates.js';

const scheduleMock = vi.fn();
const stopMock = vi.fn();
const listLineItemsInPrintStageMock = vi.fn();
const refreshPlenkaForLineItemMock = vi.fn();
const createTwentyGqlClientMock = vi.fn();
const requireTwentyConfigMock = vi.fn();

vi.mock('node-cron', () => ({
  default: {
    schedule: (...args) => scheduleMock(...args),
  },
}));

vi.mock('../src/services/print-sheet-twenty.js', () => ({
  listLineItemsInPrintStage: (...args) => listLineItemsInPrintStageMock(...args),
  refreshPlenkaForLineItem: (...args) => refreshPlenkaForLineItemMock(...args),
}));

vi.mock('../src/services/twenty-gql.js', () => ({
  createTwentyGqlClient: (...args) => createTwentyGqlClientMock(...args),
}));

vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: (...args) => requireTwentyConfigMock(...args),
}));

import { initPrintSheetCron, runPrintSheetRefresh } from '../src/services/print-sheet-cron.js';

describe('print-sheet-cron', () => {
  const originalPrintSheetId = config.printSheetId;
  const originalGoogleEmail = config.googleServiceAccountEmail;
  const originalGoogleKey = config.googleServiceAccountPrivateKey;

  beforeEach(() => {
    scheduleMock.mockReset();
    stopMock.mockReset();
    listLineItemsInPrintStageMock.mockReset();
    refreshPlenkaForLineItemMock.mockReset();
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
    expect(listLineItemsInPrintStageMock).not.toHaveBeenCalled();
  });

  it('skips refresh when Google credentials are missing', async () => {
    config.printSheetId = 'sheet-id';
    config.googleServiceAccountEmail = '';
    config.googleServiceAccountPrivateKey = '';

    await runPrintSheetRefresh();

    expect(requireTwentyConfigMock).not.toHaveBeenCalled();
    expect(listLineItemsInPrintStageMock).not.toHaveBeenCalled();
  });

  it('refreshes each print-stage line item when configured', async () => {
    config.printSheetId = 'sheet-id';
    config.googleServiceAccountEmail = 'service@test.local';
    config.googleServiceAccountPrivateKey = 'private-key';

    const gqlClient = vi.fn();
    const lineItems = [{ id: 'li-1' }, { id: 'li-2' }];

    createTwentyGqlClientMock.mockReturnValue(gqlClient);
    listLineItemsInPrintStageMock.mockResolvedValue(lineItems);
    refreshPlenkaForLineItemMock.mockResolvedValue(undefined);

    await runPrintSheetRefresh();

    expect(createTwentyGqlClientMock).toHaveBeenCalledWith(
      'https://twenty.test/graphql',
      'token'
    );
    expect(listLineItemsInPrintStageMock).toHaveBeenCalledWith(gqlClient);
    expect(refreshPlenkaForLineItemMock).toHaveBeenCalledTimes(2);
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
});
