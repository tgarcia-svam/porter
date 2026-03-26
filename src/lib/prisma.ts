import { PrismaClient } from "@prisma/client";
import { auditStore } from "./audit-context";

// ── Audit configuration ───────────────────────────────────────────────────────

const MUTATION_OPS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

// Skip audit for the audit table itself (recursion) and high-volume row tables.
const EXCLUDED_MODELS = new Set(["AuditLog", "UploadRow", "ValidationResult"]);

function extractId(result: unknown): string | undefined {
  if (result && typeof result === "object" && !Array.isArray(result) && "id" in result) {
    const id = (result as { id: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
}

// ── Client factory ────────────────────────────────────────────────────────────

function makePrismaClient() {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(args);

          if (model && MUTATION_OPS.has(operation) && !EXCLUDED_MODELS.has(model)) {
            const ctx = auditStore.getStore();
            // Fire-and-forget — audit failure must never break the main request.
            base.auditLog
              .create({
                data: {
                  action: operation,
                  model,
                  recordId: extractId(result),
                  userId: ctx?.userId ?? null,
                  userEmail: ctx?.userEmail ?? null,
                  ipAddress: ctx?.ip ?? null,
                },
              })
              .catch(() => {});
          }

          return result;
        },
      },
    },
  });
}

// ── Singleton (dev hot-reload safe) ──────────────────────────────────────────

type ExtendedPrismaClient = ReturnType<typeof makePrismaClient>;
const globalForPrisma = globalThis as unknown as { prisma: ExtendedPrismaClient };

export const prisma = globalForPrisma.prisma ?? makePrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
