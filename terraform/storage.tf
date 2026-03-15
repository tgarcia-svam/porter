resource "azurerm_storage_account" "main" {
  name                     = "${var.app_name}${random_string.suffix.result}sa"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  account_kind             = "StorageV2"

  # HNS (Hierarchical Namespace / ADLS Gen2) MUST be disabled.
  # Defender for Storage malware scanning and blob index tags
  # are not supported on HNS-enabled accounts.
  is_hns_enabled = false

  # Block all public internet access.
  # The App Service accesses storage exclusively through the private endpoint.
  public_network_access_enabled   = false
  allow_nested_items_to_be_public = false

  min_tls_version = "TLS1_2"

  tags = var.tags
}

resource "azurerm_storage_container" "uploads" {
  name                  = "porter-uploads"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

# Private endpoint — restricts blob storage access to within the VNet only.
# The App Service reaches storage via its VNet integration + this private endpoint.
resource "azurerm_private_endpoint" "storage" {
  name                = "${var.app_name}-storage-pe"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  subnet_id           = azurerm_subnet.private_endpoints.id
  tags                = var.tags

  private_service_connection {
    name                           = "${var.app_name}-storage-psc"
    private_connection_resource_id = azurerm_storage_account.main.id
    subresource_names              = ["blob"]
    is_manual_connection           = false
  }

  private_dns_zone_group {
    name                 = "blob-dns-zone-group"
    private_dns_zone_ids = [azurerm_private_dns_zone.blob.id]
  }
}

# Microsoft Defender for Storage v2 with malware scanning on upload.
# Uses azapi because the azurerm provider does not yet expose this resource directly.
resource "azapi_resource" "defender_for_storage" {
  type      = "Microsoft.Security/defenderForStorageSettings@2022-12-01-preview"
  name      = "current"
  parent_id = azurerm_storage_account.main.id

  body = jsonencode({
    properties = {
      isEnabled = true
      malwareScanning = {
        onUpload = {
          isEnabled     = true
          capGBPerMonth = -1 # -1 = unlimited
        }
      }
      sensitiveDataDiscovery = {
        isEnabled = false
      }
      overrideSubscriptionLevelSettings = true
    }
  })

  depends_on = [azurerm_storage_account.main]
}
