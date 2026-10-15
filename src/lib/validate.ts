import Papa from "papaparse";
import ExcelJS from "exceljs";
import { Readable } from "stream";
import { parseDateStrict, checkValue, comparisonError, type ComparisonRule } from "@/lib/validate-core";

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

export type { ComparisonRule };

export type ClassificationConstraint = {
  type: "VALUE_LIST" | "REGEX" | "NUMBER_RANGE" | "DATE_RANGE";
  description?: string | null; // uploader-facing explanation, surfaced in REGEX errors
  values?: string[] | null; // VALUE_LIST
  caseSensitive?: boolean | null; // VALUE_LIST + REGEX
  pattern?: string | null; // REGEX
  minNumber?: number | null; // NUMBER_RANGE
  maxNumber?: number | null; // NUMBER_RANGE
  minDate?: string | null; // DATE_RANGE — ISO "YYYY-MM-DD"
  maxDate?: string | null; // DATE_RANGE
};

type ColumnDef = {
  name: string;
  dataType: string;
  required: boolean;
  classification?: ClassificationConstraint | null;
};

/**
 * A ColumnDef with per-column constraint state computed once (compiled regex,
 * parsed date bounds) so the hot per-row path never recompiles. Produced by
 * prepareColumns() before any row is validated.
 */
type PreparedColumn = ColumnDef & {
  _regex?: RegExp | null;
  _minDate?: Date | null;
  _maxDate?: Date | null;
};

/**
 * Pre-compute per-column constraint state once, before the row loop. Invalid
 * stored regex is guarded at write time, but we still swallow compile errors
 * here (→ null = skip the check) rather than throwing mid-validation.
 */
function prepareColumns(columns: ColumnDef[]): PreparedColumn[] {
  return columns.map((col) => {
    const c = col.classification;
    if (!c) return col;
    if (c.type === "REGEX") {
      let rx: RegExp | null = null;
      if (c.pattern) {
        try {
          rx = new RegExp(c.pattern, c.caseSensitive === false ? "i" : "");
        } catch {
          rx = null;
        }
      }
      return { ...col, _regex: rx };
    }
    if (c.type === "DATE_RANGE") {
      return {
        ...col,
        _minDate: c.minDate ? parseDateStrict(c.minDate) : null,
        _maxDate: c.maxDate ? parseDateStrict(c.maxDate) : null,
      };
    }
    return col;
  });
}

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

// ---------------------------------------------------------------------------
// Row validation (shared between streaming and batch paths)
// ---------------------------------------------------------------------------

/**
 * Apply a column's classification constraint to a cell value that has already
 * passed the base data-type check. Returns an error message, or null if valid
 * (or if the constraint is absent / inapplicable).
 */
function checkClassification(value: string, col: PreparedColumn): string | null {
  const c = col.classification;
  if (!c) return null;

  switch (c.type) {
    case "VALUE_LIST": {
      if (!c.values?.length) return null;
      const sensitive = c.caseSensitive !== false;
      const match = sensitive
        ? c.values.includes(value)
        : c.values.some((v) => v.toLowerCase() === value.toLowerCase());
      if (match) return null;
      const sample = c.values.slice(0, 5).join(", ");
      const extra = c.values.length > 5 ? ` (+${c.values.length - 5} more)` : "";
      return `Not a recognised value. Expected one of: ${sample}${extra}`;
    }

    case "REGEX": {
      // Compiled once in prepareColumns; null = no/invalid pattern → skip.
      if (!col._regex) return null;
      if (col._regex.test(value)) return null;
      // Surface the admin's description (when set) so uploaders know what's expected.
      const hint = c.description?.trim();
      return hint
        ? `Does not match the required format. ${hint}`
        : "Does not match the required format";
    }

    case "NUMBER_RANGE": {
      const n = Number(value); // value already passed NUMBER/INTEGER check
      const hasMin = c.minNumber !== null && c.minNumber !== undefined;
      const hasMax = c.maxNumber !== null && c.maxNumber !== undefined;
      if (hasMin && hasMax && (n < c.minNumber! || n > c.maxNumber!))
        return `Must be between ${c.minNumber} and ${c.maxNumber}`;
      if (hasMin && !hasMax && n < c.minNumber!) return `Must be at least ${c.minNumber}`;
      if (hasMax && !hasMin && n > c.maxNumber!) return `Must be at most ${c.maxNumber}`;
      return null;
    }

    case "DATE_RANGE": {
      const d = parseDateStrict(value); // value already passed DATE check
      if (!d) return null;
      const min = col._minDate ?? null;
      const max = col._maxDate ?? null;
      const t = d.getTime();
      const fmt = (x: Date) => x.toISOString().slice(0, 10);
      if (min && max && (t < min.getTime() || t > max.getTime()))
        return `Must be between ${fmt(min)} and ${fmt(max)}`;
      if (min && !max && t < min.getTime()) return `Must be on or after ${fmt(min)}`;
      if (max && !min && t > max.getTime()) return `Must be on or before ${fmt(max)}`;
      return null;
    }

    default:
      return null;
  }
}

function validateRow(
  row: Record<string, string>,
  rowNumber: number,
  columns: PreparedColumn[],
  headerMap: Map<string, string>,
  errors: ValidationError[],
  comparisons?: ComparisonRule[]
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

    const clsError = checkClassification(value, col);
    if (clsError) {
      errors.push({ row: rowNumber, column: col.name, value, error: clsError });
    }
  }

  if (comparisons?.length) {
    const typeByLcName = new Map(columns.map((c) => [c.name.toLowerCase(), c.dataType]));
    for (const rule of comparisons) {
      if (errors.length >= MAX_ERRORS) break;
      const srcHeader = headerMap.get(rule.sourceColumnName.toLowerCase());
      const tgtHeader = headerMap.get(rule.targetColumnName.toLowerCase());
      if (!srcHeader || !tgtHeader) continue;
      const srcRaw = String(row[srcHeader] ?? "").trim();
      const tgtRaw = String(row[tgtHeader] ?? "").trim();
      const msg = comparisonError(
        rule,
        srcRaw,
        tgtRaw,
        typeByLcName.get(rule.sourceColumnName.toLowerCase())
      );
      if (msg) {
        errors.push({ row: rowNumber, column: rule.sourceColumnName, value: srcRaw, error: msg });
      }
    }
  }

  return true;
}

/** Normalize DATE columns to ISO 8601 in a parsed row. */
function normalizeDates(
  row: Record<string, string>,
  columns: PreparedColumn[],
  headerMap: Map<string, string>
): Record<string, string> {
  const out = { ...row };
  for (const col of columns) {
    if (col.dataType !== "DATE") continue;
    const actualHeader = headerMap.get(col.name.toLowerCase());
    if (!actualHeader) continue;
    const v = String(out[actualHeader] ?? "").trim();
    if (!v) continue;
    const d = parseDateStrict(v);
    if (d) out[actualHeader] = d.toISOString();
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSV — streaming parse to avoid loading the full file into memory
// ---------------------------------------------------------------------------

async function parseCsvStreaming(
  buffer: Buffer,
  columns: PreparedColumn[],
  headerMap: Map<string, string>,
  missingColumns: string[],
  comparisons?: ComparisonRule[]
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

        const hadCapacity = validateRow(row, rowNumber, columns, headerMap, errors, comparisons);

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

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((rt) => rt.text).join("");
    // Formula cell — use the cached result
    if ("formula" in value || "sharedFormula" in value) {
      const result = (value as ExcelJS.CellFormulaValue).result;
      return result !== undefined ? cellToString(result as ExcelJS.CellValue) : "";
    }
    if ("text" in value) return String((value as ExcelJS.CellHyperlinkValue).text);
    if ("error" in value) return "";
  }
  return String(value);
}

async function parseExcel(buffer: Buffer, sheetName?: string): Promise<Record<string, string>[]> {
  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(buffer as any);

  const sheet = (sheetName ? workbook.getWorksheet(sheetName) : null) ?? workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellToString(cell.value).trim();
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      if (!header) return;
      const cell = row.getCell(idx + 1);
      record[header] = cellToString(cell.value).trim();
    });
    rows.push(record);
  });

  return rows;
}

async function validateExcel(
  buffer: Buffer,
  columns: PreparedColumn[],
  sheetName?: string,
  comparisons?: ComparisonRule[]
): Promise<Omit<ValidationReport, "missingColumns"> & { headerMap: Map<string, string>; missingColumns: string[] }> {
  let rawRows: Record<string, string>[];
  try {
    rawRows = await parseExcel(buffer, sheetName);
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
    validateRow(rawRows[i], i + 2, columns, headerMap, errors, comparisons);
    if (errors.length >= MAX_ERRORS) break;
  }

  const errorsCapped = errors.length >= MAX_ERRORS;
  const normalizedRows = errors.length === 0
    ? rawRows.map((r) => normalizeDates(r, columns, headerMap))
    : [];

  return { errors, errorsCapped, rowCount: rawRows.length, missingColumns, rows: normalizedRows, headerMap };
}

// ---------------------------------------------------------------------------
// Pre-parsed row validation — skips the serialise → parse round-trip
// ---------------------------------------------------------------------------

/**
 * Validate an already-parsed array of row objects against the column definitions.
 * Produces the same ValidationReport as validateFile() on a CSV but avoids the
 * Papa.unparse → Buffer → parseCsvStreaming cycle that the manual entry path
 * would otherwise require. Synchronous — no I/O.
 */
export function validateRows(
  rows: Record<string, string>[],
  columns: ColumnDef[],
  comparisons?: ComparisonRule[],
): ValidationReport {
  if (rows.length === 0) {
    return { errors: [], errorsCapped: false, rowCount: 0, missingColumns: [], rows: [] };
  }

  const prepared = prepareColumns(columns);

  // Build a case-insensitive header map from the first row's keys, matching
  // what parseCsvStreaming builds from the first CSV data row.
  const headerMap = new Map<string, string>();
  for (const h of Object.keys(rows[0])) {
    headerMap.set(h.toLowerCase(), h);
  }

  const missingColumns = prepared
    .filter((col) => col.required && !headerMap.has(col.name.toLowerCase()))
    .map((col) => col.name);

  const errors: ValidationError[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (errors.length >= MAX_ERRORS) break;
    // Row numbers are 1-based with row 1 as header, so first data row = 2.
    validateRow(rows[i], i + 2, prepared, headerMap, errors, comparisons);
  }

  const errorsCapped = errors.length >= MAX_ERRORS;
  const normalizedRows =
    errors.length === 0 ? rows.map((r) => normalizeDates(r, prepared, headerMap)) : [];

  return { errors, errorsCapped, rowCount: rows.length, missingColumns, rows: normalizedRows };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function validateFile(
  buffer: Buffer,
  mimeType: string,
  columns: ColumnDef[],
  sheetName?: string,
  fileName?: string,
  comparisons?: ComparisonRule[],
): Promise<ValidationReport> {
  const ext = fileName?.split(".").pop()?.toLowerCase();
  // Treat application/octet-stream as Excel only when the extension confirms it —
  // browsers (especially on Windows) report "" for CSV files, which gets
  // substituted to octet-stream at the call site, causing valid CSVs to be
  // routed to the Excel parser and fail with a cryptic error.
  const isExcel =
    mimeType.includes("spreadsheetml") ||
    mimeType.includes("ms-excel") ||
    (mimeType === "application/octet-stream" && (ext === "xlsx" || ext === "xls"));

  // Compile regex / parse date bounds once, up front.
  const prepared = prepareColumns(columns);

  if (isExcel) {
    const { headerMap: _hm, ...result } = await validateExcel(buffer, prepared, sheetName, comparisons);
    return result;
  }

  // CSV: streaming path
  const headerMap = new Map<string, string>();
  const missingColumns: string[] = [];
  try {
    const result = await parseCsvStreaming(buffer, prepared, headerMap, missingColumns, comparisons);
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
