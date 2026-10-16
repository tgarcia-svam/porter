import * as ai from "applicationinsights";
import { KnownSeverityLevel as SeverityLevel } from "applicationinsights";

function client() {
  return ai.defaultClient ?? null;
}

// Console fallback (only used when App Insights isn't configured, e.g. local dev).
// Strip CR/LF/control characters so user-influenced text can't forge log lines
// (CWE-117), and never print raw error objects, stacks or property bags
// (CWE-532) — App Insights still receives the full detail.
function safe(v: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/[\x00-\x1f\x7f]+/g, " ").slice(0, 500);
}
function describe(e: unknown): string {
  return e instanceof Error ? `${safe(e.name)}: ${safe(e.message)}` : safe(e);
}

export const logger = {
  info(message: string, properties?: Record<string, unknown>) {
    const c = client();
    if (c) {
      c.trackTrace({ message, severity: SeverityLevel.Information, properties });
    } else {
      console.log(safe(message));
    }
  },

  warn(message: string, properties?: Record<string, unknown>) {
    const c = client();
    if (c) {
      c.trackTrace({ message, severity: SeverityLevel.Warning, properties });
    } else {
      console.warn(safe(message));
    }
  },

  error(
    message: string,
    error?: unknown,
    properties?: Record<string, unknown>
  ) {
    const c = client();
    if (error instanceof Error) {
      if (c) {
        c.trackException({
          exception: error,
          severity: SeverityLevel.Error,
          properties: { message, ...properties },
        });
      } else {
        console.error(`${safe(message)} — ${describe(error)}`);
      }
    } else {
      const props =
        error !== undefined
          ? { error: String(error), ...properties }
          : properties;
      if (c) {
        c.trackTrace({ message, severity: SeverityLevel.Error, properties: props });
      } else {
        console.error(error !== undefined ? `${safe(message)} — ${describe(error)}` : safe(message));
      }
    }
  },
};
