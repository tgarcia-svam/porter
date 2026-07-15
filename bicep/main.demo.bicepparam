using './main.bicep'

// Demo environment — deploys to resource group porter-demo
// URL: https://demo.porterdata.com
//
// Deploy:
//   az group create --name porter-demo --location canadacentral
//   az deployment group create \
//     --resource-group porter-demo \
//     --template-file bicep/main.bicep \
//     --parameters bicep/main.demo.bicepparam bicep/main.demo.secrets.bicepparam

// ── Region ────────────────────────────────────────────────────────────────────
param location = 'canadacentral'

// ── Resource names ────────────────────────────────────────────────────────────
// All names must be globally unique in Azure — cannot reuse production values.
// App Service → porter-demo.azurewebsites.net
// ACR + Storage Account names: alphanumeric only
param appServiceName     = 'porter-demo'
param acrName            = 'porterdemoregistry'
param storageAccountName = 'porterdemostorage'
param storageContainerName = 'porter-uploads'

// ── Database ──────────────────────────────────────────────────────────────────
param dbServerName = 'porter-demo-db'
param dbName       = 'porter'
param dbAdminUser  = 'porteradmin'
param dbAdminPassword   = ''   // overridden in main.demo.secrets.bicepparam
param dbAppUserPassword = ''   // overridden in main.demo.secrets.bicepparam

// ── App Service ───────────────────────────────────────────────────────────────
param appServiceSkuName = 'B1'
param dbSkuName         = 'Standard_B1ms'
param dbSkuTier         = 'Burstable'

// ── NextAuth ──────────────────────────────────────────────────────────────────
param nextauthUrl = 'https://demo.porterdata.com'
// nextauthSecret → secret in main.demo.secrets.bicepparam

// ── SSO providers ─────────────────────────────────────────────────────────────
// Same Entra ID / Google app registrations as production — add
// https://demo.porterdata.com/api/auth/callback/azure-ad and
// https://demo.porterdata.com/api/auth/callback/google as additional
// redirect URIs before users can sign in via SSO.
param googleClientId  = ''
param azureAdClientId = ''
param azureAdTenantId = 'common'

// ── Initial admin ─────────────────────────────────────────────────────────────
param seedAdminEmail = 'tgarcia@svam.com'

// ── Image tag — override to a specific SHA for pinned demo builds ──────────────
param containerTag = 'latest'

// ── Service Bus / async worker ────────────────────────────────────────────────
param serviceBusQueueName = 'porter-uploads'
param uploadWorkerSecret  = ''   // overridden in main.demo.secrets.bicepparam

// ── Retention job ─────────────────────────────────────────────────────────────
param retentionWorkerSecret = ''   // overridden in main.demo.secrets.bicepparam

// ── Local auth (username/password + MFA) ──────────────────────────────────────
param mfaEncryptionKey = ''   // overridden in main.demo.secrets.bicepparam

// ── Email deliverability (Azure Communication Services) ────────────────────────
// Two-phase setup:
//   Phase 1 (first deploy): emailDomainVerified=false — Bicep creates the
//     pending domain and outputs the DNS records to add at your provider.
//     Read them with:
//       az deployment group show --resource-group porter-demo --name main \
//         --query properties.outputs.emailDomainVerificationRecords.value
//     Then verify each type (Domain, SPF, DKIM, DKIM2):
//       az communication email domain initiate-verification \
//         --domain-name mail.demo.porterdata.com \
//         --email-service-name porter-demo-email \
//         --resource-group porter-demo \
//         --verification-type <Domain|SPF|DKIM|DKIM2>
//   Phase 2 (second deploy): flip emailDomainVerified=true to link and activate.
param emailSenderDomain   = 'mail.demo.porterdata.com'
param emailDomainVerified = true

// ── Cost controls (lower than production for a demo environment) ──────────────
param blobTierToCoolAfterDays    = 30
param blobTierToArchiveAfterDays = 90
param malwareScanCapGBPerMonth   = 50
param logRetentionInDays         = 30
param logDailyQuotaGB            = 1
