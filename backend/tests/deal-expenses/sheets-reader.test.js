import { describe, it, expect, vi } from 'vitest';
import { fetchSpreadsheetWorkbook } from '../../src/services/deal-expenses/sheets-reader.js';

describe('fetchSpreadsheetWorkbook', () => {
  it('parses grid data and extracts hyperlinks', async () => {
    const spreadsheetId = 'spreadsheet-id-1234567890abcdefghij';
    const mockClient = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: {
            sheets: [
              {
                properties: { title: 'Tab1' },
                data: [
                  {
                    rowData: [
                      {
                        values: [
                          { formattedValue: 'Name' },
                          { formattedValue: 'Link' },
                        ],
                      },
                      {
                        values: [
                          { formattedValue: 'Deal A' },
                          {
                            formattedValue: 'Open',
                            hyperlink:
                              'https://apihide.com/crm/deal/details/169120/',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      },
    };

    const workbook = await fetchSpreadsheetWorkbook(mockClient, spreadsheetId);

    expect(mockClient.spreadsheets.get).toHaveBeenCalledWith({
      spreadsheetId,
      includeGridData: true,
      fields:
        'sheets.properties.title,sheets.data.rowData.values(formattedValue,hyperlink)',
    });

    expect(workbook.SheetNames).toEqual(['Tab1']);
    expect(workbook.name).toBe(spreadsheetId);

    const meta = workbook.getSheetMeta('Tab1');
    expect(meta.data).toEqual([
      ['Name', 'Link'],
      ['Deal A', 'Open'],
    ]);
    expect(meta.sheet).toBeNull();
    expect(meta.hyperlinks.get('1:1')).toBe(
      'https://apihide.com/crm/deal/details/169120/',
    );
  });

  it('returns empty data for unknown sheet name', async () => {
    const mockClient = {
      spreadsheets: {
        get: vi.fn().mockResolvedValue({
          data: { sheets: [] },
        }),
      },
    };

    const workbook = await fetchSpreadsheetWorkbook(
      mockClient,
      'abcdefghijklmnopqrstuvwxyz12',
    );
    const meta = workbook.getSheetMeta('Missing');

    expect(meta.data).toEqual([]);
    expect(meta.sheet).toBeNull();
    expect(meta.hyperlinks.size).toBe(0);
  });
});
