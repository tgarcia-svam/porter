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

  allow_nested_items_to_be_public = false
  min_tls_version                 = "TLS1_2"

  # Disable shared key access — all access must go through Azure AD (managed identity).
  shared_access_key_enabled = false

  tags = var.tags
}

# Grant the App Service managed identity read/write access to blobs.
resource "azurerm_role_assignment" "storage_blob_contributor" {
  scope                = azurerm_storage_account.main.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_web_app.main.identity[0].principal_id
}

resource "azurerm_storage_container" "uploads" {
  name                  = "porter-uploads"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
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
