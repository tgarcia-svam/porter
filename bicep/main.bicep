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

// ── Derived names ─────────────────────────────────────────────────────────────

var appServicePlanName = '${appServiceName}-plan'
var keyVaultName       = '${appServiceName}-keys'
var vnetName           = '${appServiceName}-vnet'
var logAnalyticsName   = '${appServiceName}-logs'
var appInsightsName    = '${appServiceName}-insights'

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

    DOCKER_REGISTRY_SERVER_URL: 'https://${acr.properties.loginServer}'

    SEED_ADMIN_EMAIL: seedAdminEmail

    APPLICATIONINSIGHTS_CONNECTION_STRING: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=appinsights-connection-string)'

    KEY_VAULT_URL: 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/'
  }
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

var acrPullRoleId              = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var keyVaultSecretsUserRoleId  = '4633458b-17de-408a-b874-0445c86b69e6'

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, appServiceName, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, appServiceName, storageBlobDataOwnerRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource keyVaultSecretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appServiceName, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────

output appUrl        string = 'https://${appService.properties.defaultHostName}'
output acrLoginServer string = acr.properties.loginServer
output dbHostname    string = postgresServer.properties.fullyQualifiedDomainName
output keyVaultUri   string = keyVault.properties.vaultUri
