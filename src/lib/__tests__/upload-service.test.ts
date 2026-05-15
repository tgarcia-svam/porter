import { describe, it, expect } from "vitest";
import {
  sanitizePathSegment,
  buildUploadBlobName,
  toMissingColumnErrors,
  uploadDatetime,
} from "../upload-service";

describe("sanitizePathSegment", () => {
  it("replaces path-unsafe characters with underscore", () => {
    expect(sanitizePathSegment("a/b\\c?d#e%f")).toBe("a_b_c_d_e_f");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizePathSegment("  hello  ")).toBe("hello");
  });

  it("returns '_' for empty / whitespace-only input", () => {
    expect(sanitizePathSegment("")).toBe("_");
    expect(sanitizePathSegment("   ")).toBe("_");
  });

  it("leaves safe characters untouched", () => {
    expect(sanitizePathSegment("My-Org.v2")).toBe("My-Org.v2");
  });
});

describe("buildUploadBlobName", () => {
  it("partitions by project/org/schema/datetime/filename", () => {
    const { blobName } = buildUploadBlobName({
      projectNames: ["ProjA"],
      orgName: "Acme",
      schemaName: "Sales",
      fileName: "data.csv",
      datetime: "2026-05-14T10-00-00",
    });
    expect(blobName).toBe("ProjA/Acme/Sales/2026-05-14T10-00-00/data.csv");
  });

  it("joins multiple project names with +", () => {
    const { blobName } = buildUploadBlobName({
      projectNames: ["A", "B"],
      orgName: "Org",
      schemaName: "S",
      fileName: "f.csv",
      datetime: "T",
    });
    expect(blobName).toBe("A+B/Org/S/T/f.csv");
  });

  it("uses 'no-project' when projectNames is empty", () => {
    const { blobName } = buildUploadBlobName({
      projectNames: [],
      orgName: "Org",
      schemaName: "S",
      fileName: "f.csv",
      datetime: "T",
    });
    expect(blobName).toBe("no-project/Org/S/T/f.csv");
  });

  it("prepends prefix when provided", () => {
    const { blobName } = buildUploadBlobName({
      projectNames: ["P"],
      orgName: "Org",
      schemaName: "S",
      fileName: "f.csv",
      prefix: "valid",
      datetime: "T",
    });
    expect(blobName).toBe("valid/P/Org/S/T/f.csv");
  });

  it("sanitizes path-unsafe characters in every segment", () => {
    const { blobName } = buildUploadBlobName({
      projectNames: ["A/B"],
      orgName: "Or#g",
      schemaName: "Sch?ma",
      fileName: "data.csv",
      datetime: "T",
    });
    expect(blobName).toBe("A_B/Or_g/Sch_ma/T/data.csv");
  });

  it("returns the datetime used so callers can reuse it", () => {
    const { datetime } = buildUploadBlobName({
      projectNames: ["P"],
      orgName: "O",
      schemaName: "S",
      fileName: "f.csv",
    });
    expect(datetime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });

  it("respects an explicit datetime override", () => {
    const { datetime } = buildUploadBlobName({
      projectNames: ["P"],
      orgName: "O",
      schemaName: "S",
      fileName: "f.csv",
      datetime: "FIXED",
    });
    expect(datetime).toBe("FIXED");
  });
});

describe("uploadDatetime", () => {
  it("returns a filesystem-safe ISO timestamp", () => {
    expect(uploadDatetime()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/);
  });
});

describe("toMissingColumnErrors", () => {
  it("wraps each column name as a row-0 ValidationError", () => {
    expect(toMissingColumnErrors(["a", "b"])).toEqual([
      { row: 0, column: "a", value: "", error: "Required column is missing from the file" },
      { row: 0, column: "b", value: "", error: "Required column is missing from the file" },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(toMissingColumnErrors([])).toEqual([]);
  });
});
