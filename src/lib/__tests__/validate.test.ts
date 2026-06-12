import { describe, it, expect } from "vitest";
import { validateFile, type ClassificationConstraint } from "../validate";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a CSV Buffer from a header line plus any number of data rows. */
function csv(header: string, ...rows: string[]): Buffer {
  return Buffer.from([header, ...rows].join("\n"));
}

type ColOpts = {
  required?: boolean;
  classification?: ClassificationConstraint;
};

function col(name: string, dataType: string, opts: ColOpts = {}) {
  return {
    name,
    dataType,
    required: opts.required ?? true,
    classification: opts.classification ?? null,
  };
}

/** Convenience builder for a VALUE_LIST constraint. */
function valueList(values: string[], caseSensitive = true): ClassificationConstraint {
  return { type: "VALUE_LIST", values, caseSensitive };
}

const TEXT_CSV = "text/csv";

// ── NUMBER ────────────────────────────────────────────────────────────────────

describe("NUMBER type", () => {
  const cols = [col("v", "NUMBER")];

  it.each(["42", "3.14", "-5.5", "0", "1e3"])(
    "accepts valid number %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, cols);
      expect(r.errors).toHaveLength(0);
    }
  );

  it.each(["abc", "one hundred", "NaN", "1 000"])(
    "rejects invalid number %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, cols);
      expect(r.errors[0].error).toBe("Expected a number");
    }
  );

  it("allows empty value for optional NUMBER", async () => {
    const r = await validateFile(csv("v", ""), TEXT_CSV, [
      col("v", "NUMBER", { required: false }),
    ]);
    expect(r.errors).toHaveLength(0);
  });
});

// ── INTEGER ───────────────────────────────────────────────────────────────────

describe("INTEGER type", () => {
  const cols = [col("v", "INTEGER")];

  it.each(["1", "100", "-3", "0"])(
    "accepts whole number %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, cols);
      expect(r.errors).toHaveLength(0);
    }
  );

  it("rejects decimal value", async () => {
    const r = await validateFile(csv("v", "1.5"), TEXT_CSV, cols);
    expect(r.errors[0].error).toBe("Expected an integer (whole number)");
  });

  it("rejects non-numeric string", async () => {
    const r = await validateFile(csv("v", "abc"), TEXT_CSV, cols);
    expect(r.errors[0].error).toBe("Expected an integer (whole number)");
  });
});

// ── BOOLEAN ───────────────────────────────────────────────────────────────────

describe("BOOLEAN type", () => {
  const cols = [col("v", "BOOLEAN")];

  it.each(["true", "false", "yes", "no", "1", "0", "TRUE", "YES", "False"])(
    "accepts valid boolean %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, cols);
      expect(r.errors).toHaveLength(0);
    }
  );

  it.each(["maybe", "on", "2", "y", "n"])(
    "rejects invalid boolean %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, cols);
      expect(r.errors[0].error).toBe(
        "Expected true/false, yes/no, or 1/0"
      );
    }
  );
});

// ── DATE ──────────────────────────────────────────────────────────────────────

describe("DATE type", () => {
  const cols = [col("v", "DATE")];

  it.each([
    "2024-01-15",      // ISO basic
    "2024-1-15",       // ISO single-digit month
    "2024-01-5",       // ISO single-digit day
    "01/15/2024",      // US slash zero-padded
    "1/15/2024",       // US slash single-digit
    "2024-02-29",      // valid leap-day
    "2024-01-15T00:00:00.000Z", // ISO with time (exceljs serializes Excel date cells this way)
  ])(
    "accepts valid date %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, cols);
      expect(r.errors).toHaveLength(0);
    }
  );

  it.each([
    "2/30/2023",       // Feb has no 30th
    "02/30/2023",
    "2023-02-30",
    "4/31/2024",       // Apr has no 31st
    "2024-04-31",
    "2023-02-29",      // Feb 29 in a non-leap year
    "13/1/2023",       // month > 12
    "2023-13-01",
    "1/32/2023",       // day > 31
    "0/15/2024",       // month 0
    "2024-00-15",
    "not-a-date",
    "January 15, 2024", // long-form no longer accepted — strict parser only
    "15-Jan-2024",
    "2024/01/15",      // wrong separator order for slash format
  ])(
    "rejects invalid date %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, cols);
      expect(r.errors[0].error).toMatch(/Expected a valid date/);
    }
  );

  it("normalizes valid date to midnight UTC ISO 8601", async () => {
    const r = await validateFile(csv("v", "2024-06-15"), TEXT_CSV, cols);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]["v"]).toBe("2024-06-15T00:00:00.000Z");
  });

  it("normalizes US-slash dates to ISO 8601", async () => {
    const r = await validateFile(csv("v", "6/15/2024"), TEXT_CSV, cols);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]["v"]).toBe("2024-06-15T00:00:00.000Z");
  });
});

// ── EMAIL ─────────────────────────────────────────────────────────────────────

describe("EMAIL type", () => {
  const cols = [col("v", "EMAIL")];

  it.each(["user@example.com", "a+b@sub.domain.org"])(
    "accepts valid email %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, cols);
      expect(r.errors).toHaveLength(0);
    }
  );

  it.each(["notanemail", "@domain.com", "user@", "user@domain"])(
    "rejects invalid email %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, cols);
      expect(r.errors[0].error).toBe("Expected a valid email address");
    }
  );
});

// ── TEXT ──────────────────────────────────────────────────────────────────────

describe("TEXT type", () => {
  it.each(["hello", "anything!@#$", "123", "   trimmed   "])(
    "accepts any non-empty text %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, [col("v", "TEXT")]);
      expect(r.errors).toHaveLength(0);
    }
  );
});

// ── Required / Optional ───────────────────────────────────────────────────────

describe("required field enforcement", () => {
  it("errors on empty required field", async () => {
    // Use a second column so PapaParse doesn't skip the row as empty
    const r = await validateFile(
      csv("name,v", "Alice,"),
      TEXT_CSV,
      [col("name", "TEXT"), col("v", "TEXT")]
    );
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({
      row: 2,
      column: "v",
      value: "",
      error: "Required field is empty",
    });
  });

  it("allows empty optional field", async () => {
    const r = await validateFile(
      csv("name,v", "Alice,"),
      TEXT_CSV,
      [col("name", "TEXT"), col("v", "TEXT", { required: false })]
    );
    expect(r.errors).toHaveLength(0);
  });

  it("detects missing required column in missingColumns", async () => {
    const r = await validateFile(csv("other", "val"), TEXT_CSV, [
      col("v", "TEXT"),
    ]);
    expect(r.missingColumns).toContain("v");
    expect(r.errors).toHaveLength(0);
  });

  it("does not report missing optional column", async () => {
    const r = await validateFile(csv("other", "val"), TEXT_CSV, [
      col("v", "TEXT", { required: false }),
    ]);
    expect(r.missingColumns).not.toContain("v");
  });
});

// ── Allowed values ────────────────────────────────────────────────────────────

describe("classification: VALUE_LIST", () => {
  const statusCol = col("status", "TEXT", {
    classification: valueList(["Active", "Inactive", "Pending"]),
  });

  it("accepts a matching value (case-sensitive)", async () => {
    const r = await validateFile(csv("status", "Active"), TEXT_CSV, [statusCol]);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects a value with wrong case when caseSensitive=true", async () => {
    const r = await validateFile(csv("status", "active"), TEXT_CSV, [statusCol]);
    expect(r.errors[0].error).toContain("Not a recognised value");
    expect(r.errors[0].error).toContain("Active");
  });

  it("accepts a value with wrong case when caseSensitive=false", async () => {
    const insensitive = col("status", "TEXT", {
      classification: valueList(["Active", "Inactive"], false),
    });
    const r = await validateFile(csv("status", "active"), TEXT_CSV, [insensitive]);
    expect(r.errors).toHaveLength(0);
  });

  it("shows up to 5 sample values in the error message", async () => {
    const manyValues = col("v", "TEXT", {
      classification: valueList(["A", "B", "C", "D", "E", "F", "G"]),
    });
    const r = await validateFile(csv("v", "X"), TEXT_CSV, [manyValues]);
    expect(r.errors[0].error).toContain("A, B, C, D, E");
    expect(r.errors[0].error).toContain("+2 more");
  });
});

// ── Classification: REGEX ───────────────────────────────────────────────────────

describe("classification: REGEX", () => {
  const skuCol = col("sku", "TEXT", {
    classification: { type: "REGEX", pattern: "^[A-Z]{3}-\\d{4}$", caseSensitive: true },
  });

  it("accepts a value matching the pattern", async () => {
    const r = await validateFile(csv("sku", "ABC-1234"), TEXT_CSV, [skuCol]);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects a value not matching the pattern", async () => {
    const r = await validateFile(csv("sku", "abc-1234"), TEXT_CSV, [skuCol]);
    expect(r.errors[0].error).toBe("Does not match the required format");
  });

  it("appends the rule description to the error when one is set", async () => {
    const described = col("sku", "TEXT", {
      classification: {
        type: "REGEX",
        pattern: "^[A-Z]{3}-\\d{4}$",
        caseSensitive: true,
        description: "Three uppercase letters, a hyphen, then four digits.",
      },
    });
    const r = await validateFile(csv("sku", "nope"), TEXT_CSV, [described]);
    expect(r.errors[0].error).toBe(
      "Does not match the required format. Three uppercase letters, a hyphen, then four digits."
    );
  });

  it("matches case-insensitively when caseSensitive=false", async () => {
    const ci = col("sku", "TEXT", {
      classification: { type: "REGEX", pattern: "^[A-Z]{3}-\\d{4}$", caseSensitive: false },
    });
    const r = await validateFile(csv("sku", "abc-1234"), TEXT_CSV, [ci]);
    expect(r.errors).toHaveLength(0);
  });
});

// ── Classification: NUMBER_RANGE ────────────────────────────────────────────────

describe("classification: NUMBER_RANGE", () => {
  const ranged = (min: number | null, max: number | null) =>
    col("v", "NUMBER", { classification: { type: "NUMBER_RANGE", minNumber: min, maxNumber: max } });

  it("accepts a value inside [1, 100]", async () => {
    const r = await validateFile(csv("v", "50"), TEXT_CSV, [ranged(1, 100)]);
    expect(r.errors).toHaveLength(0);
  });

  it("accepts the inclusive bounds", async () => {
    const r1 = await validateFile(csv("v", "1"), TEXT_CSV, [ranged(1, 100)]);
    const r100 = await validateFile(csv("v", "100"), TEXT_CSV, [ranged(1, 100)]);
    expect(r1.errors).toHaveLength(0);
    expect(r100.errors).toHaveLength(0);
  });

  it("rejects a value below the minimum", async () => {
    const r = await validateFile(csv("v", "0"), TEXT_CSV, [ranged(1, 100)]);
    expect(r.errors[0].error).toBe("Must be between 1 and 100");
  });

  it("rejects a value above the maximum", async () => {
    const r = await validateFile(csv("v", "101"), TEXT_CSV, [ranged(1, 100)]);
    expect(r.errors[0].error).toBe("Must be between 1 and 100");
  });

  it("supports a min-only (open-ended) range", async () => {
    const r = await validateFile(csv("v", "-1"), TEXT_CSV, [ranged(0, null)]);
    expect(r.errors[0].error).toBe("Must be at least 0");
  });

  it("supports a max-only (open-ended) range", async () => {
    const r = await validateFile(csv("v", "11"), TEXT_CSV, [ranged(null, 10)]);
    expect(r.errors[0].error).toBe("Must be at most 10");
  });
});

// ── Classification: DATE_RANGE ──────────────────────────────────────────────────

describe("classification: DATE_RANGE", () => {
  const ranged = (min: string | null, max: string | null) =>
    col("d", "DATE", { classification: { type: "DATE_RANGE", minDate: min, maxDate: max } });

  it("accepts a date inside the range", async () => {
    const r = await validateFile(csv("d", "2026-06-15"), TEXT_CSV, [ranged("2026-01-01", "2026-12-31")]);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects a date before the range", async () => {
    const r = await validateFile(csv("d", "2025-12-31"), TEXT_CSV, [ranged("2026-01-01", "2026-12-31")]);
    expect(r.errors[0].error).toBe("Must be between 2026-01-01 and 2026-12-31");
  });

  it("rejects a date after the range", async () => {
    const r = await validateFile(csv("d", "2027-01-01"), TEXT_CSV, [ranged("2026-01-01", "2026-12-31")]);
    expect(r.errors[0].error).toBe("Must be between 2026-01-01 and 2026-12-31");
  });

  it("supports a min-only (on or after) bound", async () => {
    const r = await validateFile(csv("d", "2025-06-01"), TEXT_CSV, [ranged("2026-01-01", null)]);
    expect(r.errors[0].error).toBe("Must be on or after 2026-01-01");
  });

  it("supports a max-only (on or before) bound", async () => {
    const r = await validateFile(csv("d", "2027-01-01"), TEXT_CSV, [ranged(null, "2026-12-31")]);
    expect(r.errors[0].error).toBe("Must be on or before 2026-12-31");
  });
});

// ── Row output ────────────────────────────────────────────────────────────────

describe("row output", () => {
  it("returns parsed rows when validation passes", async () => {
    const r = await validateFile(
      csv("name,age", "Alice,30", "Bob,25"),
      TEXT_CSV,
      [col("name", "TEXT"), col("age", "NUMBER")]
    );
    expect(r.errors).toHaveLength(0);
    expect(r.rowCount).toBe(2);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ name: "Alice", age: "30" });
  });

  it("returns empty rows when errors exist", async () => {
    const r = await validateFile(csv("v", "abc"), TEXT_CSV, [col("v", "NUMBER")]);
    expect(r.errors).toHaveLength(1);
    expect(r.rows).toHaveLength(0);
  });

  it("includes the row number in each error (1-indexed, header = row 1)", async () => {
    const r = await validateFile(
      csv("v", "ok", "bad"),
      TEXT_CSV,
      [col("v", "NUMBER")]
    );
    const errRow = r.errors.find((e) => e.value === "bad");
    expect(errRow?.row).toBe(3);
  });
});

// ── Error capping ─────────────────────────────────────────────────────────────

describe("error capping", () => {
  it("caps errors at 100 and sets errorsCapped", async () => {
    const dataRows = Array(105).fill("not-a-number");
    const r = await validateFile(csv("v", ...dataRows), TEXT_CSV, [
      col("v", "NUMBER"),
    ]);
    expect(r.errors).toHaveLength(100);
    expect(r.errorsCapped).toBe(true);
  });

  it("does not set errorsCapped when under the limit", async () => {
    const r = await validateFile(csv("v", "bad"), TEXT_CSV, [col("v", "NUMBER")]);
    expect(r.errorsCapped).toBe(false);
  });
});

// ── Excel path ────────────────────────────────────────────────────────────────

async function makeXlsx(rows: (string | number)[][]): Promise<Buffer> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("Excel file (xlsx mime type)", () => {
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("validates a valid Excel buffer", async () => {
    const buf = await makeXlsx([["name", "score"], ["Alice", "95"]]);
    const r = await validateFile(buf, XLSX_MIME, [
      col("name", "TEXT"),
      col("score", "NUMBER"),
    ]);
    expect(r.errors).toHaveLength(0);
    expect(r.rowCount).toBe(1);
  });

  it("returns zero rows for an empty Excel sheet", async () => {
    // Sheet with only a header — no data rows
    const buf = await makeXlsx([["name"]]);
    const r = await validateFile(buf, XLSX_MIME, [col("name", "TEXT")]);
    expect(r.errors).toHaveLength(0);
    expect(r.rowCount).toBe(0);
  });

  it("returns validation errors for invalid cell values", async () => {
    const buf = await makeXlsx([["score"], ["not-a-number"]]);
    const r = await validateFile(buf, XLSX_MIME, [col("score", "NUMBER")]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].error).toBe("Expected a number");
    expect(r.rows).toHaveLength(0); // rows withheld when errors exist
  });

  it("reports missing required columns in missingColumns", async () => {
    const buf = await makeXlsx([["other"], ["val"]]);
    const r = await validateFile(buf, XLSX_MIME, [col("score", "NUMBER")]);
    expect(r.missingColumns).toContain("score");
  });

  it("uses application/octet-stream as an Excel MIME type", async () => {
    const buf = await makeXlsx([["v"], ["hello"]]);
    const r = await validateFile(buf, "application/octet-stream", [col("v", "TEXT")]);
    expect(r.errors).toHaveLength(0);
    expect(r.rowCount).toBe(1);
  });
});

// ── Uncovered branches ────────────────────────────────────────────────────────

describe("unknown dataType (default case)", () => {
  it("treats an unknown dataType as always valid", async () => {
    const r = await validateFile(
      csv("v", "anything"),
      TEXT_CSV,
      [col("v", "CUSTOM_TYPE")]
    );
    expect(r.errors).toHaveLength(0);
  });
});
