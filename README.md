# Porter

Porter is a multi-tenant web application for **uploading, validating, and visualizing
tabular data files**. Administrators define reusable *file formats* (schemas) with typed
columns, value classifications, and dashboards; end users upload CSV/Excel files (or enter
rows by hand) that are validated against those formats, stored, and surfaced as charts.

- **Validation engine** — per-column type checks (text, number, integer, boolean, date,
  email) plus *classifications*: value lists, regex patterns, numeric ranges, and date
  ranges, each with an admin-authored description shown to uploaders.
- **Two ways to get data in** — drag-and-drop file upload (CSV via PapaParse, Excel via
  ExcelJS) or an inline manual data-entry grid.
- **Dashboards** — admins configure Indicator / Bar / Line visualizations per file format;
  uploaders see them computed over the latest valid upload.
- **Multi-tenant & secure** — organization isolation enforced at the database layer with
  PostgreSQL Row-Level Security; SSO via Google and Microsoft Entra ID; on-upload malware
  scanning; configurable retention; optional Parquet export to an external data warehouse.

---

## Tech stack

| Area | Technology |
|------|------------|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Auth | NextAuth.js v5 (Google + Microsoft Entra ID SSO) |
| ORM / DB | Prisma v6 + PostgreSQL 16 |
| Styling | Tailwind CSS v4 |
| Charts | Recharts |
| File parsing | PapaParse (CSV), ExcelJS (Excel) |
| Cloud (prod) | Azure App Service (containers), PostgreSQL Flexible Server, Blob Storage, Key Vault, Service Bus, Functions, Application Insights |
| Tests | Vitest (unit), Playwright (integration) |

---

## How it works

### Roles

- **Admin** — manages organizations, projects, users, file formats (schemas),
  classifications, dashboards, and settings under `/admin`.
- **Uploader** — selects a project + file format and uploads or hand-enters data under
  `/upload`.

### Admin workflow

1. **Organizations & projects** (`/admin/organizations`, `/admin/projects`) — set up tenants
   and the projects data is grouped under.
2. **Classifications** (`/admin/classifications`) — define reusable value rules:
   - *Value list* — an allowed set of values (optionally case-insensitive).
   - *Regex* — a pattern values must match.
   - *Number range* / *Date range* — inclusive min/max bounds.
   Each rule can carry a description shown to uploaders in the format spec.
3. **File formats / schemas** (`/admin/schemas`) — define ordered columns (name, data type,
   required flag, optional classification) and **visualizations** (Indicator/Bar/Line with an
   aggregate of count/sum/avg/min/max/median; Bar/Line group by an x-axis column, with
   optional day/month/year bucketing for date axes). Assign formats to projects.
4. **Users** (`/admin/users`) — invite/assign users and roles.
5. **Settings** (`/admin/settings`) — retention policy and the external data-warehouse export
   destination.

### Uploader workflow

1. Go to `/upload`, pick a **project** and **file format**.
2. **Upload** a CSV/Excel file, or use the **Manual entry** grid (value-list columns get a
   dropdown; other classified columns validate inline as you type).
3. Review validation results; valid uploads are stored and feed the **Dashboard** tab.

---

## Local development

### Prerequisites

- Node.js 24 (the Docker image builds on `node:24-alpine`; Node 20+ works for local dev)
- A PostgreSQL 16 database (use Docker Compose below, or any local/remote Postgres)

### 1. Install & configure

```bash
npm install
cp .env.example .env          # Prisma CLI reads .env
cp .env.example .env.local    # Next.js runtime reads .env.local
```

Fill in the values (see [Environment variables](#environment-variables)). At minimum you
need `DATABASE_URL` and `NEXTAUTH_SECRET` (generate with `openssl rand -base64 32`). Keep
`DATABASE_URL` in sync between `.env` and `.env.local`.

> On a corporate network where TLS interception breaks Prisma's engine downloads, prefix
> Prisma commands with `NODE_TLS_REJECT_UNAUTHORIZED=0`.

### 2. Initialize the database

```bash
npm run db:generate          # generate the Prisma client
npm run db:push              # sync schema to the database (dev only)
npm run db:rls               # apply Row-Level Security policies (idempotent)
SEED_ADMIN_EMAIL=you@example.com npm run db:seed   # seed the first admin user
```

### 3. Run

```bash
npm run dev                  # http://localhost:3000
```

### Handy scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` | Lint |
| `npm run db:push` | Sync Prisma schema to the DB (dev) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:studio` | Open Prisma Studio |
| `npm run db:seed` | Seed admin user(s) (`SEED_ADMIN_EMAIL`) |
| `npm run db:rls` | Apply RLS policies |
| `npm run db:create-app-user` | Create the least-privilege runtime DB user |
| `npx vitest run` | Run unit tests |
| `npm run test:integration` | Run integration tests |

---

## Run with Docker Compose

Brings up Postgres + the app together. Provide the referenced variables via a `.env` file or
your shell, then:

```bash
docker compose up --build      # app on http://localhost:3000
```

The container entrypoint ([`docker-entrypoint.sh`](docker-entrypoint.sh)) automatically syncs
the schema, applies RLS, and seeds the admin user on startup. In `NODE_ENV=production` it runs
`prisma migrate deploy` (non-destructive, migration-file based) instead of `db push`.

---

## Environment variables

Set in `.env` (Prisma CLI) and `.env.local` (Next.js runtime) for local dev; in production
these come from App Service application settings, with secrets resolved from Key Vault at
startup (see [`src/lib/secrets.ts`](src/lib/secrets.ts)).

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | Postgres connection string (app/runtime). Also used by the Prisma CLI. |
| `DATABASE_URL_ADMIN` | prod | Elevated connection used only for migrations/RLS (table owner). Falls back to `DATABASE_URL` locally. |
| `NEXTAUTH_SECRET` | ✅ | Session signing secret (`openssl rand -base64 32`). |
| `NEXTAUTH_URL` | ✅ | Public base URL (e.g. `http://localhost:3000`). |
| `AUTH_TRUST_HOST` | ✅ | `true` behind a proxy / App Service. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | Enables Google SSO when both are set. |
| `AZURE_AD_CLIENT_ID` / `AZURE_AD_CLIENT_SECRET` / `AZURE_AD_TENANT_ID` | — | Enables Microsoft Entra ID SSO when ID+secret are set. |
| `KEY_VAULT_URL` | prod | Key Vault that holds production secrets. |
| `AZURE_STORAGE_ACCOUNT_URL` / `AZURE_STORAGE_CONTAINER` | — | Blob storage for uploaded files. |
| `AZURE_STORAGE_CONNECTION_STRING` | — | Local alternative to managed identity for blob access. |
| `AZURE_DIRECT_UPLOAD_ENABLED` | — | `true` to upload directly to blob via SAS URLs. |
| `MALWARE_SCAN_TIMEOUT_MS` / `MALWARE_SCAN_FAIL_CLOSED` | prod | Defender-for-Storage scan gating. |
| `AZURE_SERVICE_BUS_NAMESPACE` / `AZURE_SERVICE_BUS_QUEUE_NAME` | — | Async upload processing (synchronous when unset). |
| `UPLOAD_WORKER_SECRET` | — | Shared secret the worker sends to `/api/upload/process`. |
| `RETENTION_WORKER_SECRET` | — | Shared secret the retention job sends to `/api/admin/retention/run`. |
| `WAREHOUSE_MI_CLIENT_ID` / `WAREHOUSE_MI_PRINCIPAL_ID` | — | Managed-identity IDs for cross-tenant Parquet export (injected on Azure). |
| `SEED_ADMIN_EMAIL` | ✅ (first run) | Email of the admin seeded on startup. |

> **Secrets** belong in `.env.local` / Key Vault, never in `.env` (which is for the Prisma
> CLI). A provider is only enabled when *both* its client ID and secret are present.

---

## Azure deployment

Production runs as a Docker container on Azure App Service. Everything is defined in
[`bicep/main.bicep`](bicep/main.bicep), which provisions a complete environment from an empty
resource group: VNet + private DNS/endpoints, PostgreSQL Flexible Server, Blob Storage (with
Defender malware scanning), Container Registry, Key Vault, Service Bus + Functions worker,
Log Analytics + Application Insights, and all the managed-identity role assignments.

### One-time infrastructure deploy

```bash
az group create --name porter-setup --location canadacentral

az deployment group create \
  --resource-group porter-setup \
  --template-file bicep/main.bicep \
  --parameters bicep/main.bicepparam \
  --parameters bicep/main.secrets.bicepparam   # secrets — gitignored, do not commit
```

Non-secret parameters live in `bicep/main.bicepparam`; secret parameters
(`dbAdminPassword`, `nextauthSecret`, OAuth secrets, worker secrets, …) live in
`bicep/main.secrets.bicepparam`, which is **gitignored and holds live credentials**.

Key outputs include `appUrl`, `acrLoginServer`, `dbHostname`, `keyVaultUri`, and the
`warehouse*` identity values handed to the data team to set up the cross-tenant federated
credential for Parquet export.

### Continuous deployment

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on push to `main` (and via
`workflow_dispatch`): it builds and pushes the image to ACR, deploys the Bicep template with
secrets injected from GitHub Actions secrets/vars, restarts the App Service, and packages and
deploys the upload-worker Function App. Configure these in the repo's `dev` environment:

- **Secrets**: `AZURE_CREDENTIALS`, `NEXTAUTH_SECRET`, `DB_ADMIN_PASSWORD`,
  `DB_APP_USER_PASSWORD`, `AZURE_AD_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`,
  `UPLOAD_WORKER_SECRET`, `RETENTION_WORKER_SECRET`.
- **Variables**: `SEED_ADMIN_EMAIL`, `GOOGLE_CLIENT_ID`, `AZURE_AD_CLIENT_ID`,
  `AZURE_AD_TENANT_ID`.

### Database migrations in production

Local dev uses `prisma db push`; production uses migration files. To ship a schema change:

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate a migration
npx prisma migrate dev --name <change>
# 3. Commit prisma/migrations/<timestamp>_<change>/ and deploy
```

On container startup, `prisma migrate deploy` applies any pending migrations (non-destructive,
in order), then RLS policies are re-applied and admin users are upserted.

---

## Security model

- **Tenant isolation** — organization data is segregated with PostgreSQL Row-Level Security;
  the app runs under a least-privilege DB user and sets the org context per request. Admin-owned
  config (schemas, classifications, visualizations) is read via a separate admin client.
- **Secrets** — never stored in the database or in `.env`; production secrets are pulled from
  Azure Key Vault into `process.env` at startup, and SSO is enabled only when both the client ID
  and secret are present.
- **Uploads** — scanned by Microsoft Defender for Storage; with fail-closed enabled, uploads
  whose scan hasn't completed in time are held rather than let through.

---

## Testing

```bash
npx vitest run               # unit tests
npx tsc --noEmit             # type-check
npm run test:integration     # Playwright integration tests
```

---

## License

Licensed under the **GNU Affero General Public License v3.0**. See [`LICENSE`](LICENSE).
