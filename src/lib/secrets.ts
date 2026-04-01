/**
 * Loads secrets from Azure Key Vault into process.env at startup.
 *
 * Uses DefaultAzureCredential, which automatically selects the right auth:
 *   - Azure App Service  → system-assigned managed identity
 *   - Local development  → `az login` credentials (run `az login` once)
 *
 * Non-secret config (NEXTAUTH_URL, AZURE_AD_CLIENT_ID, etc.) is read from
 * the committed .env file and is not fetched here.
 */

// Maps Key Vault secret name → process.env key
const SECRET_MAP: Record<string, string> = {
  "nextauth-secret":               "NEXTAUTH_SECRET",
  "sso-porter":                    "AZURE_AD_CLIENT_SECRET",
  "google-client-secret":          "GOOGLE_CLIENT_SECRET",
  "appinsights-connection-string": "APPLICATIONINSIGHTS_CONNECTION_STRING",
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

  await Promise.all(
    Object.entries(SECRET_MAP).map(async ([secretName, envKey]) => {
      // Skip if already set (e.g. App Service resolved a KV reference natively)
      if (process.env[envKey]) return;
      try {
        const secret = await client.getSecret(secretName);
        if (secret.value) {
          process.env[envKey] = secret.value;
        }
      } catch (err) {
        console.warn(`[secrets] Could not load ${secretName} from Key Vault:`, err);
      }
    })
  );
}
