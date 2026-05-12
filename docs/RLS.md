# Row-Level Security (RLS) — Org Isolation

PostgreSQL RLS enforces cross-organisation isolation at the database layer so that an app-layer mistake cannot leak data between tenants.

## Roles

| Role         | RLS behaviour | Used by                                                  |
|--------------|---------------|----------------------------------------------------------|
| superuser /  owner | BYPASSRLS (implicit) | Migrations; `prismaAdmin`; the upload worker.      |
| `porterapp`  | RLS enforced  | App runtime (`prisma`) for all user-facing routes.       |

Provision the app role once per environment:

```bash
PORTER_APP_USER_PASSWORD=<strong-password> npm run db:create-app-user
```

This prints the connection string to set as `DATABASE_URL`. Keep the original (admin) URL as `DATABASE_URL_ADMIN`.

## Apply / re-apply policies

```bash
npm run db:rls
```

The script is idempotent — safe to re-run after schema changes. It installs the `current_app_org()` / `current_app_user()` helper functions and the per-table policies in [prisma/apply-rls.ts](../prisma/apply-rls.ts).

## Policies in effect

| Table              | Predicate                                                             |
|--------------------|-----------------------------------------------------------------------|
| `FileUpload`       | `User.organizationId = app.current_org_id` (uploader's org)           |
| `UploadRow`        | inherits via `FileUpload → User`                                       |
| `ValidationResult` | inherits via `FileUpload → User`                                       |
| `Schema`           | any project linked to `app.current_org_id`                            |
| `SchemaProject`    | project linked to `app.current_org_id`                                |
| `Project`          | linked to `app.current_org_id` via `ProjectOrganization`              |
| `SchemaColumn`     | inherited from parent `Schema`                                         |
| `User`             | own row OR same `organizationId` as `app.current_org_id`              |
| `Organization`     | own org (`id = app.current_org_id`)                                    |
| `Classification`, `AppSetting` | read-only — admin-managed via BYPASSRLS                       |
| `AuditLog`         | append-only (INSERT + SELECT only)                                     |

Unset session vars (i.e. forgetting to call `withOrgContext`) result in **zero rows visible** — fail-safe.

## Application API

### Reading / writing org-scoped data — use `withOrgContext`

```ts
import { withOrgContext } from "@/lib/with-org-context";

const result = await withOrgContext(orgId, async (tx) => {
  return tx.fileUpload.findMany({ where: { schemaId } });
}, userId /* optional */);
```

The helper wraps the callback in a Prisma transaction and sets `app.current_org_id` with `set_config(..., is_local = true)`, so the variable is cleared automatically at commit/rollback and cannot leak across pooled connections.

### Routes that intentionally cross orgs — use `prismaAdmin`

```ts
import { prismaAdmin } from "@/lib/prisma-admin";

// All routes under /api/{organizations,projects,schemas,users,classifications,settings}
// import { prismaAdmin as prisma } so they bypass RLS.
```

The upload worker (`/api/upload/process`) also uses `prismaAdmin` because it has no user session.

### Authentication

`src/lib/auth.ts` runs before any org context exists (the user is being authenticated). It uses `prismaAdmin` for user lookup and lockout updates.

## Verifying isolation

Integration tests in [tests/integration/rls.test.ts](../tests/integration/rls.test.ts) seed two orgs and prove:

- orgA cannot read orgB's `FileUpload`, `UploadRow`, `ValidationResult`, `Schema`, `Project`, or `SchemaProject` rows.
- An unset `app.current_org_id` returns zero rows.
- `WITH CHECK` blocks an authenticated user from inserting a `FileUpload` for another org's user.
- `prismaAdmin` correctly bypasses RLS.

```bash
DATABASE_URL=postgresql://porterapp:...@host:5432/porter \
DATABASE_URL_ADMIN=postgresql://admin:...@host:5432/porter \
npm run test:integration
```

## Migrating remaining write routes

`/api/upload`, `/api/upload/sas`, `/api/upload/confirm`, `/api/upload/manual` currently import `prismaAdmin as prisma` and rely on app-layer checks for org isolation (marked with `TODO(RLS)` comments). To migrate:

1. Look up `user.organizationId` with `prismaAdmin` (no context yet).
2. Wrap the access check + schema read + `FileUpload.create` + `UploadRow.createMany` in a single `withOrgContext(orgId, fn, userId)` callback.
3. Verify the route still works end-to-end; the `WITH CHECK` clause will reject any `FileUpload.create` whose `userId` doesn't belong to the current org — useful for catching mistakes.

## Cutover checklist

Before flipping `DATABASE_URL` to `porterapp`:

- [ ] `npm run db:create-app-user` has been run in this env.
- [ ] `npm run db:rls` has been run with the latest policy set.
- [ ] `DATABASE_URL_ADMIN` is set for the worker and migrations.
- [ ] `npm run test:integration` passes.
- [ ] The remaining `TODO(RLS)` routes have been migrated, OR you've accepted that those routes continue to use `prismaAdmin` (no DB-level enforcement on the upload write path — same posture as today).
