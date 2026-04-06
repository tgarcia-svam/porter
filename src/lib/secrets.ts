/**
 * Loads secrets from Azure Key Vault into process.env at startup.
 *
 * Uses DefaultAzureCredential, which automatically selects the right auth:
 *   - Azure App Service  → system-assigned managed identity
 *   - Local development  → `az login` credentials (run `az login` once)
 *
 * Non-secret config (NEXTAUTH_URL, AZURE_AD_CLIENT_ID, etc.) is read from
 * the committed .env file and is not fetched here.
 *
 * SSO client secrets are required here — they are never stored in the DB.
 */

// Maps Key Vault secret name → process.env key
const REQUIRED_SECRETS: Record<string, string> = {
  "nextauth-secret":               "NEXTAUTH_SECRET",
  "appinsights-connection-string": "APPLICATIONINSIGHTS_CONNECTION_STRING",
  "database-url":                  "DATABASE_URL",
  "sso-porter":                    "AZURE_AD_CLIENT_SECRET",
  "google-client-secret":          "GOOGLE_CLIENT_SECRET",
};

export async function loadSecretsFromKeyVault(): Promise<void> {
  const vaultUrl = process.env.KEY_VAULT_URL;
  if (!vaultUrl) {
    console.warn("[secrets] KEY_VAULT_URL not set — skipping Key Vault secret load");
    return;
  }

  const { DefaultAzureCredential } = await import("@azure/identity");
  const { SecretClient } = await import("@azure/keyvault-secrets");

  const client = new SecretClient(vaultUrl, new DefaultAzureCredential());

  async function load(secretName: string, envKey: string, required: boolean) {
    if (process.env[envKey]) return; // already set (App Service KV reference)
    try {
      const secret = await client.getSecret(secretName);
      if (secret.value) process.env[envKey] = secret.value;
    } catch (err) {
      if (required) {
        console.warn(`[secrets] Could not load ${secretName} from Key Vault:`, err);
      }
      // Optional secrets silently absent — provider will be disabled at runtime
    }
  }

  await Promise.all(
    Object.entries(REQUIRED_SECRETS).map(([k, v]) => load(k, v, true)),
  );
}
