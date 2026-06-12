/**
 * Server-side guard: a classification may only be assigned to a column whose
 * data type it can meaningfully constrain. The schema editor filters its
 * dropdown by the same rules, but the server is the source of truth.
 *
 *   TEXT / EMAIL    → VALUE_LIST, REGEX
 *   NUMBER / INTEGER→ NUMBER_RANGE
 *   DATE            → DATE_RANGE
 *   BOOLEAN         → (none)
 */
import { prismaAdmin } from "./prisma-admin";

type ColumnDataType = "TEXT" | "NUMBER" | "INTEGER" | "BOOLEAN" | "DATE" | "EMAIL";
type ClassificationType = "VALUE_LIST" | "REGEX" | "NUMBER_RANGE" | "DATE_RANGE";

const COMPAT: Record<ColumnDataType, ClassificationType[]> = {
  TEXT: ["VALUE_LIST", "REGEX"],
  EMAIL: ["VALUE_LIST", "REGEX"],
  NUMBER: ["NUMBER_RANGE"],
  INTEGER: ["NUMBER_RANGE"],
  DATE: ["DATE_RANGE"],
  BOOLEAN: [],
};

type ColumnRef = { name: string; dataType: ColumnDataType; classificationId?: string | null };

/**
 * Verify every column's referenced classification is type-compatible with the
 * column's data type. Returns an error message for the first mismatch (or an
 * unknown reference), or null when all assignments are valid.
 */
export async function checkColumnClassifications(columns: ColumnRef[]): Promise<string | null> {
  const ids = columns.map((c) => c.classificationId).filter((id): id is string => !!id);
  if (ids.length === 0) return null;

  const found = await prismaAdmin.classification.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, type: true },
  });
  const byId = new Map(found.map((c) => [c.id, c]));

  for (const col of columns) {
    if (!col.classificationId) continue;
    const cls = byId.get(col.classificationId);
    if (!cls) return `Column "${col.name}" references an unknown classification.`;
    if (!COMPAT[col.dataType].includes(cls.type)) {
      return `Classification "${cls.name}" is not compatible with the ${col.dataType} column "${col.name}".`;
    }
  }
  return null;
}
