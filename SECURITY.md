# Porter — Security Reference

This document describes the security architecture, configuration parameters, and operational
procedures for the Porter data-upload platform. It is intended for three audiences:

- **Users** — people who log in and upload files
- **Developers** — teams integrating with or extending Porter
- **Security analysts** — reviewers performing risk assessments or compliance audits

---

## Table of Contents

1. [Security Architecture Overview](#1-security-architecture-overview)
2. [Authentication and Authorization](#2-authentication-and-authorization)
3. [Password and Credential Policy](#3-password-and-credential-policy)
4. [Session Management](#4-session-management)
5. [Data Protection](#5-data-protection)
6. [Privacy and Data Handling](#6-privacy-and-data-handling)
7. [Audit Logging](#7-audit-logging)
8. [Malware Protection](#8-malware-protection)
9. [Rate Limiting and CSRF Protection](#9-rate-limiting-and-csrf-protection)
10. [Secrets and Key Management](#10-secrets-and-key-management)
11. [Data Retention and Sanitization](#11-data-retention-and-sanitization)
12. [Backup, Restore, and Disaster Recovery](#12-backup-restore-and-disaster-recovery)
13. [External Integrations and Communications](#13-external-integrations-and-communications)
14. [Secure Deployment Configuration](#14-secure-deployment-configuration)
15. [Emergency Procedures](#15-emergency-procedures)
16. [Security Parameters Reference](#16-security-parameters-reference)

---

## 1. Security Architecture Overview

Porter is a Next.js 16 (App Router) web application deployed to Azure App Service. Its security
model rests on four layers:

| Layer | Mechanism |
|---|---|
| Network | HTTPS-only; `www` → apex canonical redirect (308) |
| Application | NextAuth.js v5 JWT sessions; role-based access guards on every API route |
| Database | PostgreSQL Row-Level Security (RLS) enforcing org-boundary isolation |
| Storage | Azure Blob Storage with Managed Identity; no storage account keys in code |

**Roles:** Two roles exist — `admin` and `uploader`. Admins manage schemas, users, and settings.
Uploaders can only submit and view their own uploads.

**Authentication methods:** Each user account has a fixed `authMethod` of either `SSO` (Google or
Microsoft Entra ID) or `PASSWORD` (local username + TOTP MFA). Admins assign the method at
account creation.

---

## 2. Authentication and Authorization

### 2.1 SSO (Google / Microsoft Entra ID)

SSO users authenticate entirely through the identity provider. No password is stored in Porter for
these accounts.

- Configured via environment variables `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `AZURE_AD_CLIENT_ID`, `AZURE_AD_CLIENT_SECRET`, `AZURE_AD_TENANT_ID`
- OAuth 2.0 PKCE flow via NextAuth.js v5; code verifier stored as a host-only cookie — the
  middleware enforces a canonical-host redirect before sign-in to prevent PKCE cookie mismatches
  across `www` and apex hosts

### 2.2 Local Authentication (Password + TOTP MFA)

Password-based accounts require both a password (see §3) and a TOTP authenticator app (e.g. Google
Authenticator, Authy). Both factors are required on every login.

**Login flow:**
1. User submits email + password to `POST /api/account/login`
2. Server verifies bcrypt hash; records failed attempt or success
3. On success, a short-lived HMAC login ticket is returned
4. Client presents the TOTP code; the credentials `authorize()` function validates the ticket +
   TOTP code and issues a signed JWT session

**Failed login handling:**

| Threshold | Window | Effect |
|---|---|---|
| 5 failures | 15 minutes | Temporary lock for 15 minutes |
| 8 failures | 15 minutes | Hard lock — account disabled until admin resets |

Lockout state and timestamps are recorded per user. Admin unlock is performed through the Users
admin panel or `POST /api/admin/users/:id/unlock`.

**Account provisioning:** New password-based accounts receive a single-use invite link via email.
The link contains a cryptographically random token (hashed SHA-256 before storage in the
`AuthToken` table). Links expire after a configurable period and are consumed on first use.

### 2.3 Authorization Enforcement

Every API route that requires authentication calls `requireSession()` (returns HTTP 401 if no
valid session) and `requireAdmin()` where applicable (returns HTTP 403 for non-admin users). Admin
UI routes are wrapped in a server-component layout that redirects unauthenticated or
insufficient-role visitors before any data is fetched.

Database queries for uploader-facing data use `withOrgContext(orgId, ...)`, which sets the
PostgreSQL session variable `app.current_org_id` inside a transaction. RLS policies on every table
evaluate this variable so that a query can only return rows belonging to the caller's organisation,
regardless of the application-level filter applied.

---

## 3. Password and Credential Policy

Applies to `authMethod = PASSWORD` accounts only. SSO users are not affected.

### 3.1 Password Requirements

| Rule | Value |
|---|---|
| Minimum length | 15 characters |
| Character classes | At least 3 of: uppercase, lowercase, digit, special character |
| Allowed special characters | `!"#$%&'()+,-./:;=?@[\]^_`{|}~` |
| Banned passwords | Checked against a common-password list (exact match and dominant-base match) |
| Sequential digits | Monotonic digit runs of 10+ characters are rejected |
| Username in password | The email local-part must not appear in the password |

These rules are enforced server-side on `POST /api/account/reset` and `POST /api/account/change-password`.
The set-password UI also enforces them client-side as a live checklist, but the server is always
authoritative.

### 3.2 Password Expiry

Password expiry is **disabled by default** (`PASSWORD_EXPIRY_DAYS = 0`). Admins can enable it from
**Admin → Settings → Security**.

When enabled, users whose password age exceeds the configured number of days are redirected to
`/account/change-password?expired=1` on their next login. They must successfully change their
password before accessing any other page. SSO users are never subject to this redirect.

Users who have never set a password (e.g. accounts created before the feature was enabled) are
treated as having set their password on the date the policy was first configured, giving them a
full expiry cycle before they are prompted.

### 3.3 Password Storage

Passwords are hashed with **bcrypt** using a work factor of 12. The hash is stored in the `User`
table. Plain-text passwords are never logged, stored, or transmitted beyond the initial hash
computation on the server.

---

## 4. Session Management

### 4.1 Session Tokens

Porter uses signed JWT sessions issued by NextAuth.js. Tokens are stored as `HttpOnly`,
`SameSite=Lax`, `Secure` cookies. The signing key is `NEXTAUTH_SECRET` (≥ 32 bytes,
stored in Azure Key Vault).

| Parameter | Value |
|---|---|
| Idle timeout | 30 minutes — each authenticated request rolls the expiry forward |
| Absolute timeout | 8 hours by default (configurable) — hard maximum regardless of activity |
| Token refresh | On every authenticated request (`updateAge: 0`) |
| Cookie flags | `HttpOnly`, `SameSite=Lax`, `Secure` (production) |

**Absolute vs. idle timeout:** The idle timeout (`maxAge: 30 * 60` with `updateAge: 0`) resets on
every request so an active user is not interrupted mid-work. The absolute timeout is enforced
separately: at sign-in a `absoluteExpiry` timestamp is embedded in the JWT
(`now + ABSOLUTE_SESSION_TIMEOUT_HOURS`). On every subsequent request this timestamp is compared
against the current time; if exceeded the session is revoked immediately, the session registry row
is deleted, and the user is redirected to `/login?reason=session_expired`. This limits the window
of exposure for any hijacked session to at most the configured absolute timeout duration.

The absolute timeout is configurable from **Admin → Settings → Security**. Setting it to `0`
disables it (not recommended for production). The default of 8 hours applies to any deployment
that has not explicitly set `ABSOLUTE_SESSION_TIMEOUT_HOURS` in the `AppSetting` table.

### 4.2 Session Binding

Each session token contains a SHA-256 hash of the User-Agent string at login time. On every
request the middleware recomputes the hash and compares it to the stored value. A mismatch logs an
`auth.session.invalid` audit event and the request is treated as unauthenticated. This reduces the
window of usefulness for a stolen session cookie.

### 4.3 Concurrent Session Limiting

Concurrent session limiting is **disabled by default** (`MAX_CONCURRENT_SESSIONS = 0`). When
enabled, each successful login registers a session record in the `UserSession` table. If the new
login would exceed the configured limit, the oldest session(s) are evicted.

The raw session nonce lives only in the JWT. The database stores only a SHA-256 hash of the nonce,
so a database read cannot reconstruct a valid token.

On every authenticated request, the nonce in the JWT is validated against the `UserSession` table.
If the row is missing (evicted by a newer login or explicitly revoked), the user is redirected to
`/login?reason=session_expired`. Session rows are deleted on explicit sign-out.

### 4.4 Previous Login Notification

After each successful login, a dismissable banner is displayed showing:
- Date and time of the previous login
- IP address of the previous login
- Number of failed login attempts since the previous successful login

The banner persists for the duration of the browser session and is suppressed after the user
dismisses it. It is intended to help users detect unauthorised access.

---

## 5. Data Protection

### 5.1 Data in Transit

All traffic is served over HTTPS. The middleware issues a permanent (308) redirect from any
`www.*` request to the canonical apex hostname, ensuring the full OAuth flow and session cookie
exchange occurs on a single secure host.

Internal connections:
- **Database**: TLS-encrypted connection to Azure Database for PostgreSQL
- **Blob Storage**: All Azure SDK calls use TLS; no plain-HTTP fallback

### 5.2 Data at Rest

| Data type | Storage | Protection |
|---|---|---|
| Uploaded files | Azure Blob Storage | Azure Storage Service Encryption (SSE) with platform-managed keys; optional CMK |
| TOTP secrets | PostgreSQL (`User.mfaEncryptedSecret`) | AES-256-GCM, key held in Azure Key Vault (`MFA_ENCRYPTION_KEY`) |
| Passwords | PostgreSQL (`User.passwordHash`) | bcrypt (one-way, work factor 12) |
| Session nonces | PostgreSQL (`UserSession.tokenHash`) | SHA-256 hash only; raw nonce never persisted |
| Auth tokens (invite/reset) | PostgreSQL (`AuthToken.tokenHash`) | SHA-256 hash only; raw token in email link only |

**AES-256-GCM wire format** (TOTP secrets): `v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>`. The
version prefix supports future key rotation without requiring a schema change.

### 5.3 Database Row-Level Security

PostgreSQL RLS is applied to every table. The `porterapp` runtime role is subject to all policies.
The admin/migration role (`DATABASE_ADMIN_URL`) bypasses RLS implicitly (owner role).

Key policies:

| Table | porterapp access |
|---|---|
| User | Own row + same-organisation users (SELECT only) |
| FileUpload, UploadRow, ValidationResult | Own organisation (full CRUD) |
| AuditLog | Append-only (INSERT + SELECT; no UPDATE or DELETE) |
| UserSession, AuthToken, Passkey | No access (admin-only) |
| AppSetting, Classification | Read-only |

RLS policies are re-applied on every deployment by `prisma/apply-rls.ts`, which runs after
`prisma migrate deploy` in CI/CD.

---

## 6. Privacy and Data Handling

### 6.1 Data Collected

| Category | Examples | Purpose |
|---|---|---|
| Account identity | Email, name (from IdP) | Login, organisation assignment |
| Authentication metadata | Last login time, last login IP, failed attempt count | Security notifications; lockout |
| Uploaded file content | CSV/Excel files submitted by uploaders | Core product function |
| Audit events | Login timestamps, IP addresses, action type | Security audit trail |
| Session metadata | IP address, User-Agent (hashed) | Session binding; concurrent-session registry |

### 6.2 Data Not Collected

- Passwords are never stored in recoverable form
- TOTP secrets are stored encrypted; the plaintext is never logged
- Session nonces are stored as one-way hashes
- No third-party analytics, advertising, or tracking scripts are used

### 6.3 Data Boundaries

Data is strictly partitioned by organisation. A user belonging to Organisation A cannot read,
write, or infer the existence of data belonging to Organisation B. This isolation is enforced at
the database layer via RLS (see §5.3) and is not solely dependent on application-layer filters.

### 6.4 Data Residency

Files uploaded to Porter are stored in the Azure Blob Storage account configured at deployment.
The storage account region is determined by the deploying organisation. No data is replicated to
third-party systems unless the Warehouse Export feature is explicitly configured (see §13.2).

---

## 7. Audit Logging

Porter maintains an append-only `AuditLog` table. The `porterapp` runtime role can INSERT and
SELECT but cannot UPDATE or DELETE rows. Only the admin/migration role can purge log entries (via
the configurable retention policy — see §11).

### 7.1 Logged Events

**Authentication events** (logged by `logAuthEvent` in `src/lib/auth-audit.ts`):

| Event | Trigger |
|---|---|
| `auth.login.success` | Successful password or SSO login |
| `auth.login.failed` | Wrong password or TOTP code |
| `auth.login.blocked` | Login attempt while account is locked |
| `auth.logout` | Explicit sign-out |
| `auth.access.forbidden` | Request to a route the user's role does not permit |
| `auth.session.invalid` | User-Agent mismatch — possible session token theft |

**Data events** (logged on upload, validation, deletion, and admin changes): recorded in the same
`AuditLog` table with the relevant `model`, `recordId`, `userId`, and `ipAddress`.

### 7.2 Accessing Audit Logs

Administrators can view the audit log at **Admin → Audit Log**. Logs are available via
`GET /api/admin/audit` (admin session required). The response is paginated; no bulk export API
exists by default — export should be performed directly from the database for large datasets.

### 7.3 Audit Log Retention

Configurable via `AUDIT_LOG_RETENTION_DAYS` in **Admin → Settings → Retention**. A value of `0`
(the default) means logs are kept indefinitely. When a non-zero value is set, entries older than
that many days are hard-deleted during the daily retention sweep.

---

## 8. Malware Protection

Uploaded files are stored to Azure Blob Storage and then scanned by **Microsoft Defender for
Storage** malware scanning before being treated as valid uploads.

**Scan flow:**
1. File is written to blob storage
2. Application polls blob index tags for the Defender verdict (default timeout: 60 seconds)
3. Verdict tag key matches the pattern `Malware Scanning.*` (case-insensitive substring match)
4. If verdict is `Malicious`: file is flagged; upload is rejected; user is notified
5. If verdict is `Clean`: upload proceeds to validation
6. If verdict is `Pending` (scan not complete within timeout):
   - `MALWARE_SCAN_FAIL_CLOSED=false` (default): upload is allowed through with a warning
   - `MALWARE_SCAN_FAIL_CLOSED=true` (recommended for production): upload is held and rejected

**Configuration:**

| Variable | Default | Description |
|---|---|---|
| `MALWARE_SCAN_FAIL_CLOSED` | `false` | Set `true` to block uploads when scan result is unavailable |
| `MALWARE_SCAN_TIMEOUT_MS` | `60000` | Maximum milliseconds to wait for a scan verdict |

Defender for Storage must be enabled on the Azure Storage account separately from Porter's
application deployment. See the Azure documentation for enablement steps.

---

## 9. Rate Limiting and CSRF Protection

### 9.1 Rate Limiting

In-process rate limiting is applied by `src/middleware.ts` on all API routes, keyed by client IP
address extracted from the last hop of `X-Forwarded-For` (Azure App Service appends the real
client IP at the end of the forwarded chain).

| Path prefix | Limit | Window |
|---|---|---|
| `/api/auth` | 20 requests | 1 minute |
| `/api/account/forgot` | 5 requests | 15 minutes |
| `/api/account/login` | 15 requests | 1 minute |
| `/api/account` | 30 requests | 1 minute |
| `/api/upload` | 10 requests | 1 minute |
| `/api/` (all others) | 120 requests | 1 minute |

Exceeded limits return HTTP 429 with a `Retry-After` header. Limits are stored in process memory.
**For multi-instance deployments, replace the in-process store with a Redis-backed implementation.**

### 9.2 CSRF Protection

Mutation requests (POST, PUT, DELETE, PATCH) to all non-exempt API endpoints require a valid CSRF
token. The token is:

1. Generated as a cryptographically random value and set as a non-`HttpOnly` cookie
   (`SameSite=Strict`) on every page navigation
2. Read by client-side JavaScript and sent as the `X-CSRF-Token` request header
3. Validated by the middleware against the cookie value using HMAC comparison

Exempt endpoints (authenticated by other means, e.g. worker secret header):
- `/api/auth/*` (NextAuth internal)
- `/api/upload/process`, `/api/upload/sas`, `/api/upload/confirm`
- `/api/admin/schedules/run`, `/api/admin/retention/run`

---

## 10. Secrets and Key Management

All production secrets are stored in **Azure Key Vault**. No secrets appear in source code or
committed configuration files.

| Secret | Key Vault name | Description |
|---|---|---|
| `NEXTAUTH_SECRET` | `nextauth-secret` | JWT signing key (≥ 32 bytes) |
| `MFA_ENCRYPTION_KEY` | `mfa-encryption-key` | AES-256 key for TOTP secret encryption (32 bytes, base64 or hex) |
| `GOOGLE_CLIENT_SECRET` | `google-client-secret` | Google OAuth client secret |
| `AZURE_AD_CLIENT_SECRET` | (provider-specific) | Microsoft Entra ID client secret |
| `UPLOAD_WORKER_SECRET` | `upload-worker-secret` | Shared secret for Function App → Porter API calls |

Key Vault access is granted to the App Service Managed Identity. No service principal credentials
or storage account keys are embedded in the application.

**Key rotation:** Key Vault secrets support versioning. Rotating a secret requires updating the
Key Vault value and restarting the App Service (configuration is read at startup). TOTP secrets
encrypted with the old `MFA_ENCRYPTION_KEY` will fail to decrypt after rotation — a migration
script to re-encrypt existing secrets must be run before the old key is retired.

**Generating `MFA_ENCRYPTION_KEY`:**
```bash
openssl rand -base64 32
```

**Generating `NEXTAUTH_SECRET`:**
```bash
openssl rand -base64 32
```

---

## 11. Data Retention and Sanitization

### 11.1 Upload Retention

Porter supports a two-tier retention policy configurable from **Admin → Settings → Retention**:

| Setting | Key | Default | Description |
|---|---|---|---|
| Soft-delete after | `UPLOAD_SOFT_DELETE_DAYS` | `0` (never) | Hides uploads from app queries; recoverable |
| Hard-delete after | `UPLOAD_HARD_DELETE_DAYS` | `0` (never) | Permanently removes file record + row data |
| Audit log retention | `AUDIT_LOG_RETENTION_DAYS` | `0` (never) | Hard-deletes audit entries after N days |

A daily retention sweep runs via `POST /api/admin/retention/run` (triggered by an Azure Function
App timer). The sweep is idempotent. Setting any value to `0` disables that sweep.

Hard-deleting a `FileUpload` row cascades to `UploadRow` and `ValidationResult` via foreign-key
`ON DELETE CASCADE`. The file in Azure Blob Storage is **not** automatically deleted by the
retention sweep — blob lifecycle management must be configured separately in Azure Storage.

### 11.2 Permanent Account Deletion (Sanitization)

To permanently remove a user and all their data:

1. Navigate to **Admin → Users → [user] → Delete**
2. This removes the `User` row; foreign-key cascades remove `FileUpload`, `UploadRow`,
   `ValidationResult`, `UserSession`, and `AuthToken` rows
3. Blob files associated with that user's uploads must be deleted separately using the Azure
   Portal or Azure CLI:
   ```bash
   az storage blob delete-batch \
     --source porter-uploads \
     --pattern "uploads/<userId>/*" \
     --account-name <storage-account>
   ```
4. Audit log entries referencing the user's ID are not automatically removed (audit log integrity).
   Delete them manually if required for compliance:
   ```sql
   DELETE FROM "AuditLog" WHERE "userId" = '<id>';
   ```

### 11.3 Full Environment Sanitization

To decommission a Porter environment and remove all personal data:

1. Delete or empty the Azure Blob Storage container
2. Drop the PostgreSQL database
3. Delete the Azure Key Vault (or rotate all secrets to invalidate any cached values)
4. Delete the App Service and any associated Managed Identity

---

## 12. Backup, Restore, and Disaster Recovery

### 12.1 Database Backups

Azure Database for PostgreSQL provides automated point-in-time restore (PITR) with a configurable
retention window (default 7 days). Geo-redundant backup storage should be enabled for production
deployments.

To restore to a point in time:
1. Use the Azure Portal or CLI to create a restore server
2. Run `prisma migrate deploy` against the restored server to ensure the schema is current
3. Run `npx tsx prisma/apply-rls.ts` against the restored server to re-apply RLS policies (the
   `porterapp` role is not included in PostgreSQL logical backups and must be re-created separately)

### 12.2 Blob Storage Backups

Azure Blob Storage supports soft-delete and versioning. For production deployments:

- Enable **blob soft-delete** with a minimum 7-day retention period
- Enable **container soft-delete** to protect against accidental container deletion
- Consider **geo-redundant storage (GRS)** or **zone-redundant storage (ZRS)** for availability

### 12.3 Recovery Time and Point Objectives

RTO and RPO depend on the Azure configuration chosen by the deploying organisation. Porter itself
has no built-in backup or restore mechanism beyond what Azure services provide.

---

## 13. External Integrations and Communications

### 13.1 Email (Azure Communication Services)

Porter sends email for:
- Invite and password-reset links
- Upload reminder and overdue notifications

Email is sent via Azure Communication Services. The connection string is stored in
`AZURE_COMMUNICATION_CONNECTION_STRING` (Key Vault). No email content contains passwords,
TOTP secrets, or session tokens — invite/reset links carry only a single-use opaque token.

### 13.2 Warehouse Export (Parquet)

When configured, VALID uploads are automatically exported to an external Azure Storage account as
Parquet files. This feature is intended for data team consumption.

- Authentication uses the App Service Managed Identity with a **Federated Identity Credential** on
  the destination storage account — no SAS tokens or account keys
- The destination account is typically in a different Azure tenant (cross-tenant MI federation)
- Configuration: `WAREHOUSE_STORAGE_ACCOUNT_URL`, `WAREHOUSE_CONTAINER` environment variables
- The one-time setup (FIC + RBAC assignment) must be performed by the destination tenant admin
- Export paths are deterministic and idempotent: `<schemaId>/<uploadId>.parquet`

### 13.3 Upload Worker (Azure Function App)

Scheduled uploads and retention sweeps are triggered by an Azure Function App timer that calls:
- `POST /api/admin/schedules/run`
- `POST /api/admin/retention/run`

Both endpoints authenticate via the `X-Worker-Secret` header (value: `UPLOAD_WORKER_SECRET` from
Key Vault). These endpoints are exempt from CSRF validation.

### 13.4 No Removable Media

Porter is a web application with no support for USB, external drives, or other removable media.
All file I/O passes through the browser's file picker → HTTPS upload → Azure Blob Storage path.

---

## 14. Secure Deployment Configuration

### 14.1 Required Environment Variables

The following variables **must** be set before the application will function securely:

| Variable | Description |
|---|---|
| `NEXTAUTH_SECRET` | JWT signing key — at least 32 random bytes, base64 encoded |
| `NEXTAUTH_URL` | Canonical application URL (e.g. `https://porterdata.example.com`) |
| `DATABASE_URL` | PostgreSQL connection string for runtime (`porterapp` role) |
| `DATABASE_ADMIN_URL` | PostgreSQL connection string for migrations and admin routes |
| `MFA_ENCRYPTION_KEY` | AES-256 key for TOTP secret encryption — exactly 32 bytes, base64 or hex |
| `AZURE_STORAGE_ACCOUNT_URL` | Blob storage account URL (Managed Identity auth) |
| `AZURE_STORAGE_CONTAINER` | Container name for uploaded files |

### 14.2 Recommended Production Settings

| Variable | Recommended value | Effect |
|---|---|---|
| `MALWARE_SCAN_FAIL_CLOSED` | `true` | Block uploads when Defender scan result is unavailable |
| `NODE_ENV` | `production` | Enables secure cookie flags and production error handling |

### 14.3 Database Role Setup

Two PostgreSQL roles are required:

```sql
-- Admin/migration role (used by DATABASE_ADMIN_URL; bypasses RLS via ownership)
CREATE ROLE porteradmin WITH LOGIN PASSWORD '...' CREATEROLE;
GRANT ALL ON DATABASE porter TO porteradmin;

-- Runtime role (used by DATABASE_URL; subject to RLS)
CREATE ROLE porterapp WITH LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE porter TO porterapp;
-- Table-level grants are applied by prisma/apply-rls.ts
```

After each migration:
```bash
npx prisma migrate deploy
npx tsx prisma/apply-rls.ts
```

### 14.4 HTTPS and Hostname Configuration

- Configure TLS termination at the Azure Application Gateway or App Service level
- Set `NEXTAUTH_URL` to the apex hostname (not `www`) — the middleware enforces this
- Do not run Porter behind a reverse proxy that strips `X-Forwarded-For` — rate limiting
  and IP logging depend on this header

---

## 15. Emergency Procedures

### 15.1 Locking a Compromised Account

**Immediate lock (admin UI):**
1. Navigate to **Admin → Users**
2. Select the user and click **Lock Account**
3. The account is set to `lockedForReset = true`; all subsequent login attempts are rejected
4. Active sessions remain valid until their 30-minute idle timeout expires

**Force-expire active sessions immediately:**
```sql
-- Deletes all session registry entries for the user, invalidating concurrent sessions
DELETE FROM "UserSession" WHERE "userId" = '<id>';
```

If `MAX_CONCURRENT_SESSIONS` is enabled, session revocation takes effect on the user's next
request. If it is disabled, the only option is to wait for the idle timeout or rotate
`NEXTAUTH_SECRET` (which invalidates all sessions for all users).

### 15.2 Rotating NEXTAUTH_SECRET (All Sessions Invalidated)

Rotating this key immediately invalidates every active session across all users:

1. Generate a new secret: `openssl rand -base64 32`
2. Update the value in Azure Key Vault
3. Restart the App Service to pick up the new value
4. All users are logged out and must re-authenticate

Use this as a last resort when a broad session compromise is suspected.

### 15.3 Disabling a Broken Upload Pipeline

If the upload processing pipeline is producing unexpected results:

1. Set `MALWARE_SCAN_FAIL_CLOSED=true` to hold new uploads at the scan step
2. Alternatively, remove the `UPLOAD_WORKER_SECRET` value from Key Vault to prevent the Function
   App from triggering processing runs
3. Existing files in blob storage are not affected

### 15.4 Database Read-Only Emergency Mode

Azure Database for PostgreSQL supports server-level read-only mode from the portal. Enabling it
prevents all writes (including audit log writes) but allows the application to continue serving
read-only requests. Use for emergency data preservation before an investigation.

### 15.5 Reporting a Security Vulnerability

Report security vulnerabilities to the Porter development team through your organisation's
established security disclosure channel. Do not file public issues for undisclosed vulnerabilities.

---

## 16. Security Parameters Reference

All settings in this table are configurable from **Admin → Settings** or via `AppSetting` DB rows.
A value of `0` means the feature is disabled. Changes take effect immediately (next request reads
the DB value); no restart is required.

| AppSetting key | Default | Description |
|---|---|---|
| `ABSOLUTE_SESSION_TIMEOUT_HOURS` | `8` | Hard maximum session age in hours; 0 = disabled (not recommended) |
| `PASSWORD_EXPIRY_DAYS` | `0` (off) | Days before a password-based user must change their password |
| `MAX_CONCURRENT_SESSIONS` | `0` (unlimited) | Maximum simultaneous sessions per user; 0 = unlimited |
| `UPLOAD_SOFT_DELETE_DAYS` | `0` (never) | Days after which uploads are hidden (soft-deleted) |
| `UPLOAD_HARD_DELETE_DAYS` | `0` (never) | Days after which uploads are permanently deleted |
| `AUDIT_LOG_RETENTION_DAYS` | `0` (never) | Days after which audit log entries are purged |

Fixed security parameters (not configurable at runtime):

| Parameter | Value | Reference |
|---|---|---|
| Password minimum length | 15 characters | `src/lib/password-policy.ts` |
| Password minimum character classes | 3 of 4 | `src/lib/password-policy.ts` |
| Temporary lockout threshold | 5 failed attempts (within 15 min window) | `src/lib/password-auth.ts` |
| Temporary lockout duration | 15 minutes | `src/lib/password-auth.ts` |
| Hard lockout threshold | 8 failed attempts (within 15 min window) | `src/lib/password-auth.ts` |
| Session idle timeout | 30 minutes | `src/lib/auth.ts` |
| Session absolute timeout | 8 hours default (configurable) | `src/lib/auth.ts` |
| Session nonce storage | SHA-256 hash only | `src/lib/session-registry.ts` |
| TOTP secret encryption | AES-256-GCM | `src/lib/crypto-at-rest.ts` |
| Password hashing | bcrypt, work factor 12 | `src/lib/password-auth.ts` |
| Auth token storage | SHA-256 hash only | `src/lib/auth-tokens.ts` |
| CSRF cookie lifetime | 8 hours | `src/middleware.ts` |
| CSRF cookie flags | `SameSite=Strict`, `Secure` (production) | `src/middleware.ts` |
| Login rate limit | 15 requests / 1 minute per IP | `src/middleware.ts` |
| Password-reset rate limit | 5 requests / 15 minutes per IP | `src/middleware.ts` |
| Malware scan timeout | 60 seconds (configurable via `MALWARE_SCAN_TIMEOUT_MS`) | `src/lib/azure-storage.ts` |
