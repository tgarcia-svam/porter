import * as ai from "applicationinsights";
import { KnownSeverityLevel as SeverityLevel } from "applicationinsights";

function client() {
  return ai.defaultClient ?? null;
}

// Console fallback (only used when App Insights isn't configured, e.g. local dev).
// The text is rebuilt character-by-character from a fixed alphabet, so no CR/LF,
// ANSI or other control characters from user-influenced input can reach the console
// (CWE-117). Raw error objects, stacks and property bags are never printed (CWE-532);
// App Insights still receives the full detail.
const ALLOWED = new Set(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _.:-[]|".split("")
);
const MAX_LEN = 200;

function clean(v: unknown): string {
  const text = v instanceof Error ? `${v.name}: ${v.message}` : String(v);
  let out = "";
  for (const ch of text.slice(0, MAX_LEN)) out += ALLOWED.has(ch) ? ch : "_";
  return out;
}

type Level = "info" | "warn" | "error";

// The only place in the app (besides secrets bootstrap) that writes to the console.
function emit(level: Level, ...parts: unknown[]) {
  const line = parts.map(clean).join(" | ");
  if (level === "info") console.log(line);
  else if (level === "warn") console.warn(line);
  else console.error(line);
}

export const logger = {
  info(message: string, properties?: Record<string, unknown>) {
    const c = client();
    if (c) {
      c.trackTrace({ message, severity: SeverityLevel.Information, properties });
    } else {
      emit("info", message);
    }
  },

  warn(message: string, properties?: Record<string, unknown>) {
    const c = client();
    if (c) {
      c.trackTrace({ message, severity: SeverityLevel.Warning, properties });
    } else {
      emit("warn", message);
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
        emit("error", message, error);
      }
    } else {
      const props =
        error !== undefined
          ? { error: String(error), ...properties }
          : properties;
      if (c) {
        c.trackTrace({ message, severity: SeverityLevel.Error, properties: props });
      } else if (error !== undefined) {
        emit("error", message, error);
      } else {
        emit("error", message);
      }
    }
  },
};
