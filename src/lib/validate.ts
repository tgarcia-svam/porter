import Papa from "papaparse";
import * as XLSX from "xlsx";

export type ValidationError = {
  row: number;
  column: string;
  value: string;
  error: string;
};

export type ValidationReport = {
  errors: ValidationError[];
  rowCount: number;
  missingColumns: string[];
  rows: Record<string, string>[];
};

type ColumnDef = {
  name: string;
  dataType: string;
  required: boolean;
};

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
// Parse helpers
// ---------------------------------------------------------------------------

function parseCsv(buffer: Buffer): Record<string, string>[] {
  const text = buffer.toString("utf-8");
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });
  return result.data;
}

function parseExcel(buffer: Buffer, sheetName?: string): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const name =
    sheetName && workbook.SheetNames.includes(sheetName)
      ? sheetName
      : workbook.SheetNames[0];
  const sheet = workbook.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.trim(), String(v).trim()])
    )
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function validateFile(
  buffer: Buffer,
  mimeType: string,
  columns: ColumnDef[],
  sheetName?: string
): ValidationReport {
  let rows: Record<string, string>[];

  const isExcel =
    mimeType.includes("spreadsheetml") ||
    mimeType.includes("ms-excel") ||
    mimeType === "application/octet-stream";

  try {
    rows = isExcel ? parseExcel(buffer, sheetName) : parseCsv(buffer);
  } catch {
    return {
      errors: [{ row: 0, column: "", value: "", error: "Could not parse file" }],
      rowCount: 0,
      missingColumns: [],
      rows: [],
    };
  }

  if (rows.length === 0) {
    return { errors: [], rowCount: 0, missingColumns: [], rows: [] };
  }

  // Build a case-insensitive map: lowercased header → actual header in file
  const headerMap = new Map<string, string>();
  for (const h of Object.keys(rows[0])) {
    headerMap.set(h.toLowerCase(), h);
  }

  // Check for missing required columns (case-insensitive)
  const missingColumns = columns
    .filter((col) => col.required && !headerMap.has(col.name.toLowerCase()))
    .map((col) => col.name);

  const errors: ValidationError[] = [];

  // Validate each row
  rows.forEach((row, rowIdx) => {
    const rowNumber = rowIdx + 2; // 1-based + header row

    for (const col of columns) {
      const actualHeader = headerMap.get(col.name.toLowerCase());
      const rawValue = actualHeader !== undefined ? row[actualHeader] : undefined;

      // Column not present — already tracked as missing, skip per-row errors
      if (rawValue === undefined) continue;

      const value = String(rawValue).trim();

      // Required + empty
      if (col.required && value === "") {
        errors.push({
          row: rowNumber,
          column: col.name,
          value: "",
          error: "Required field is empty",
        });
        continue;
      }

      // Skip type check for optional empty values
      if (value === "") continue;

      const typeError = checkValue(value, col.dataType);
      if (typeError) {
        errors.push({ row: rowNumber, column: col.name, value, error: typeError });
      }
    }
  });

  // Normalize DATE column values to ISO 8601 format for DB storage
  const normalizedRows = rows.map((row) => {
    const out: Record<string, string> = { ...row };
    for (const col of columns) {
      if (col.dataType !== "DATE") continue;
      const actualHeader = headerMap.get(col.name.toLowerCase());
      if (actualHeader === undefined) continue;
      const v = String(row[actualHeader] ?? "").trim();
      if (!v) continue;
      const d = new Date(v);
      if (!isNaN(d.getTime())) {
        out[actualHeader] = d.toISOString();
      }
    }
    return out;
  });

  return { errors, rowCount: rows.length, missingColumns, rows: normalizedRows };
}
