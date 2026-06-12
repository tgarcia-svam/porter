/**
 * Shared request validation for the classifications API (POST + PUT).
 *
 * A classification is one of four types, discriminated on `type`:
 *   VALUE_LIST    — text must be one of `values` (case-sensitivity configurable)
 *   REGEX         — text must match `pattern` (`i` flag when not case-sensitive)
 *   NUMBER_RANGE  — number within [minNumber, maxNumber] (either bound optional)
 *   DATE_RANGE    — date within [minDate, maxDate] (either bound optional)
 *
 * toClassificationData() maps a parsed body to the Prisma write payload, writing
 * only the active type's fields and resetting the rest — so switching a
 * classification's type never leaves stale value-list / pattern / bound data.
 */
import { z } from "zod";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const name = z.string().min(1);
// Uploader-facing explanation of the rule. Optional, applies to every type;
// blank/whitespace is normalized to null in toClassificationData().
const description = z.string().max(500).nullish();

export const ClassificationBody = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("VALUE_LIST"),
      name,
      description,
      values: z.array(z.string().min(1)).min(1),
      caseSensitive: z.boolean().default(true),
    }),
    z.object({
      type: z.literal("REGEX"),
      name,
      description,
      pattern: z.string().min(1),
      caseSensitive: z.boolean().default(true),
    }),
    z.object({
      type: z.literal("NUMBER_RANGE"),
      name,
      description,
      minNumber: z.number().nullish(),
      maxNumber: z.number().nullish(),
    }),
    z.object({
      type: z.literal("DATE_RANGE"),
      name,
      description,
      minDate: z.string().regex(DATE_RE, "Expected YYYY-MM-DD").nullish(),
      maxDate: z.string().regex(DATE_RE, "Expected YYYY-MM-DD").nullish(),
    }),
  ])
  .superRefine((d, ctx) => {
    if (d.type === "REGEX") {
      try {
        new RegExp(d.pattern);
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Invalid regular expression",
          path: ["pattern"],
        });
      }
    }
    if (d.type === "NUMBER_RANGE") {
      if (d.minNumber == null && d.maxNumber == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Specify a minimum, a maximum, or both",
          path: ["minNumber"],
        });
      }
      if (d.minNumber != null && d.maxNumber != null && d.minNumber > d.maxNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Minimum must be less than or equal to maximum",
          path: ["maxNumber"],
        });
      }
    }
    if (d.type === "DATE_RANGE") {
      if (d.minDate == null && d.maxDate == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Specify a start date, an end date, or both",
          path: ["minDate"],
        });
      }
      if (d.minDate != null && d.maxDate != null && d.minDate > d.maxDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Start date must be on or before end date",
          path: ["maxDate"],
        });
      }
    }
  });

export type ClassificationInput = z.infer<typeof ClassificationBody>;

/** A `@db.Date` value as a UTC-midnight Date, or null. */
function isoToDate(iso: string | null | undefined): Date | null {
  return iso ? new Date(`${iso}T00:00:00Z`) : null;
}

/**
 * Map a validated body to the full Prisma write payload. Every type-specific
 * field is set explicitly so an update that changes `type` clears the previous
 * type's data rather than leaving it behind.
 */
export function toClassificationData(input: ClassificationInput) {
  const trimmedDescription = input.description?.trim();
  const base = {
    name: input.name,
    description: trimmedDescription ? trimmedDescription : null,
    type: input.type,
    values: [] as string[],
    caseSensitive: true,
    pattern: null as string | null,
    minNumber: null as number | null,
    maxNumber: null as number | null,
    minDate: null as Date | null,
    maxDate: null as Date | null,
  };

  switch (input.type) {
    case "VALUE_LIST":
      return { ...base, values: input.values, caseSensitive: input.caseSensitive };
    case "REGEX":
      return { ...base, pattern: input.pattern, caseSensitive: input.caseSensitive };
    case "NUMBER_RANGE":
      return { ...base, minNumber: input.minNumber ?? null, maxNumber: input.maxNumber ?? null };
    case "DATE_RANGE":
      return { ...base, minDate: isoToDate(input.minDate), maxDate: isoToDate(input.maxDate) };
  }
}
