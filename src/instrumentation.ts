/**
 * Next.js server instrumentation hook — runs once on startup before any
 * request is handled.
 *
 * 1. Loads secrets from Azure Key Vault into process.env
 * 2. Initialises Azure Application Insights for request-level telemetry
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // ── 1. Load secrets from Key Vault ──────────────────────────────────────────
  const { loadSecretsFromKeyVault } = await import("@/lib/secrets");
  await loadSecretsFromKeyVault();

  // ── 2. Initialise Application Insights ──────────────────────────────────────
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return;

  const appInsights = await import("applicationinsights");

  appInsights
    .setup(connectionString)
    .setAutoCollectRequests(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectExceptions(true)
    .setAutoCollectPerformance(true, true)
    .setAutoCollectConsole(true)
    .setUseDiskRetryCaching(true)
    .start();
}
