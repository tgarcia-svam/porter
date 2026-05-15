import { prisma } from "./prisma";

/**
 * Wraps a sequence of Prisma operations in a transaction that sets the
 * `app.current_org_id` session variable, which the RLS policies read to
 * enforce cross-organisation isolation.
 *
 * Usage:
 *   const result = await withOrgContext(orgId, async (tx) => {
 *     return tx.fileUpload.findMany({ where: { schemaId } });
 *     // RLS automatically filters this to rows whose uploader is in `orgId`.
 *   });
 *
 * Notes:
 *   - The `tx` argument is a transaction client. Nested transactions are not
 *     supported by Prisma, so callers must do all related work inside the fn.
 *   - `set_config(..., true)` makes the variable transaction-local — it is
 *     automatically cleared when the transaction commits or rolls back, so
 *     it can never leak to another request on a pooled connection.
 *   - Pass `userId` when a policy needs to distinguish the current user
 *     from other org members (e.g. the User self-read policy).
 */

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function withOrgContext<T>(
  orgId: string,
  fn: (tx: TxClient) => Promise<T>,
  userId?: string
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
    if (userId) {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    }
    return fn(tx);
  });
}
