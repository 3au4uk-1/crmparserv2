function parseSheetGrid(sheet) {
  const data = [];
  const hyperlinks = new Map();
  const rowData = sheet.data?.[0]?.rowData || [];

  for (let rowIndex = 0; rowIndex < rowData.length; rowIndex++) {
    const values = rowData[rowIndex]?.values || [];
    const row = [];

    for (let colIndex = 0; colIndex < values.length; colIndex++) {
      const cell = values[colIndex];
      row.push(cell?.formattedValue ?? '');

      if (cell?.hyperlink) {
        hyperlinks.set(`${rowIndex}:${colIndex}`, cell.hyperlink);
      }
    }

    data.push(row);
  }

  return { data, hyperlinks };
}

export async function fetchSpreadsheetWorkbook(client, spreadsheetId) {
  const response = await client.spreadsheets.get({
    spreadsheetId,
    includeGridData: true,
    fields: 'sheets.properties.title,sheets.data.rowData.values(formattedValue,hyperlink)',
  });

  const sheetMap = new Map();
  for (const sheet of response.data.sheets || []) {
    const title = sheet.properties?.title;
    if (!title) continue;
    sheetMap.set(title, parseSheetGrid(sheet));
  }

  const sheetNames = [...sheetMap.keys()];

  return {
    SheetNames: sheetNames,
    name: spreadsheetId,
    getSheetMeta(sheetName) {
      const parsed = sheetMap.get(sheetName);
      if (!parsed) {
        return { data: [], sheet: null, hyperlinks: new Map() };
      }
      return { data: parsed.data, sheet: null, hyperlinks: parsed.hyperlinks };
    },
  };
}
