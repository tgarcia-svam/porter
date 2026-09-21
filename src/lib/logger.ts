import * as ai from "applicationinsights";
import { KnownSeverityLevel as SeverityLevel } from "applicationinsights";

function client() {
  return ai.defaultClient ?? null;
}

export const logger = {
  info(message: string, properties?: Record<string, unknown>) {
    const c = client();
    if (c) {
      c.trackTrace({ message, severity: SeverityLevel.Information, properties });
    } else {
      console.log(message, properties ?? "");
    }
  },

  warn(message: string, properties?: Record<string, unknown>) {
    const c = client();
    if (c) {
      c.trackTrace({ message, severity: SeverityLevel.Warning, properties });
    } else {
      console.warn(message, properties ?? "");
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
        console.error(message, error);
      }
    } else {
      const props =
        error !== undefined
          ? { error: String(error), ...properties }
          : properties;
      if (c) {
        c.trackTrace({ message, severity: SeverityLevel.Error, properties: props });
      } else {
        console.error(message, props ?? "");
      }
    }
  },
};
