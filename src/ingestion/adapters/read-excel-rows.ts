import ExcelJS from 'exceljs';

// ExcelJS parses a sheet as soon as shared strings and relationships are ready,
// which can happen before workbook.xml has set `model`. The sheet name is
// optional; the row stream still works once model exists.
const workbookReader = ExcelJS.stream.xlsx.WorkbookReader.prototype as unknown as {
  _parseWorksheet: (iterator: unknown, sheetNo: string) => Generator;
  __modelGuard?: boolean;
};
if (!workbookReader.__modelGuard) {
  const parseWorksheet = workbookReader._parseWorksheet;
  workbookReader._parseWorksheet = function parseGuarded(
    this: { model?: { sheets?: unknown[] } },
    iterator: unknown,
    sheetNo: string,
  ) {
    if (!this.model) {
      this.model = { sheets: [] };
    }
    return parseWorksheet.call(this, iterator, sheetNo);
  };
  workbookReader.__modelGuard = true;
}

/** Header cells from the first worksheet, without reading the data rows into memory. */
export async function readExcelHeaders(filePath: string): Promise<string[]> {
  const reader = openWorkbook(filePath);
  for await (const worksheet of reader) {
    for await (const row of worksheet) {
      return headerNames(row).map(([, name]) => name);
    }
    return [];
  }
  return [];
}

/**
 * Streams the first worksheet. The header row is not yielded.
 * Each yield is one data row keyed by header.
 */
export async function* readExcelRows(
  filePath: string,
): AsyncGenerator<Record<string, unknown>> {
  const reader = openWorkbook(filePath);

  for await (const worksheet of reader) {
    let headers: Array<[number, string]> | null = null;
    for await (const row of worksheet) {
      if (!headers) {
        headers = headerNames(row);
        continue;
      }
      const record: Record<string, unknown> = {};
      for (const [column, header] of headers) {
        record[header] = cellValue(row.getCell(column));
      }
      yield record;
    }
    return;
  }
}

function openWorkbook(filePath: string): ExcelJS.stream.xlsx.WorkbookReader {
  return new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'cache',
    entries: 'emit',
  });
}

function headerNames(row: ExcelJS.Row): Array<[number, string]> {
  const used = new Set<string>();
  const headers: Array<[number, string]> = [];
  row.eachCell({ includeEmpty: false }, (cell, column) => {
    const raw = cellText(cell.value).replace(/^\uFEFF/, '').trim();
    const base = raw || `column_${column}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
      name = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(name);
    headers.push([column, name]);
  });
  return headers;
}

function cellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value instanceof Date) {
    const text = cell.text?.trim();
    return text || value.toISOString().slice(0, 10);
  }
  return scalarValue(value);
}

function scalarValue(value: ExcelJS.CellValue): unknown {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'object' && 'richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  if (typeof value === 'object' && 'text' in value && 'hyperlink' in value) {
    return value.text;
  }
  if (typeof value === 'object' && 'formula' in value) {
    return scalarValue(value.result ?? null);
  }
  if (typeof value === 'object' && 'sharedFormula' in value) {
    return scalarValue(value.result ?? null);
  }
  return null;
}

function cellText(value: ExcelJS.CellValue): string {
  const scalar = scalarValue(value);
  if (scalar == null) {
    return '';
  }
  return String(scalar);
}
