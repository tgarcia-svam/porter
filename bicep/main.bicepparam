using './main.bicep'

// ── Region ────────────────────────────────────────────────────────────────────
param location = 'canadacentral'

// ── Resource names ────────────────────────────────────────────────────────────
param appServiceName   = 'porter-app'
param acrName          = 'portercontainerregistry'
param storageAccountName  = 'svamanalyticsporter'
param storageContainerName = 'porter-uploads'

// ── Database ──────────────────────────────────────────────────────────────────
param dbServerName = 'porter-postgres'
param dbName       = 'porter-database'
param dbAdminUser     = 'porteradmin'
param dbAdminPassword    = ''   // overridden in main.secrets.bicepparam
param dbAppUserPassword  = ''   // overridden in main.secrets.bicepparam

// ── App Service ───────────────────────────────────────────────────────────────
param appServiceSkuName = 'B1'
param dbSkuName         = 'Standard_B1ms'
param dbSkuTier         = 'Burstable'

// ── NextAuth ──────────────────────────────────────────────────────────────────
param nextauthUrl = 'https://porterdata.com'
// nextauthSecret  → secret in main.secrets.bicepparam

// ── SSO providers ─────────────────────────────────────────────────────────────
// SSO config is managed in the GitHub Environment, NOT here: client IDs are
// Environment *variables* (GOOGLE_CLIENT_ID, AZURE_AD_CLIENT_ID, AZURE_AD_TENANT_ID)
// and secrets are Environment *secrets* (GOOGLE_CLIENT_SECRET, AZURE_AD_CLIENT_SECRET).
// CI passes them inline (see .github/workflows/deploy.yml), overriding the empty
// defaults below. A manual `az deployment` must pass them explicitly, or the
// providers stay disabled. Keeping ID + secret together in GitHub avoids drift.
param googleClientId  = ''
param azureAdClientId = ''
param azureAdTenantId = 'common'

// ── Initial admin ─────────────────────────────────────────────────────────────
param seedAdminEmail = 'tgarcia@svam.com'

// ── Image tag — overridden to github.sha in CI ────────────────────────────────
param containerTag = 'latest'

// ── Service Bus / async worker ────────────────────────────────────────────────
param serviceBusQueueName  = 'porter-uploads'
param uploadWorkerSecret   = ''   // overridden in main.secrets.bicepparam

// ── Retention job (daily cleanup) ─────────────────────────────────────────────
param retentionWorkerSecret = ''   // overridden in main.secrets.bicepparam

// ── Local auth (username/password + MFA) ──────────────────────────────────────
// AES-256 key (base64, 32 bytes) for encrypting MFA TOTP secrets. Empty here;
// CI passes secrets.MFA_ENCRYPTION_KEY inline. Leaving it empty disables MFA.
param mfaEncryptionKey = ''

// ── Email deliverability (Azure Communication Services) ────────────────────────
// Custom sender domain so invite/reset mail is SPF/DKIM-authenticated (out of spam).
// Two-phase: deploy once with emailDomainVerified=false, publish the DNS records
// from the emailDomainVerificationRecords output + verify them, then flip to true.
param emailSenderDomain   = 'mail.porterdata.com'
param emailDomainVerified = false

// ── Data-warehouse export ─────────────────────────────────────────────────────
// No params here: the destination is configured in the admin Settings UI. The
// deployment only creates a user-assigned managed identity (see main.bicep) and
// outputs its client/principal IDs for the data team's federated credential.
