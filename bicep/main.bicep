// Porter — full infrastructure deployment
// Creates ALL resources from scratch on an empty resource group.
// Usage:
//   az group create --name porter-setup --location canadacentral
//   az deployment group create \
//     --resource-group porter-setup \
//     --template-file bicep/main.bicep \
//     --parameters bicep/main.secrets.bicepparam

// ── Parameters ────────────────────────────────────────────────────────────────

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Name for the App Service (plan will be <name>-plan, key vault will be <name>-keys)')
param appServiceName string

@description('App Service Plan SKU')
param appServiceSkuName string = 'B2'

@description('Name of the Azure Container Registry to create')
param acrName string

@description('Name of the Storage Account to create')
param storageAccountName string

@description('Name of the blob container for uploads')
param storageContainerName string = 'porter-uploads'

@description('Name of the PostgreSQL Flexible Server to create')
param dbServerName string

@description('Database name')
param dbName string = 'porter'

@description('PostgreSQL admin username')
param dbAdminUser string = 'porteradmin'

@description('PostgreSQL admin password')
@secure()
param dbAdminPassword string

@description('PostgreSQL compute SKU')
param dbSkuName string = 'Standard_B1ms'

@description('PostgreSQL compute tier')
param dbSkuTier string = 'Burstable'

@description('NextAuth.js secret — generate with: openssl rand -base64 32')
@secure()
param nextauthSecret string = ''

@description('Public URL of the App Service, e.g. https://<name>.azurewebsites.net')
param nextauthUrl string

@description('Google OAuth client ID (leave empty to disable)')
param googleClientId string = ''

@description('Google OAuth client secret')
@secure()
param googleClientSecret string = ''

@description('Microsoft Entra ID client ID (leave empty to disable)')
param azureAdClientId string = ''

@description('Microsoft Entra ID client secret')
@secure()
param azureAdClientSecret string = ''

@description('Microsoft Entra ID tenant ID')
param azureAdTenantId string = 'common'

@description('Docker image tag to deploy')
param containerTag string = 'latest'

@description('Email address of the initial admin user, seeded automatically on first container start')
param seedAdminEmail string

@description('Name of the Service Bus queue for upload jobs')
param serviceBusQueueName string = 'porter-uploads'

@description('Shared secret the Azure Function sends as X-Worker-Secret when calling /api/upload/process. Generate with: openssl rand -hex 32')
@secure()
param uploadWorkerSecret string

// ── Derived names ─────────────────────────────────────────────────────────────

var appServicePlanName      = '${appServiceName}-plan'
var keyVaultName            = '${appServiceName}-keys'
var vnetName                = '${appServiceName}-vnet'
var logAnalyticsName        = '${appServiceName}-logs'
var appInsightsName         = '${appServiceName}-insights'
var serviceBusNamespaceName = '${appServiceName}-bus'
var workerFunctionName      = '${appServiceName}-worker'
// Storage account names: max 24 chars, alphanumeric only
var workerStorageName       = take('fnwrk${uniqueString(resourceGroup().id, appServiceName)}', 24)

// ── Virtual Network ───────────────────────────────────────────────────────────

resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.0.0.0/16'] }
    subnets: [
      {
        // App Service outbound VNet integration
        name: 'app-subnet'
        properties: {
          addressPrefix: '10.0.1.0/24'
          delegations: [{
            name: 'app-service-delegation'
            properties: { serviceName: 'Microsoft.Web/serverFarms' }
          }]
        }
      }
      {
        // PostgreSQL Flexible Server VNet injection
        name: 'postgres-subnet'
        properties: {
          addressPrefix: '10.0.2.0/24'
          delegations: [{
            name: 'postgres-delegation'
            properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' }
          }]
        }
      }
      {
        // Private endpoints (Blob Storage, Key Vault)
        name: 'endpoints-subnet'
        properties: {
          addressPrefix: '10.0.3.0/24'
          privateEndpointNetworkPolicies: 'Disabled'
        }
      }
    ]
  }
}

// ── Private DNS Zones ─────────────────────────────────────────────────────────

resource blobPrivateDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
}

resource postgresPrivateDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: 'privatelink.postgres.database.azure.com'
  location: 'global'
}

resource blobDnsVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: blobPrivateDns
  name: '${vnetName}-blob-link'
  location: 'global'
  properties: {
    virtualNetwork: { id: vnet.id }
    registrationEnabled: false
  }
}

resource postgresDnsVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: postgresPrivateDns
  name: '${vnetName}-postgres-link'
  location: 'global'
  properties: {
    virtualNetwork: { id: vnet.id }
    registrationEnabled: false
  }
}

// ── PostgreSQL Flexible Server — public access with Azure-only firewall ───────
// VNet-injected Flexible Servers require creation-time configuration that is
// blocked by this subscription's policy. Public access is used instead, locked
// down to Azure-internal traffic only via the AllowAzureServices firewall rule.

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: dbServerName
  location: location
  sku: {
    name: dbSkuName
    tier: dbSkuTier
  }
  properties: {
    administratorLogin: dbAdminUser
    administratorLoginPassword: dbAdminPassword
    version: '16'
    network: {
      publicNetworkAccess: 'Enabled'
    }
    storage: { storageSizeGB: 32 }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: { mode: 'Disabled' }
  }
}

resource postgresFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: postgresServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgresServer
  name: dbName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// ── Container Registry ────────────────────────────────────────────────────────

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

// ── Storage Account ───────────────────────────────────────────────────────────

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource storageContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: storageContainerName
  properties: { publicAccess: 'None' }
}

// ── Azure Service Bus ─────────────────────────────────────────────────────────
// Standard tier is required for queues with dead-lettering and sessions.
// The queue is used to decouple file upload acceptance from heavy validation
// work. The App Service enqueues jobs (Data Sender role); the Azure Function
// dequeues and calls /api/upload/process (Data Receiver role).

resource serviceBusNamespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: serviceBusNamespaceName
  location: location
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    minimumTlsVersion: '1.2'
  }
}

resource serviceBusQueue 'Microsoft.ServiceBus/namespaces/queues@2022-10-01-preview' = {
  parent: serviceBusNamespace
  name: serviceBusQueueName
  properties: {
    // Lock messages for up to 5 minutes — matches maxDuration on /api/upload/process
    lockDuration: 'PT5M'
    // Retry up to 3 times before dead-lettering; the process endpoint is idempotent
    maxDeliveryCount: 3
    deadLetteringOnMessageExpiration: true
    // Messages expire after 24 hours if never processed
    defaultMessageTimeToLive: 'P1D'
  }
}

// ── Worker Function Storage Account ──────────────────────────────────────────
// Azure Functions runtime requires its own dedicated storage account.
// Managed identity is used for AzureWebJobsStorage (passwordless).

resource workerStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: workerStorageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

// ── Worker Function App Plan (Consumption) ────────────────────────────────────
// Windows Consumption plan — Linux dynamic workers cannot coexist with a Linux
// App Service plan in the same resource group (Azure platform limitation).
// The Node.js v4 Functions runtime works identically on Windows.

resource workerPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${workerFunctionName}-plan'
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {}
}

// ── Worker Function App ───────────────────────────────────────────────────────
// Node.js 20, Windows Consumption plan, system-assigned managed identity.
// Code is deployed via zip deploy in CI — see .github/workflows/deploy.yml.

resource workerFunction 'Microsoft.Web/sites@2023-12-01' = {
  name: workerFunctionName
  location: location
  kind: 'functionapp'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: workerPlan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
    }
  }
}

resource workerFunctionSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: workerFunction
  name: 'appsettings'
  properties: {
    // Runtime config
    FUNCTIONS_EXTENSION_VERSION: '~4'
    FUNCTIONS_WORKER_RUNTIME: 'node'
    WEBSITE_NODE_DEFAULT_VERSION: '~20'

    // AzureWebJobsStorage — Consumption (Y1) plan does not support managed identity
    // for AzureWebJobsStorage; a connection string is required.
    AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=${workerStorage.name};AccountKey=${workerStorage.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

    // Service Bus trigger via managed identity (passwordless)
    // The double-underscore format enables managed identity auth — no connection string needed.
    ServiceBusConnection__fullyQualifiedNamespace: '${serviceBusNamespaceName}.servicebus.windows.net'

    AZURE_SERVICE_BUS_QUEUE_NAME: serviceBusQueueName

    // Where to forward the job — the public App Service URL
    APP_URL: nextauthUrl

    // Shared secret authenticating this function to /api/upload/process
    UPLOAD_WORKER_SECRET: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=upload-worker-secret)'

    // Application Insights
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
    ApplicationInsightsAgent_EXTENSION_VERSION: '~3'
  }
  dependsOn: [kvUploadWorkerSecret]
}

// ── Log Analytics + Application Insights ─────────────────────────────────────

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 365
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    RetentionInDays: 365
  }
}

// ── Key Vault ─────────────────────────────────────────────────────────────────

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
  }
}

// ── Key Vault Secrets ─────────────────────────────────────────────────────────

var effectiveDatabaseUrl = 'postgresql://${dbAdminUser}:${dbAdminPassword}@${postgresServer.properties.fullyQualifiedDomainName}:5432/${dbName}?sslmode=require'

resource kvDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'database-url'
  properties: { value: effectiveDatabaseUrl }
}

resource kvDbPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'db-admin-password'
  properties: { value: dbAdminPassword }
}

resource kvNextauthSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(nextauthSecret)) {
  parent: keyVault
  name: 'nextauth-secret'
  properties: { value: nextauthSecret }
}

resource kvSsoPorter 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(azureAdClientSecret)) {
  parent: keyVault
  name: 'sso-porter'
  properties: { value: azureAdClientSecret }
}

resource kvGoogleClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(googleClientSecret)) {
  parent: keyVault
  name: 'google-client-secret'
  properties: { value: googleClientSecret }
}

resource kvAppInsightsConnectionString 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'appinsights-connection-string'
  properties: { value: appInsights.properties.ConnectionString }
}

resource kvUploadWorkerSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'upload-worker-secret'
  properties: { value: uploadWorkerSecret }
}

// ── App Service Plan ──────────────────────────────────────────────────────────

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'Linux'
  sku: {
    name: appServiceSkuName
    tier: appServiceSkuName == 'B1' ? 'Basic' : appServiceSkuName == 'B2' ? 'Basic' : appServiceSkuName == 'B3' ? 'Basic' : 'Basic'
  }
  properties: { reserved: true }
}

// ── App Service ───────────────────────────────────────────────────────────────

resource appService 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/porter:${containerTag}'
      acrUseManagedIdentityCreds: true
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
    }
  }
}

// ── App Settings ──────────────────────────────────────────────────────────────

resource appSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: appService
  name: 'appsettings'
  properties: {
    DATABASE_URL: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=database-url)'

    NEXTAUTH_URL:    nextauthUrl
    NEXTAUTH_SECRET: !empty(nextauthSecret)
      ? '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=nextauth-secret)'
      : ''
    AUTH_TRUST_HOST: 'true'

    GOOGLE_CLIENT_ID:     googleClientId
    GOOGLE_CLIENT_SECRET: !empty(googleClientSecret)
      ? '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=google-client-secret)'
      : ''

    AZURE_AD_CLIENT_ID:     azureAdClientId
    AZURE_AD_CLIENT_SECRET: !empty(azureAdClientSecret)
      ? '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=sso-porter)'
      : ''
    AZURE_AD_TENANT_ID: azureAdTenantId

    AZURE_STORAGE_ACCOUNT_URL: 'https://${storageAccount.name}.blob.${environment().suffixes.storage}'
    AZURE_STORAGE_CONTAINER:   storageContainerName

    // Service Bus — enables async background processing of large file uploads
    AZURE_SERVICE_BUS_NAMESPACE:  '${serviceBusNamespaceName}.servicebus.windows.net'
    AZURE_SERVICE_BUS_QUEUE_NAME: serviceBusQueueName

    // Shared secret authenticating /api/upload/process calls from the worker function
    UPLOAD_WORKER_SECRET: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=upload-worker-secret)'

    DOCKER_REGISTRY_SERVER_URL: 'https://${acr.properties.loginServer}'

    SEED_ADMIN_EMAIL: seedAdminEmail

    APPLICATIONINSIGHTS_CONNECTION_STRING: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=appinsights-connection-string)'

    KEY_VAULT_URL: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/'
  }
  dependsOn: [kvUploadWorkerSecret]
}

// ── Storage Account Private Endpoint ─────────────────────────────────────────

resource storagePrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = {
  name: '${storageAccountName}-pe'
  location: location
  properties: {
    subnet: { id: resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, 'endpoints-subnet') }
    privateLinkServiceConnections: [{
      name: '${storageAccountName}-blob-connection'
      properties: {
        privateLinkServiceId: storageAccount.id
        groupIds: ['blob']
      }
    }]
  }
  dependsOn: [vnet]
}

resource storagePrivateDnsGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = {
  parent: storagePrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [{
      name: 'blob'
      properties: { privateDnsZoneId: blobPrivateDns.id }
    }]
  }
}

// ── App Service VNet Integration ──────────────────────────────────────────────
// Routes App Service outbound traffic through the VNet so it can reach the
// PostgreSQL server (VNet-injected) and the Blob Storage private endpoint.

resource appVnetIntegration 'Microsoft.Web/sites/networkConfig@2023-12-01' = {
  parent: appService
  name: 'virtualNetwork'
  properties: {
    subnetResourceId: resourceId('Microsoft.Network/virtualNetworks/subnets', vnetName, 'app-subnet')
    swiftSupported: true
  }
}

// ── Role Assignments ──────────────────────────────────────────────────────────

var acrPullRoleId                    = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var storageBlobDataOwnerRoleId       = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var storageBlobDelegatorRoleId       = 'db58b8e5-c6ad-4a2a-8342-4190687cbf4a'
var storageQueueDataContributorRoleId = '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
var storageTableDataContributorRoleId = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var keyVaultSecretsUserRoleId        = '4633458b-17de-408a-b874-0445c86b69e6'
var serviceBusDataSenderRoleId       = '69a216fc-b8fb-44d8-bc22-1f3c2cd27a39'
var serviceBusDataReceiverRoleId     = '4f6d3b9b-027b-4f4c-9142-0e5a2a2247e0'

// App Service — pull container images from ACR
resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, appServiceName, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// App Service — issue user delegation keys for SAS URLs (direct-to-blob uploads)
resource storageDelegatorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, appServiceName, storageBlobDelegatorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDelegatorRoleId)
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// App Service — read/write uploads storage
resource storageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, appServiceName, storageBlobDataOwnerRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// App Service — read secrets from Key Vault
resource keyVaultSecretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appServiceName, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// App Service — send messages to Service Bus queue
resource appServiceBusSenderAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(serviceBusNamespace.id, appServiceName, serviceBusDataSenderRoleId)
  scope: serviceBusNamespace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataSenderRoleId)
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Function App — receive (dequeue) messages from Service Bus queue
resource workerServiceBusReceiverAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(serviceBusNamespace.id, workerFunctionName, serviceBusDataReceiverRoleId)
  scope: serviceBusNamespace
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', serviceBusDataReceiverRoleId)
    principalId: workerFunction.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Function App — read upload-worker-secret from Key Vault
resource workerKeyVaultAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, workerFunctionName, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: workerFunction.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Function App — AzureWebJobsStorage managed identity (blob + queue + table)
resource workerStorageBlobAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(workerStorage.id, workerFunctionName, storageBlobDataOwnerRoleId)
  scope: workerStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: workerFunction.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerStorageQueueAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(workerStorage.id, workerFunctionName, storageQueueDataContributorRoleId)
  scope: workerStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageQueueDataContributorRoleId)
    principalId: workerFunction.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource workerStorageTableAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(workerStorage.id, workerFunctionName, storageTableDataContributorRoleId)
  scope: workerStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageTableDataContributorRoleId)
    principalId: workerFunction.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────

output appUrl                  string = 'https://${appService.properties.defaultHostName}'
output acrLoginServer          string = acr.properties.loginServer
output dbHostname              string = postgresServer.properties.fullyQualifiedDomainName
output keyVaultUri             string = keyVault.properties.vaultUri
output serviceBusNamespaceFqdn string = '${serviceBusNamespaceName}.servicebus.windows.net'
output workerFunctionName      string = workerFunction.name
