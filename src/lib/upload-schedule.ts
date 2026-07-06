/**
 * Pure date math for per-project upload schedules. No DB, no I/O — everything is
 * a deterministic function of a schedule's cadence fields plus a reference `now`,
 * so the tricky calendar cases (leap years, day-31 clamping, quarter/year
 * boundaries) are exhaustively unit-testable.
 *
 * All comparisons are done on **UTC calendar days** (time-of-day truncated) so a
 * due date is unambiguous regardless of server timezone. The daily scheduler runs
 * at a fixed UTC hour, so "today" is a UTC day throughout.
 *
 * Cadence encoding (calendar-friendly — only the fields relevant to `frequency`
 * are populated):
 *   WEEKLY     → weekday        0=Mon … 6=Sun
 *   MONTHLY    → dayOfMonth     1–31, clamped to the month's last day
 *   QUARTERLY  → monthOfQuarter 1–3 (which month of the quarter) + dayOfMonth
 *   YEARLY     → monthOfYear    1–12 + dayOfMonth
 * Quarters start Jan / Apr / Jul / Oct.
 */

export type ScheduleFrequencyValue = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "YEARLY";

/** The minimal shape the date math needs — Prisma's UploadSchedule satisfies it. */
export type ScheduleShape = {
  frequency: ScheduleFrequencyValue;
  weekday: number | null;
  dayOfMonth: number | null;
  monthOfQuarter: number | null;
  monthOfYear: number | null;
};

const MS_PER_DAY = 86_400_000;

/** Truncate any Date to UTC midnight of its calendar day. */
export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_DAY);
}

/** Whole-day difference a − b (both treated as UTC days). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((utcDay(a).getTime() - utcDay(b).getTime()) / MS_PER_DAY);
}

/** YYYY-MM-DD in UTC — used for human-readable email/UI text and period keys. */
export function formatUtcDate(d: Date): string {
  return utcDay(d).toISOString().slice(0, 10);
}

function daysInMonth(y: number, m0: number): number {
  // Day 0 of the next month is the last day of month m0.
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}

function utcDate(y: number, m0: number, day: number): Date {
  return new Date(Date.UTC(y, m0, day));
}

/** Occurrence of `dayOfMonth` within a given month, clamped to the month length. */
function monthlyOccurrence(y: number, m0: number, dayOfMonth: number): Date {
  return utcDate(y, m0, Math.min(dayOfMonth, daysInMonth(y, m0)));
}

/** Add `delta` months to a (year, month0) pair, normalising the year. */
function addMonths(y: number, m0: number, delta: number): { y: number; m0: number } {
  const total = y * 12 + m0 + delta;
  return { y: Math.floor(total / 12), m0: ((total % 12) + 12) % 12 };
}

/** For month-based frequencies, the (year, month0) the due date falls in for the
 *  period that contains reference month (y, m0). */
function dueMonthFor(
  s: ScheduleShape,
  y: number,
  m0: number
): { y: number; m0: number } {
  switch (s.frequency) {
    case "MONTHLY":
      return { y, m0 };
    case "QUARTERLY": {
      const quarterStart = Math.floor(m0 / 3) * 3; // 0,3,6,9
      return { y, m0: quarterStart + (asInt(s.monthOfQuarter, 1) - 1) };
    }
    case "YEARLY":
      return { y, m0: asInt(s.monthOfYear, 1) - 1 };
    default:
      throw new Error(`dueMonthFor called for non-month frequency ${s.frequency}`);
  }
}

function asInt(v: number | null | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** The due-date occurrence for the period that contains `ref`.
 *  For WEEKLY this is the most-recent target weekday on/before `ref`; for
 *  month-based frequencies it is the occurrence in the containing month/quarter/
 *  year, which may be before or after `ref`. */
function periodOccurrence(s: ScheduleShape, ref: Date): Date {
  if (s.frequency === "WEEKLY") {
    // weekday 0=Mon…6=Sun → JS getUTCDay 0=Sun…6=Sat
    const targetDow = (asInt(s.weekday, 0) + 1) % 7;
    const diff = (ref.getUTCDay() - targetDow + 7) % 7;
    return addDays(ref, -diff);
  }
  const due = dueMonthFor(s, ref.getUTCFullYear(), ref.getUTCMonth());
  return monthlyOccurrence(due.y, due.m0, asInt(s.dayOfMonth, 1));
}

/** Shift an occurrence by `delta` whole periods (±1 = next/previous period). */
function shiftPeriod(s: ScheduleShape, occ: Date, delta: number): Date {
  if (s.frequency === "WEEKLY") return addDays(occ, 7 * delta);
  const monthsPerPeriod = s.frequency === "MONTHLY" ? 1 : s.frequency === "QUARTERLY" ? 3 : 12;
  const shifted = addMonths(occ.getUTCFullYear(), occ.getUTCMonth(), monthsPerPeriod * delta);
  return monthlyOccurrence(shifted.y, shifted.m0, asInt(s.dayOfMonth, 1));
}

export type Occurrences = {
  /** Most recent due date on or before today. */
  lastDue: Date;
  /** Next due date on or after today. */
  upcomingDue: Date;
};

/**
 * Given a schedule and a reference instant, return the most-recent due date
 * (on/before today) and the next due date (on/after today). When today *is* a
 * due date, both equal today.
 */
export function computeOccurrences(s: ScheduleShape, now: Date): Occurrences {
  const today = utcDay(now);
  const cur = periodOccurrence(s, today);

  if (cur.getTime() <= today.getTime()) {
    const lastDue = cur;
    const upcomingDue = cur.getTime() === today.getTime() ? cur : shiftPeriod(s, cur, 1);
    return { lastDue, upcomingDue };
  }
  return { lastDue: shiftPeriod(s, cur, -1), upcomingDue: cur };
}

/** Start of the period ending at `due` (the previous occurrence, exclusive). An
 *  upload counts toward `due` when created after this instant and on/before `due`. */
export function periodStart(s: ScheduleShape, due: Date): Date {
  return shiftPeriod(s, due, -1);
}

/** Next due date on/after `now` — convenience for the admin UI preview. */
export function nextDueDate(s: ScheduleShape, now: Date): Date {
  return computeOccurrences(s, now).upcomingDue;
}

/** Human-readable cadence, e.g. "Monthly on the 15th" — for emails and the UI. */
export function describeSchedule(s: ScheduleShape): string {
  const ordinal = (n: number) => {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
    switch (n % 10) {
      case 1: return `${n}st`;
      case 2: return `${n}nd`;
      case 3: return `${n}rd`;
      default: return `${n}th`;
    }
  };
  const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const dom = asInt(s.dayOfMonth, 1);
  switch (s.frequency) {
    case "WEEKLY":
      return `Weekly on ${WEEKDAYS[asInt(s.weekday, 0)] ?? "Monday"}`;
    case "MONTHLY":
      return `Monthly on the ${ordinal(dom)}`;
    case "QUARTERLY":
      return `Quarterly — the ${ordinal(dom)} of month ${asInt(s.monthOfQuarter, 1)} of each quarter`;
    case "YEARLY":
      return `Yearly on ${MONTHS[asInt(s.monthOfYear, 1) - 1] ?? "January"} ${dom}`;
    default:
      return "Custom schedule";
  }
}
