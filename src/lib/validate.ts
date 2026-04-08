import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Readable } from "stream";

export type ValidationError = {
  row: number;
  column: string;
  value: string;
  error: string;
};

export type ValidationReport = {
  errors: ValidationError[];
  errorsCapped: boolean; // true if errors were truncated at MAX_ERRORS
  rowCount: number;
  missingColumns: string[];
  rows: Record<string, string>[];
};

type ColumnDef = {
  name: string;
  dataType: string;
  required: boolean;
  allowedValues?: string[] | null;
  caseSensitive?: boolean | null;
};

/** Maximum validation errors returned. Collection stops after this to prevent OOM. */
const MAX_ERRORS = 100;

/**
 * Excel files must be fully parsed into memory before validation (the xlsx
 * library has no streaming API). Cap at 200 000 rows to prevent OOM for
 * very large spreadsheets. CSV files are streamed and have no row limit.
 */
const EXCEL_MAX_ROWS = 200_000;

// ---------------------------------------------------------------------------
// Type checkers
// ---------------------------------------------------------------------------

function checkValue(value: string, dataType: string): string | null {
  const v = value.trim();

  switch (dataType) {
    case "TEXT":
      return null; // always valid

    case "NUMBER":
      if (v === "" || isNaN(Number(v))) return "Expected a number";
      return null;

    case "INTEGER":
      if (v === "" || !Number.isInteger(Number(v)))
        return "Expected an integer (whole number)";
      return null;

    case "BOOLEAN": {
      const allowed = new Set(["true", "false", "yes", "no", "1", "0"]);
      if (!allowed.has(v.toLowerCase()))
        return "Expected true/false, yes/no, or 1/0";
      return null;
    }

    case "DATE":
      if (v === "" || isNaN(Date.parse(v))) return "Expected a valid date";
      return null;

    case "EMAIL":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
        return "Expected a valid email address";
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Row validation (shared between streaming and batch paths)
// ---------------------------------------------------------------------------

function validateRow(
  row: Record<string, string>,
  rowNumber: number,
  columns: ColumnDef[],
  headerMap: Map<string, string>,
  errors: ValidationError[]
): boolean {
  if (errors.length >= MAX_ERRORS) return false; // caller checks errorsCapped

  for (const col of columns) {
    if (errors.length >= MAX_ERRORS) break;

    const actualHeader = headerMap.get(col.name.toLowerCase());
    const rawValue = actualHeader !== undefined ? row[actualHeader] : undefined;
    if (rawValue === undefined) continue; // missing column tracked separately

    const value = String(rawValue).trim();

    if (col.required && value === "") {
      errors.push({ row: rowNumber, column: col.name, value: "", error: "Required field is empty" });
      continue;
    }
    if (value === "") continue;

    const typeError = checkValue(value, col.dataType);
    if (typeError) {
      errors.push({ row: rowNumber, column: col.name, value, error: typeError });
      continue;
    }

    if (col.allowedValues?.length) {
      const sensitive = col.caseSensitive !== false;
      const match = sensitive
        ? col.allowedValues.includes(value)
        : col.allowedValues.some((v) => v.toLowerCase() === value.toLowerCase());
      if (!match) {
        const sample = col.allowedValues.slice(0, 5).join(", ");
        const extra = col.allowedValues.length > 5 ? ` (+${col.allowedValues.length - 5} more)` : "";
        errors.push({
          row: rowNumber,
          column: col.name,
          value,
          error: `Not a recognised value. Expected one of: ${sample}${extra}`,
        });
      }
    }
  }

  return true;
}

/** Normalize DATE columns to ISO 8601 in a parsed row. */
function normalizeDates(
  row: Record<string, string>,
  columns: ColumnDef[],
  headerMap: Map<string, string>
): Record<string, string> {
  const out = { ...row };
  for (const col of columns) {
    if (col.dataType !== "DATE") continue;
    const actualHeader = headerMap.get(col.name.toLowerCase());
    if (!actualHeader) continue;
    const v = String(out[actualHeader] ?? "").trim();
    if (!v) continue;
    const d = new Date(v);
    if (!isNaN(d.getTime())) out[actualHeader] = d.toISOString();
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSV — streaming parse to avoid loading the full file into memory
// ---------------------------------------------------------------------------

async function parseCsvStreaming(
  buffer: Buffer,
  columns: ColumnDef[],
  headerMap: Map<string, string>,
  missingColumns: string[]
): Promise<Omit<ValidationReport, "missingColumns">> {
  return new Promise((resolve) => {
    const errors: ValidationError[] = [];
    const rows: Record<string, string>[] = [];
    let rowCount = 0;
    let headerMapBuilt = false;

    const readable = Readable.from(buffer);

    Papa.parse(readable as unknown as File, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      transform: (v) => v.trim(),
      worker: false,

      step(result) {
        const row = result.data as Record<string, string>;

        // Build header map from first row
        if (!headerMapBuilt) {
          for (const h of Object.keys(row)) {
            headerMap.set(h.toLowerCase(), h);
          }
          // Detect missing required columns
          for (const col of columns) {
            if (col.required && !headerMap.has(col.name.toLowerCase())) {
              missingColumns.push(col.name);
            }
          }
          headerMapBuilt = true;
        }

        rowCount++;
        const rowNumber = rowCount + 1; // +1 for header row

        const hadCapacity = validateRow(row, rowNumber, columns, headerMap, errors);

        // Only accumulate rows when under the error threshold (no errors yet)
        // — if validation has failed we won't store rows anyway
        if (hadCapacity && errors.length === 0) {
          rows.push(normalizeDates(row, columns, headerMap));
        }
      },

      complete() {
        const errorsCapped = errors.length >= MAX_ERRORS;
        resolve({ errors, errorsCapped, rowCount, rows: errors.length === 0 ? rows : [] });
      },

      error(err) {
        resolve({
          errors: [{ row: 0, column: "", value: "", error: `Parse error: ${err.message}` }],
          errorsCapped: false,
          rowCount: 0,
          rows: [],
        });
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Excel — must be fully buffered (binary format, no streaming API)
// ---------------------------------------------------------------------------

function parseExcel(buffer: Buffer, sheetName?: string): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const name =
    sheetName && workbook.SheetNames.includes(sheetName)
      ? sheetName
      : workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  return rawRows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.trim(), String(v).trim()])
    )
  );
}

function validateExcel(
  buffer: Buffer,
  columns: ColumnDef[],
  sheetName?: string
): Omit<ValidationReport, "missingColumns"> & { headerMap: Map<string, string>; missingColumns: string[] } {
  let rawRows: Record<string, string>[];
  try {
    rawRows = parseExcel(buffer, sheetName);
  } catch {
    return {
      errors: [{ row: 0, column: "", value: "", error: "Could not parse file" }],
      errorsCapped: false,
      rowCount: 0,
      missingColumns: [],
      rows: [],
      headerMap: new Map(),
    };
  }

  if (rawRows.length === 0) {
    return { errors: [], errorsCapped: false, rowCount: 0, missingColumns: [], rows: [], headerMap: new Map() };
  }

  if (rawRows.length > EXCEL_MAX_ROWS) {
    return {
      errors: [{
        row: 0,
        column: "",
        value: "",
        error: `Excel file exceeds the ${EXCEL_MAX_ROWS.toLocaleString()}-row limit. Convert to CSV for larger files.`,
      }],
      errorsCapped: false,
      rowCount: rawRows.length,
      missingColumns: [],
      rows: [],
      headerMap: new Map(),
    };
  }

  const headerMap = new Map<string, string>();
  for (const h of Object.keys(rawRows[0])) headerMap.set(h.toLowerCase(), h);

  const missingColumns = columns
    .filter((col) => col.required && !headerMap.has(col.name.toLowerCase()))
    .map((col) => col.name);

  const errors: ValidationError[] = [];

  for (let i = 0; i < rawRows.length; i++) {
    validateRow(rawRows[i], i + 2, columns, headerMap, errors);
    if (errors.length >= MAX_ERRORS) break;
  }

  const errorsCapped = errors.length >= MAX_ERRORS;
  const normalizedRows = errors.length === 0
    ? rawRows.map((r) => normalizeDates(r, columns, headerMap))
    : [];

  return { errors, errorsCapped, rowCount: rawRows.length, missingColumns, rows: normalizedRows, headerMap };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function validateFile(
  buffer: Buffer,
  mimeType: string,
  columns: ColumnDef[],
  sheetName?: string
): Promise<ValidationReport> {
  const isExcel =
    mimeType.includes("spreadsheetml") ||
    mimeType.includes("ms-excel") ||
    mimeType === "application/octet-stream";

  if (isExcel) {
    const { headerMap: _hm, ...result } = validateExcel(buffer, columns, sheetName);
    return result;
  }

  // CSV: streaming path
  const headerMap = new Map<string, string>();
  const missingColumns: string[] = [];
  try {
    const result = await parseCsvStreaming(buffer, columns, headerMap, missingColumns);
    return { ...result, missingColumns };
  } catch {
    return {
      errors: [{ row: 0, column: "", value: "", error: "Could not parse file" }],
      errorsCapped: false,
      rowCount: 0,
      missingColumns: [],
      rows: [],
    };
  }
}
