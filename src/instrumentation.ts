/**
 * Next.js server instrumentation hook — runs once on startup before any
 * request is handled.  Used to initialise Azure Application Insights so that
 * all HTTP requests, dependencies, exceptions, and console output are
 * automatically collected and shipped to Azure Monitor.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run in the Node.js runtime (not Edge).  Application Insights relies
  // on Node-specific APIs (http module patching, etc.).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) return;

  const appInsights = await import("applicationinsights");

  appInsights
    .setup(connectionString)
    .setAutoCollectRequests(true)        // HTTP request durations + status codes
    .setAutoCollectDependencies(true)    // outbound calls (DB, blob, auth)
    .setAutoCollectExceptions(true)      // unhandled errors
    .setAutoCollectPerformance(true, true) // CPU / memory + extended metrics
    .setAutoCollectConsole(true)         // console.log/warn/error → traces
    .setUseDiskRetryCaching(true)        // buffer telemetry if network is down
    .start();
}
