import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  schemaViewName,
  upsertSchemaView,
  upsertAllSchemaViews,
  dropSchemaView,
  dropAllSchemaViews,
} from "../schema-view";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDb() {
  return { $executeRawUnsafe: vi.fn().mockResolvedValue(1) };
}

const PROJECT = { id: "proj1", name: "My Project" };
const SCHEMA_ID = "schema1";
const SCHEMA_NAME = "Data Format";

// ── schemaViewName (tests sanitize indirectly) ────────────────────────────────

describe("schemaViewName", () => {
  it("lowercases both parts", () => {
    expect(schemaViewName("PROJ", "SCHEMA")).toBe("proj_schema");
  });

  it("replaces spaces with underscores", () => {
    expect(schemaViewName("My Project", "Data Format")).toBe(
      "my_project_data_format"
    );
  });

  it("collapses consecutive special characters into a single underscore", () => {
    expect(schemaViewName("hello---world", "test")).toBe("hello_world_test");
  });

  it("strips leading and trailing underscores", () => {
    expect(schemaViewName("  spaces  ", "test")).toBe("spaces_test");
  });

  it("preserves digits", () => {
    expect(schemaViewName("project2", "v1schema")).toBe("project2_v1schema");
  });

  it("truncates each part to 40 characters", () => {
    const long = "a".repeat(50);
    const name = schemaViewName(long, long);
    expect(name).toBe("a".repeat(40) + "_" + "a".repeat(40));
  });

  it("handles special characters in names", () => {
    expect(schemaViewName("Sales & Marketing", "Q1/Q2")).toBe(
      "sales_marketing_q1_q2"
    );
  });
});

// ── upsertSchemaView ──────────────────────────────────────────────────────────

describe("upsertSchemaView", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it("calls $executeRawUnsafe once with CREATE OR REPLACE VIEW", async () => {
    await upsertSchemaView(db, PROJECT, SCHEMA_ID, SCHEMA_NAME, [
      { name: "Name", dataType: "TEXT" },
    ]);
    expect(db.$executeRawUnsafe).toHaveBeenCalledOnce();
    const sql: string = db.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain("CREATE OR REPLACE VIEW");
    expect(sql).toContain('"reports"');
    expect(sql).toContain("my_project_data_format");
  });

  it("generates ::numeric cast for NUMBER columns", async () => {
    await upsertSchemaView(db, PROJECT, SCHEMA_ID, SCHEMA_NAME, [
      { name: "Revenue", dataType: "NUMBER" },
    ]);
    const sql: string = db.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain("::numeric");
  });

  it("generates ::integer cast for INTEGER columns", async () => {
    await upsertSchemaView(db, PROJECT, SCHEMA_ID, SCHEMA_NAME, [
      { name: "Count", dataType: "INTEGER" },
    ]);
    const sql: string = db.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain("::integer");
  });

  it("generates CASE expression for BOOLEAN columns", async () => {
    await upsertSchemaView(db, PROJECT, SCHEMA_ID, SCHEMA_NAME, [
      { name: "Active", dataType: "BOOLEAN" },
    ]);
    const sql: string = db.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain("CASE");
    expect(sql).toContain("LOWER(");
    expect(sql).toContain("'true','yes','1'");
  });

  it("generates ::timestamptz cast for DATE columns", async () => {
    await upsertSchemaView(db, PROJECT, SCHEMA_ID, SCHEMA_NAME, [
      { name: "EventDate", dataType: "DATE" },
    ]);
    const sql: string = db.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain("::timestamptz");
  });

  it("generates plain JSON extract for TEXT columns", async () => {
    await upsertSchemaView(db, PROJECT, SCHEMA_ID, SCHEMA_NAME, [
      { name: "Label", dataType: "TEXT" },
    ]);
    const sql: string = db.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain(`->>'Label'`);
    expect(sql).not.toContain("::");
  });

  it("filters rows by schemaId and projectId", async () => {
    await upsertSchemaView(db, PROJECT, SCHEMA_ID, SCHEMA_NAME, [
      { name: "v", dataType: "TEXT" },
    ]);
    const sql: string = db.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain(`'${SCHEMA_ID}'`);
    expect(sql).toContain(`'${PROJECT.id}'`);
  });
});

// ── upsertAllSchemaViews ──────────────────────────────────────────────────────

describe("upsertAllSchemaViews", () => {
  let db: ReturnType<typeof makeDb>;
  beforeEach(() => { db = makeDb(); });

  it("returns without calling db when projects list is empty", async () => {
    await upsertAllSchemaViews(db, [], SCHEMA_ID, SCHEMA_NAME, [
      { name: "v", dataType: "TEXT" },
    ]);
    expect(db.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("creates reports schema before creating views", async () => {
    await upsertAllSchemaViews(db, [PROJECT], SCHEMA_ID, SCHEMA_NAME, [
      { name: "v", dataType: "TEXT" },
    ]);
    const calls: string[] = db.$executeRawUnsafe.mock.calls.map((c) => c[0]);
    expect(calls[0]).toContain("CREATE SCHEMA IF NOT EXISTS reports");
  });

  it("creates one view per project", async () => {
    const projects = [
      { id: "p1", name: "Project One" },
      { id: "p2", name: "Project Two" },
    ];
    await upsertAllSchemaViews(db, projects, SCHEMA_ID, SCHEMA_NAME, [
      { name: "v", dataType: "TEXT" },
    ]);
    // 1 schema creation + 2 view upserts
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(3);
  });
});

// ── dropSchemaView / dropAllSchemaViews ───────────────────────────────────────

describe("dropSchemaView", () => {
  it("issues DROP VIEW IF EXISTS for the correct view name", async () => {
    const db = makeDb();
    await dropSchemaView(db, "My Project", "Data Format");
    const sql: string = db.$executeRawUnsafe.mock.calls[0][0];
    expect(sql).toContain("DROP VIEW IF EXISTS");
    expect(sql).toContain("my_project_data_format");
  });
});

describe("dropAllSchemaViews", () => {
  it("drops one view per project", async () => {
    const db = makeDb();
    const projects = [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
    ];
    await dropAllSchemaViews(db, projects, "My Schema");
    expect(db.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });
});
