import { describe, it, expect } from "vitest";
import { validateFile } from "../validate";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a CSV Buffer from a header line plus any number of data rows. */
function csv(header: string, ...rows: string[]): Buffer {
  return Buffer.from([header, ...rows].join("\n"));
}

type ColOpts = {
  required?: boolean;
  allowedValues?: string[];
  caseSensitive?: boolean;
};

function col(name: string, dataType: string, opts: ColOpts = {}) {
  return { name, dataType, required: opts.required ?? true, ...opts };
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

  it.each(["2024-01-15", "01/15/2024", "January 15, 2024"])(
    "accepts parseable date %s",
    async (val) => {
      const r = await validateFile(csv("v", val), TEXT_CSV, cols);
      expect(r.errors).toHaveLength(0);
    }
  );

  it("rejects non-date string", async () => {
    const r = await validateFile(csv("v", "not-a-date"), TEXT_CSV, cols);
    expect(r.errors[0].error).toBe("Expected a valid date");
  });

  it("normalizes valid date to ISO 8601", async () => {
    const r = await validateFile(csv("v", "2024-06-15"), TEXT_CSV, cols);
    expect(r.errors).toHaveLength(0);
    expect(r.rows[0]["v"]).toMatch(/^2024-06-15T/);
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

describe("allowed values", () => {
  const statusCol = col("status", "TEXT", {
    allowedValues: ["Active", "Inactive", "Pending"],
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
      allowedValues: ["Active", "Inactive"],
      caseSensitive: false,
    });
    const r = await validateFile(csv("status", "active"), TEXT_CSV, [insensitive]);
    expect(r.errors).toHaveLength(0);
  });

  it("shows up to 5 sample values in the error message", async () => {
    const manyValues = col("v", "TEXT", {
      allowedValues: ["A", "B", "C", "D", "E", "F", "G"],
    });
    const r = await validateFile(csv("v", "X"), TEXT_CSV, [manyValues]);
    expect(r.errors[0].error).toContain("A, B, C, D, E");
    expect(r.errors[0].error).toContain("+2 more");
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

describe("Excel file (xlsx mime type)", () => {
  const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  it("validates a valid Excel buffer", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["name", "score"], ["Alice", "95"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

    const r = await validateFile(buf, XLSX_MIME, [
      col("name", "TEXT"),
      col("score", "NUMBER"),
    ]);
    expect(r.errors).toHaveLength(0);
    expect(r.rowCount).toBe(1);
  });

  it("returns zero rows for an empty Excel sheet", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    // Sheet with only a header — no data rows
    const ws = XLSX.utils.aoa_to_sheet([["name"]]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    const r = await validateFile(buf, XLSX_MIME, [col("name", "TEXT")]);
    expect(r.errors).toHaveLength(0);
    expect(r.rowCount).toBe(0);
  });
});
