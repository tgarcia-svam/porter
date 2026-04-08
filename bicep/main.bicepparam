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
param dbAdminPassword = ''   // overridden in main.secrets.bicepparam

// ── App Service ───────────────────────────────────────────────────────────────
param appServiceSkuName = 'B2'
param dbSkuName         = 'Standard_B1ms'
param dbSkuTier         = 'Burstable'

// ── NextAuth ──────────────────────────────────────────────────────────────────
param nextauthUrl = 'https://www.porterdata.com'
// nextauthSecret  → secret in main.secrets.bicepparam

// ── Google SSO (optional — leave empty to disable) ────────────────────────────
param googleClientId = ''
// googleClientSecret → secret in main.secrets.bicepparam

// ── Microsoft Entra ID SSO ────────────────────────────────────────────────────
param azureAdClientId = '2dee6845-f88d-48b7-b411-b0c43aa6d7f1'
param azureAdTenantId = 'common'
// azureAdClientSecret → secret in main.secrets.bicepparam

// ── Initial admin ─────────────────────────────────────────────────────────────
param seedAdminEmail = 'tgarcia@svam.com'

// ── Image tag — overridden to github.sha in CI ────────────────────────────────
param containerTag = 'latest'

// ── Service Bus / async worker ────────────────────────────────────────────────
param serviceBusQueueName = 'porter-uploads'
// uploadWorkerSecret → secret in main.secrets.bicepparam
