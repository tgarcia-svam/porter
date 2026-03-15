# Azure Container Registry — stores the Porter Docker image
resource "azurerm_container_registry" "main" {
  name                = "${var.app_name}${random_string.suffix.result}acr"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = false # App Service authenticates via managed identity
  tags                = var.tags
}

resource "azurerm_service_plan" "main" {
  name                = "${var.app_name}-asp"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  os_type             = "Linux"
  sku_name            = var.app_service_sku # Must be P-series for VNet integration
  tags                = var.tags
}

resource "azurerm_linux_web_app" "main" {
  name                = "${var.app_name}-${random_string.suffix.result}-app"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  service_plan_id     = azurerm_service_plan.main.id
  https_only          = true
  tags                = var.tags

  # VNet integration — all outbound traffic routed through the VNet,
  # enabling access to the storage private endpoint and PostgreSQL.
  virtual_network_subnet_id = azurerm_subnet.app_service.id

  # System-assigned managed identity for ACR authentication
  identity {
    type = "SystemAssigned"
  }

  site_config {
    vnet_route_all_enabled = true

    application_stack {
      docker_image_name   = "${azurerm_container_registry.main.login_server}/${var.app_name}:latest"
      docker_registry_url = "https://${azurerm_container_registry.main.login_server}"
    }
  }

  app_settings = {
    # Database
    DATABASE_URL = "postgresql://${var.postgres_admin_username}:${var.postgres_admin_password}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/${azurerm_postgresql_flexible_server_database.main.name}?sslmode=require"

    # NextAuth
    NEXTAUTH_URL    = "https://${var.app_name}-${random_string.suffix.result}-app.azurewebsites.net"
    NEXTAUTH_SECRET = var.nextauth_secret
    AUTH_TRUST_HOST = "true"

    # Google SSO (optional — leave empty to disable)
    GOOGLE_CLIENT_ID     = var.google_client_id
    GOOGLE_CLIENT_SECRET = var.google_client_secret

    # Microsoft Entra ID SSO (optional — leave empty to disable)
    AZURE_AD_CLIENT_ID     = var.azure_ad_client_id
    AZURE_AD_CLIENT_SECRET = var.azure_ad_client_secret
    AZURE_AD_TENANT_ID     = var.azure_ad_tenant_id

    # Azure Blob Storage (private endpoint — accessible via VNet only)
    AZURE_STORAGE_CONNECTION_STRING = azurerm_storage_account.main.primary_connection_string
    AZURE_STORAGE_CONTAINER         = azurerm_storage_container.uploads.name

    # Tell App Service to authenticate to ACR using managed identity
    DOCKER_REGISTRY_SERVER_URL = "https://${azurerm_container_registry.main.login_server}"
  }

  depends_on = [
    azurerm_private_endpoint.storage,
    azurerm_postgresql_flexible_server.main,
  ]
}

# Grant the App Service managed identity permission to pull images from ACR
resource "azurerm_role_assignment" "acr_pull" {
  scope                = azurerm_container_registry.main.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_linux_web_app.main.identity[0].principal_id
}
