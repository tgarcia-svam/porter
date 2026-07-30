import { PrismaClient } from "@prisma/client";
import { auditStore } from "./audit-context";

/**
 * Admin Prisma client — connects with a role that has BYPASSRLS.
 *
 * Use this client for:
 *   - All admin routes (organisations, projects, schemas, users, classifications, settings)
 *   - The upload worker (/api/upload/process) which runs without a user session
 *   - Migrations and seed scripts
 *
 * Do NOT use this client for user-facing data reads — those must go through
 * the default `prisma` client wrapped in `withOrgContext()` so RLS enforces
 * cross-organisation isolation.
 *
 * Connection URL falls back to DATABASE_URL when DATABASE_URL_ADMIN is unset,
 * which keeps single-role deployments working without configuration changes.
 * Name matches docker-entrypoint.sh and bicep app settings.
 */

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

const EXCLUDED_MODELS = new Set(["AuditLog", "UploadRow", "ValidationResult"]);

function extractId(result: unknown): string | undefined {
  if (result && typeof result === "object" && !Array.isArray(result) && "id" in result) {
    const id = (result as { id: unknown }).id;
    return typeof id === "string" ? id : undefined;
  }
}

function makeAdminClient() {
  // Use datasourceUrl (the Prisma 5+ single-string override) instead of the
  // conditional datasources object — passing { db: { url } } | undefined as
  // datasources confuses Prisma 6's TypeMap inference and strips all model
  // types from the extended client, causing TS2339 on every model accessor.
  const base = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasourceUrl: process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL,
  });

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const result = await query(args);
          if (model && MUTATION_OPS.has(operation) && !EXCLUDED_MODELS.has(model)) {
            const ctx = auditStore.getStore();
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

type AdminClient = ReturnType<typeof makeAdminClient>;
const globalForAdmin = globalThis as unknown as { prismaAdmin: AdminClient };

export const prismaAdmin = globalForAdmin.prismaAdmin ?? makeAdminClient();

if (process.env.NODE_ENV !== "production") globalForAdmin.prismaAdmin = prismaAdmin;
