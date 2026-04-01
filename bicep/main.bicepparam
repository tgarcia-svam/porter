using './main.bicep'

// ── Region ────────────────────────────────────────────────────────────────────
param location = 'canadacentral'

// ── Existing resource names ───────────────────────────────────────────────────
param appServiceName = 'porter'
param acrName        = 'portercontainerregistry'

// ── Storage ───────────────────────────────────────────────────────────────────
param storageAccountName  = 'svamanalyticsporter'
param storageContainerName = 'porter-uploads'

// ── Database ──────────────────────────────────────────────────────────────────
// Using an existing Flexible Server — password is supplied separately as a secret.
param dbServerName = 'porter-server'
param dbName       = 'porter-database'
param dbAdminUser  = 'fyqjfqajnp'
// dbAdminPassword  → secret: DB_ADMIN_PASSWORD

// ── NextAuth ──────────────────────────────────────────────────────────────────
param nextauthUrl = 'https://www.porterdata.com'
// nextauthSecret  → secret: NEXTAUTH_SECRET

// ── Google SSO (optional — leave empty to disable) ────────────────────────────
param googleClientId = ''
// googleClientSecret → secret: GOOGLE_CLIENT_SECRET

// ── Microsoft Entra ID SSO (optional — leave empty to disable) ───────────────
param azureAdClientId = '2dee6845-f88d-48b7-b411-b0c43aa6d7f1'
param azureAdTenantId = 'common'
// azureAdClientSecret → secret: AZURE_AD_CLIENT_SECRET

// ── Initial admin ─────────────────────────────────────────────────────────────
param seedAdminEmail = 'tgarcia@svam.com'

// ── Image tag — overridden to github.sha in CI ────────────────────────────────
param containerTag = 'latest'
