variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "eastus"
}

variable "resource_group_name" {
  description = "Name of the Azure resource group"
  type        = string
  default     = "porter-rg"
}

variable "app_name" {
  description = "Base name used for all resources (lowercase, no spaces)"
  type        = string
  default     = "porter"
}

variable "app_service_sku" {
  description = "App Service Plan SKU. Must be P-series or higher for VNet integration."
  type        = string
  default     = "P1v3"
}

variable "nextauth_secret" {
  description = "NextAuth.js secret key (generate with: openssl rand -base64 32)"
  type        = string
  sensitive   = true
}

variable "google_client_id" {
  description = "Google OAuth client ID (optional)"
  type        = string
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth client secret (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "azure_ad_client_id" {
  description = "Microsoft Entra ID (Azure AD) client ID (optional)"
  type        = string
  default     = ""
}

variable "azure_ad_client_secret" {
  description = "Microsoft Entra ID client secret (optional)"
  type        = string
  sensitive   = true
  default     = ""
}

variable "azure_ad_tenant_id" {
  description = "Microsoft Entra ID tenant ID"
  type        = string
  default     = "common"
}

variable "postgres_admin_username" {
  description = "PostgreSQL administrator login username"
  type        = string
  default     = "porteradmin"
}

variable "postgres_admin_password" {
  description = "PostgreSQL administrator password"
  type        = string
  sensitive   = true
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default = {
    application = "porter"
    managed_by  = "terraform"
  }
}
