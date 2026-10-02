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
  // Must complete before anything that reads process.env secrets (NextAuth,
  // Prisma, ACS). All subsequent steps can run in parallel.
  const { loadSecretsFromKeyVault } = await import("@/lib/secrets");
  await loadSecretsFromKeyVault();

  // ── 2. Pre-warm lazy singletons ─────────────────────────────────────────────
  // Initialise the NextAuth instance and open the Prisma connection pool now,
  // at startup, so that the first real request finds everything ready.
  // Without this, the first request after a deploy restart pays the full cost
  // of Key Vault calls + DB handshake + NextAuth provider setup.
  await Promise.allSettled([
    import("@/lib/auth").then(({ preWarmAuth }) => preWarmAuth()),
    import("@/lib/prisma-admin").then(({ prismaAdmin }) =>
      prismaAdmin.$queryRaw`SELECT 1`
    ),
  ]);

  // ── 3. Initialise Application Insights ──────────────────────────────────────
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return;

  const appInsights = await import("applicationinsights");

  appInsights
    .setup(connectionString)
    .setAutoCollectRequests(true)
    .setAutoCollectDependencies(true)
    .setAutoCollectExceptions(true)
    .setAutoCollectPerformance(true, true)
    .setUseDiskRetryCaching(true)
    .start();
}
