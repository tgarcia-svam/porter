resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "${var.app_name}-${random_string.suffix.result}-pg"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = "16"
  administrator_login    = var.postgres_admin_username
  administrator_password = var.postgres_admin_password

  storage_mb = 32768 # 32 GB
  sku_name   = "B_Standard_B1ms"

  backup_retention_days        = 7
  geo_redundant_backup_enabled = false

  tags = var.tags
}

resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = "porter"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Allow all Azure services to reach the PostgreSQL server.
# Required since VNet integration is not available on the Free App Service plan.
resource "azurerm_postgresql_flexible_server_firewall_rule" "azure_services" {
  name      = "AllowAzureServices"
  server_id = azurerm_postgresql_flexible_server.main.id

  # 0.0.0.0 / 0.0.0.0 is a special Azure sentinel value that means
  # "allow connections originating from within Azure".
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}
