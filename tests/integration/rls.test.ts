/**
 * RLS cross-organisation isolation tests.
 *
 * Each test seeds two orgs (A and B), then queries via a connection that
 * runs as `porterapp` with a session-scoped `app.current_org_id`. Every
 * assertion proves that data from one org is invisible to the other.
 *
 * Run with:  npm run test:integration
 *
 * Prereqs:
 *   1. `npm run db:create-app-user` (creates porterapp role)
 *   2. `npm run db:rls`             (applies org-isolation policies)
 *   3. DATABASE_URL points to porterapp; DATABASE_URL_ADMIN points to the
 *      superuser/owner role.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const TEST_PREFIX = `rlstest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Admin client (BYPASSRLS) — seeds + tears down + ground-truth assertions
const admin = new PrismaClient({
  datasources: process.env.DATABASE_URL_ADMIN
    ? { db: { url: process.env.DATABASE_URL_ADMIN } }
    : undefined,
});

// App client (RLS-enforced) — every read/write is filtered by RLS
const app = new PrismaClient({
  datasources: process.env.DATABASE_URL
    ? { db: { url: process.env.DATABASE_URL } }
    : undefined,
});

/**
 * Run a callback inside a transaction that has `app.current_org_id` set to
 * `orgId`. Mirrors the production `withOrgContext()` helper.
 */
async function asOrg<T>(
  orgId: string,
  fn: (
    tx: Parameters<Parameters<typeof app.$transaction>[0]>[0]
  ) => Promise<T>,
  userId?: string
): Promise<T> {
  return app.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
    if (userId) {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    }
    return fn(tx);
  });
}

// ── Test fixtures ────────────────────────────────────────────────────────────

let orgA: string;
let orgB: string;
let userA: string;
let userB: string;
let projectA: string;
let projectB: string;
let schemaA: string;
let schemaB: string;
let uploadA: string;
let uploadB: string;

beforeAll(async () => {
  // Two orgs
  const a = await admin.organization.create({ data: { name: `${TEST_PREFIX}-orgA` } });
  const b = await admin.organization.create({ data: { name: `${TEST_PREFIX}-orgB` } });
  orgA = a.id;
  orgB = b.id;

  // One user per org
  const ua = await admin.user.create({
    data: { email: `${TEST_PREFIX}-a@test.local`, name: "User A", role: "UPLOADER", organizationId: orgA },
  });
  const ub = await admin.user.create({
    data: { email: `${TEST_PREFIX}-b@test.local`, name: "User B", role: "UPLOADER", organizationId: orgB },
  });
  userA = ua.id;
  userB = ub.id;

  // One project per org with the org assigned
  const pa = await admin.project.create({
    data: { name: `${TEST_PREFIX}-projA`, organizations: { create: { organizationId: orgA } } },
  });
  const pb = await admin.project.create({
    data: { name: `${TEST_PREFIX}-projB`, organizations: { create: { organizationId: orgB } } },
  });
  projectA = pa.id;
  projectB = pb.id;

  // One schema per project
  const sa = await admin.schema.create({
    data: {
      name: `${TEST_PREFIX}-schemaA`,
      columns: { create: [{ name: "v", dataType: "TEXT", required: true, order: 0 }] },
      projects: { create: { projectId: projectA } },
    },
  });
  const sb = await admin.schema.create({
    data: {
      name: `${TEST_PREFIX}-schemaB`,
      columns: { create: [{ name: "v", dataType: "TEXT", required: true, order: 0 }] },
      projects: { create: { projectId: projectB } },
    },
  });
  schemaA = sa.id;
  schemaB = sb.id;

  // One valid upload per org with two rows + two validation results
  const fa = await admin.fileUpload.create({
    data: { userId: userA, schemaId: schemaA, fileName: "a.csv", status: "VALID" },
  });
  const fb = await admin.fileUpload.create({
    data: { userId: userB, schemaId: schemaB, fileName: "b.csv", status: "VALID" },
  });
  uploadA = fa.id;
  uploadB = fb.id;

  await admin.uploadRow.createMany({
    data: [
      { uploadId: uploadA, rowIndex: 1, data: { v: "a1" } },
      { uploadId: uploadA, rowIndex: 2, data: { v: "a2" } },
      { uploadId: uploadB, rowIndex: 1, data: { v: "b1" } },
      { uploadId: uploadB, rowIndex: 2, data: { v: "b2" } },
    ],
  });

  await admin.validationResult.createMany({
    data: [
      { uploadId: uploadA, row: 1, column: "v", value: "a1", error: "noopA" },
      { uploadId: uploadB, row: 1, column: "v", value: "b1", error: "noopB" },
    ],
  });
});

afterAll(async () => {
  // Cleanup in reverse FK order. Admin bypasses RLS, so this always works.
  await admin.uploadRow.deleteMany({ where: { uploadId: { in: [uploadA, uploadB] } } });
  await admin.validationResult.deleteMany({ where: { uploadId: { in: [uploadA, uploadB] } } });
  await admin.fileUpload.deleteMany({ where: { id: { in: [uploadA, uploadB] } } });
  await admin.schema.deleteMany({ where: { id: { in: [schemaA, schemaB] } } });
  await admin.project.deleteMany({ where: { id: { in: [projectA, projectB] } } });
  await admin.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await admin.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await admin.$disconnect();
  await app.$disconnect();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("FileUpload RLS", () => {
  it("orgA can see its own upload", async () => {
    const rows = await asOrg(orgA, (tx) => tx.fileUpload.findMany({ where: { id: uploadA } }));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(uploadA);
  });

  it("orgA cannot see orgB's upload by id", async () => {
    const rows = await asOrg(orgA, (tx) => tx.fileUpload.findMany({ where: { id: uploadB } }));
    expect(rows).toHaveLength(0);
  });

  it("findMany without an explicit filter is org-scoped", async () => {
    const all = await asOrg(orgA, (tx) =>
      tx.fileUpload.findMany({ where: { fileName: { startsWith: "" } } })
    );
    // Must not include orgB's upload — RLS filters it before the where clause sees it.
    expect(all.find((u) => u.id === uploadB)).toBeUndefined();
    expect(all.find((u) => u.id === uploadA)).toBeDefined();
  });

  it("an unset org context returns zero rows", async () => {
    // No set_config call — the var is empty, so the predicate fails.
    const rows = await app.fileUpload.findMany({ where: { id: { in: [uploadA, uploadB] } } });
    expect(rows).toHaveLength(0);
  });

  it("WITH CHECK blocks inserting an upload for a different org's user", async () => {
    // App as orgA tries to plant a row whose userId belongs to orgB.
    await expect(
      asOrg(orgA, (tx) =>
        tx.fileUpload.create({
          data: { userId: userB, schemaId: schemaA, fileName: "evil.csv", status: "PENDING" },
        })
      )
    ).rejects.toThrow();
  });
});

describe("UploadRow RLS", () => {
  it("orgA sees only its own rows", async () => {
    const rows = await asOrg(orgA, (tx) =>
      tx.uploadRow.findMany({ where: { uploadId: { in: [uploadA, uploadB] } } })
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.uploadId === uploadA)).toBe(true);
  });

  it("orgB sees only its own rows", async () => {
    const rows = await asOrg(orgB, (tx) =>
      tx.uploadRow.findMany({ where: { uploadId: { in: [uploadA, uploadB] } } })
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.uploadId === uploadB)).toBe(true);
  });

  it("count(*) is org-filtered", async () => {
    const aCount = await asOrg(orgA, (tx) => tx.uploadRow.count({ where: { uploadId: uploadA } }));
    const bCount = await asOrg(orgA, (tx) => tx.uploadRow.count({ where: { uploadId: uploadB } }));
    expect(aCount).toBe(2);
    expect(bCount).toBe(0); // orgA can't see orgB's rows even with explicit uploadId filter
  });
});

describe("ValidationResult RLS", () => {
  it("orgA sees only its validation results", async () => {
    const rows = await asOrg(orgA, (tx) => tx.validationResult.findMany({}));
    expect(rows.some((r) => r.error === "noopA")).toBe(true);
    expect(rows.some((r) => r.error === "noopB")).toBe(false);
  });
});

describe("Schema / Project / SchemaProject RLS", () => {
  it("orgA sees only schemas linked to its projects", async () => {
    const rows = await asOrg(orgA, (tx) =>
      tx.schema.findMany({ where: { id: { in: [schemaA, schemaB] } } })
    );
    expect(rows.map((s) => s.id)).toEqual([schemaA]);
  });

  it("orgA sees only its projects", async () => {
    const rows = await asOrg(orgA, (tx) =>
      tx.project.findMany({ where: { id: { in: [projectA, projectB] } } })
    );
    expect(rows.map((p) => p.id)).toEqual([projectA]);
  });

  it("orgA sees only its SchemaProject links", async () => {
    const links = await asOrg(orgA, (tx) => tx.schemaProject.findMany({}));
    expect(links.some((l) => l.schemaId === schemaA && l.projectId === projectA)).toBe(true);
    expect(links.some((l) => l.schemaId === schemaB)).toBe(false);
  });
});

describe("Admin bypass", () => {
  it("admin client sees all orgs", async () => {
    const uploads = await admin.fileUpload.findMany({
      where: { id: { in: [uploadA, uploadB] } },
    });
    expect(uploads).toHaveLength(2);
  });

  it("admin sees both schemas", async () => {
    const schemas = await admin.schema.findMany({ where: { id: { in: [schemaA, schemaB] } } });
    expect(schemas).toHaveLength(2);
  });
});

describe("Join paths preserve isolation", () => {
  it("findFirst on FileUpload with nested schema include does not leak across orgs", async () => {
    // orgA tries to look up orgB's upload by joining on its schema name. Should
    // still come back empty because RLS filters FileUpload first.
    const found = await asOrg(orgA, (tx) =>
      tx.fileUpload.findFirst({
        where: { schema: { name: { contains: "schemaB" } } },
        include: { schema: true },
      })
    );
    expect(found).toBeNull();
  });
});
