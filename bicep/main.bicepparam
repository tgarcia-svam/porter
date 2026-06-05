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
param appServiceSkuName = 'B2'
param dbSkuName         = 'Standard_B1ms'
param dbSkuTier         = 'Burstable'

// ── NextAuth ──────────────────────────────────────────────────────────────────
param nextauthUrl = 'https://porterdata.com'
// nextauthSecret  → secret in main.secrets.bicepparam

// ── Google SSO (optional — leave empty to disable) ────────────────────────────
param googleClientId = ''
// googleClientSecret → secret in main.secrets.bicepparam

// ── Microsoft Entra ID SSO ────────────────────────────────────────────────────
param azureAdClientId = '6f2fb008-8f5e-4f18-a8d1-6267514660f6'
param azureAdTenantId = 'common'
// azureAdClientSecret → secret in main.secrets.bicepparam

// ── Initial admin ─────────────────────────────────────────────────────────────
param seedAdminEmail = 'tgarcia@svam.com'

// ── Image tag — overridden to github.sha in CI ────────────────────────────────
param containerTag = 'latest'

// ── Service Bus / async worker ────────────────────────────────────────────────
param serviceBusQueueName  = 'porter-uploads'
param uploadWorkerSecret   = ''   // overridden in main.secrets.bicepparam

// ── Retention job (daily cleanup) ─────────────────────────────────────────────
param retentionWorkerSecret = ''   // overridden in main.secrets.bicepparam

// ── Data-warehouse export (optional — leave URL empty to disable) ─────────────
// Secret-less cross-tenant access via a user-assigned managed identity (created
// by this template). Destination container + root path are set in the admin UI.
// Fill these with the data team's federated app once they've set up the trust;
// the deployment outputs the identity client/principal IDs to hand them.
param warehouseStorageAccountUrl = ''
param warehouseTenantId          = ''
param warehouseClientId          = ''
