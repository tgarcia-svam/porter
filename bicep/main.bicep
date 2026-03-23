// Porter — deploy to existing Azure resources
// Usage:
//   az deployment group create \
//     --resource-group <rg> \
//     --template-file bicep/main.bicep \
//     --parameters bicep/main.bicepparam

@description('Name of the existing App Service')
param appServiceName string

@description('Name of the existing Azure Container Registry')
param acrName string

@description('Name of the existing Storage Account')
param storageAccountName string

@description('Name of the existing Storage container for uploads')
param storageContainerName string = 'porter-uploads'

@description('PostgreSQL server hostname (FQDN)')
param postgresHost string

@description('PostgreSQL database name')
param postgresDatabase string = 'porter'

@description('PostgreSQL admin username')
param postgresUsername string

@description('PostgreSQL admin password')
@secure()
param postgresPassword string

@description('NextAuth.js secret — generate with: openssl rand -base64 32')
@secure()
param nextauthSecret string

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

// ── Ensure the App Service has a system-assigned managed identity ─────────────

resource appServiceIdentity 'Microsoft.Web/sites@2023-12-01' = {
  name: appServiceName
  location: appService.location
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
    DATABASE_URL: 'postgresql://${postgresUsername}:${postgresPassword}@${postgresHost}:5432/${postgresDatabase}?sslmode=require'

    NEXTAUTH_URL: nextauthUrl
    NEXTAUTH_SECRET: nextauthSecret
    AUTH_TRUST_HOST: 'true'

    GOOGLE_CLIENT_ID: googleClientId
    GOOGLE_CLIENT_SECRET: googleClientSecret

    AZURE_AD_CLIENT_ID: azureAdClientId
    AZURE_AD_CLIENT_SECRET: azureAdClientSecret
    AZURE_AD_TENANT_ID: azureAdTenantId

    AZURE_STORAGE_ACCOUNT_URL: 'https://${storageAccount.name}.blob.core.windows.net'
    AZURE_STORAGE_CONTAINER: storageContainerName

    DOCKER_REGISTRY_SERVER_URL: 'https://${acr.properties.loginServer}'
  }
}

// ── Role assignments on existing resources ───────────────────────────────────

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

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
  name: guid(storageAccount.id, appServiceName, storageBlobDataContributorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: appServiceIdentity.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Outputs ──────────────────────────────────────────────────────────────────

output appUrl string = 'https://${appService.properties.defaultHostName}'
output acrLoginServer string = acr.properties.loginServer
output pushCommands string = '''
  az acr login --name ${acrName}
  docker build -t ${acr.properties.loginServer}/porter:${containerTag} .
  docker push ${acr.properties.loginServer}/porter:${containerTag}
'''
