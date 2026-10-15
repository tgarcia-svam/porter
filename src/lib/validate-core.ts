// Pure validation helpers shared by the server (validate.ts) and the manual-entry
// grid (client). Must stay free of Node-only imports (papaparse, exceljs, stream).

export type ComparisonRule = {
  sourceColumnName: string;
  operator: "LT" | "LTE" | "GT" | "GTE";
  targetColumnName: string;
};

/**
 * Strict date parser. Accepts only:
 *   - ISO 8601:  YYYY-MM-DD  (optionally followed by Thh:mm:ss... — used by
 *                              Excel cells which exceljs converts via toISOString)
 *   - US slash:  M/D/YYYY or MM/DD/YYYY
 *
 * Rejects calendar-invalid dates (Feb 30, Apr 31, Feb 29 in non-leap years)
 * and any other format. Returns midnight UTC on the parsed calendar day, or
 * null. Note: `new Date()` and `Date.parse()` would silently roll Feb 30 over
 * to March 2 — this function catches that by extracting Y/M/D components and
 * verifying they round-trip through the Date constructor.
 */
export function parseDateStrict(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;

  let y: number;
  let m: number;
  let d: number;

  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (iso) {
    y = +iso[1];
    m = +iso[2];
    d = +iso[3];
  } else {
    const slash = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!slash) return null;
    m = +slash[1];
    d = +slash[2];
    y = +slash[3];
  }

  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;

  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

export function checkValue(value: string, dataType: string): string | null {
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
      if (parseDateStrict(v) === null) {
        return "Expected a valid date (YYYY-MM-DD or M/D/YYYY)";
      }
      return null;

    case "EMAIL":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
        return "Expected a valid email address";
      return null;

    default:
      return null;
  }
}

const NUMERIC_PHRASE: Record<ComparisonRule["operator"], string> = {
  LT: "less than",
  LTE: "less than or equal to",
  GT: "greater than",
  GTE: "greater than or equal to",
};

const DATE_PHRASE: Record<ComparisonRule["operator"], string> = {
  LT: "before",
  LTE: "on or before",
  GT: "after",
  GTE: "on or after",
};

/**
 * Evaluate a cross-column comparison rule for one row. Returns a plain-English
 * error ("Interview Date must be on or after DOB") or null when the rule passes
 * or cannot be evaluated (blank/unparseable values are reported by the per-cell
 * checks instead). `srcType` is the source column's data type.
 */
export function comparisonError(
  rule: ComparisonRule,
  srcRaw: string,
  tgtRaw: string,
  srcType: string | undefined
): string | null {
  const src = srcRaw.trim();
  const tgt = tgtRaw.trim();
  if (!src || !tgt) return null;

  let sv: number;
  let tv: number;
  if (srcType === "DATE") {
    const sd = parseDateStrict(src);
    const td = parseDateStrict(tgt);
    if (!sd || !td) return null;
    sv = sd.getTime();
    tv = td.getTime();
  } else {
    sv = Number(src);
    tv = Number(tgt);
    if (isNaN(sv) || isNaN(tv)) return null;
  }

  const passed =
    rule.operator === "LT"  ? sv < tv  :
    rule.operator === "LTE" ? sv <= tv :
    rule.operator === "GT"  ? sv > tv  : sv >= tv;
  if (passed) return null;

  const phrase = (srcType === "DATE" ? DATE_PHRASE : NUMERIC_PHRASE)[rule.operator];
  return `${rule.sourceColumnName} must be ${phrase} ${rule.targetColumnName}`;
}
