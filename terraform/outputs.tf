output "app_url" {
  description = "Public URL of the deployed application"
  value       = "https://${azurerm_linux_web_app.main.default_hostname}"
}

output "acr_login_server" {
  description = "Container registry login server (used when pushing images)"
  value       = azurerm_container_registry.main.login_server
}

output "push_commands" {
  description = "Commands to build and push the Docker image to ACR"
  value       = <<-EOT
    az acr login --name ${azurerm_container_registry.main.name}
    docker build -t ${azurerm_container_registry.main.login_server}/${var.app_name}:latest .
    docker push ${azurerm_container_registry.main.login_server}/${var.app_name}:latest
  EOT
}

output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "storage_account_name" {
  value = azurerm_storage_account.main.name
}

output "database_fqdn" {
  description = "PostgreSQL server hostname"
  value       = azurerm_postgresql_flexible_server.main.fqdn
}
