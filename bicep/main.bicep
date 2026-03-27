// Porter — deploy to existing Azure resources
// Usage:
//   az deployment group create \
//     --resource-group <rg> \
//     --template-file bicep/main.bicep \
//     --parameters bicep/main.bicepparam

// ── App Service ───────────────────────────────────────────────────────────────

@description('Name of the existing App Service')
param appServiceName string

@description('Name of the existing Azure Container Registry')
param acrName string

@description('Name of the existing Storage Account')
param storageAccountName string

@description('Name of the existing Storage container for uploads')
param storageContainerName string = 'porter-uploads'

@description('NextAuth.js secret — generate with: openssl rand -base64 32. Omit from bicepparam and supply via CI secret.')
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

@description('Azure region of the existing App Service, e.g. eastus')
param location string = resourceGroup().location

@description('Docker image tag to deploy')
param containerTag string = 'latest'

// ── PostgreSQL ────────────────────────────────────────────────────────────────

@description('Name of the existing PostgreSQL Flexible Server. When set, the connection URL is constructed automatically from the server hostname. Leave empty to supply a raw databaseUrl instead.')
param dbServerName string = ''

@description('Database name (used when dbServerName is set).')
param dbName string = 'porter'

@description('PostgreSQL admin username (used when dbServerName is set).')
param dbAdminUser string = 'porteradmin'

@description('PostgreSQL admin password (used when dbServerName is set). Special characters must be percent-encoded: # → %23, @ → %40, % → %25, : → %3A, ! → %21')
@secure()
param dbAdminPassword string = ''

@description('Full PostgreSQL connection URL. Only used when dbServerName is empty. Special characters in the password must be percent-encoded, e.g. # → %23.')
@secure()
param databaseUrl string = ''

// ── Derived names & values ───────────────────────────────────────────────────

var logAnalyticsName = '${appServiceName}-logs'
var appInsightsName  = '${appServiceName}-insights'

// When dbServerName is provided, construct the URL from the existing server's
// hostname. Otherwise fall back to the raw databaseUrl parameter.
// any() suppresses the Bicep null-check linter warning on the conditional reference.
var effectiveDatabaseUrl = !empty(dbServerName)
  ? 'postgresql://${dbAdminUser}:${dbAdminPassword}@${any(postgresServer).properties.fullyQualifiedDomainName}:5432/${dbName}?sslmode=require'
  : databaseUrl

// ── Reference existing resources ─────────────────────────────────────────────

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource appService 'Microsoft.Web/sites@2023-12-01' existing = {
  name: appServiceName
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' existing = if (!empty(dbServerName)) {
  name: empty(dbServerName) ? 'placeholder' : dbServerName
}

// ── Ensure the App Service has a system-assigned managed identity ─────────────

resource appServiceIdentity 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/porter:${containerTag}'
      acrUseManagedIdentityCreds: true
    }
  }
}

// ── App settings ─────────────────────────────────────────────────────────────

resource appSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: appServiceIdentity
  name: 'appsettings'
  properties: {
    DATABASE_URL: effectiveDatabaseUrl

    NEXTAUTH_URL: nextauthUrl
    NEXTAUTH_SECRET: nextauthSecret
    AUTH_TRUST_HOST: 'true'

    GOOGLE_CLIENT_ID: googleClientId
    GOOGLE_CLIENT_SECRET: googleClientSecret

    AZURE_AD_CLIENT_ID: azureAdClientId
    AZURE_AD_CLIENT_SECRET: azureAdClientSecret
    AZURE_AD_TENANT_ID: azureAdTenantId

    AZURE_STORAGE_ACCOUNT_URL: 'https://${storageAccount.name}.blob.${environment().suffixes.storage}'
    AZURE_STORAGE_CONTAINER: storageContainerName

    DOCKER_REGISTRY_SERVER_URL: 'https://${acr.properties.loginServer}'

    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
  }
}

// ── Log Analytics Workspace (1-year retention) ────────────────────────────────

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 365
  }
}

// ── Application Insights (linked to workspace) ────────────────────────────────

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

// ── Role assignments ──────────────────────────────────────────────────────────

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var storageBlobDataOwnerRoleId = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, appServiceName, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: appServiceIdentity.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource storageRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, appServiceName, storageBlobDataOwnerRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataOwnerRoleId)
    principalId: appServiceIdentity.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// NOTE: To grant the App Service managed identity Entra admin rights on the
// PostgreSQL server, run once after first deployment:
//
//   PRINCIPAL_ID=$(az webapp identity show \
//     --name <appServiceName> --resource-group <rg> \
//     --query principalId -o tsv)
//   az postgres flexible-server ad-admin create \
//     --server-name <dbServerName> --resource-group <rg> \
//     --display-name <appServiceName> \
//     --object-id $PRINCIPAL_ID \
//     --type ServicePrincipal

// ── Outputs ──────────────────────────────────────────────────────────────────

output appUrl string = 'https://${appService.properties.defaultHostName}'
output acrLoginServer string = acr.properties.loginServer
output dbHostname string = !empty(dbServerName) ? any(postgresServer).properties.fullyQualifiedDomainName : ''
output pushCommands string = '''
  az acr login --name ${acrName}
  docker build -t ${acr.properties.loginServer}/porter:${containerTag} .
  docker push ${acr.properties.loginServer}/porter:${containerTag}
'''
