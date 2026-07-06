import { describe, it, expect } from "vitest";
import {
  computeOccurrences,
  periodStart,
  nextDueDate,
  describeSchedule,
  formatUtcDate,
  type ScheduleShape,
} from "../upload-schedule";

// Convenience: build a schedule shape with sane nulls.
function sched(partial: Partial<ScheduleShape> & { frequency: ScheduleShape["frequency"] }): ScheduleShape {
  return {
    weekday: null,
    dayOfMonth: null,
    monthOfQuarter: null,
    monthOfYear: null,
    ...partial,
  };
}

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const last = (s: ScheduleShape, iso: string) => formatUtcDate(computeOccurrences(s, at(iso)).lastDue);
const next = (s: ScheduleShape, iso: string) => formatUtcDate(computeOccurrences(s, at(iso)).upcomingDue);

// ── WEEKLY ────────────────────────────────────────────────────────────────────

describe("WEEKLY", () => {
  // 2024-01-01 is a Monday.
  const monday = sched({ frequency: "WEEKLY", weekday: 0 }); // 0 = Monday
  const sunday = sched({ frequency: "WEEKLY", weekday: 6 }); // 6 = Sunday

  it("finds the surrounding Mondays from a Wednesday", () => {
    expect(last(monday, "2024-01-03")).toBe("2024-01-01");
    expect(next(monday, "2024-01-03")).toBe("2024-01-08");
  });

  it("when today is the due weekday, last and next both equal today", () => {
    expect(last(monday, "2024-01-01")).toBe("2024-01-01");
    expect(next(monday, "2024-01-01")).toBe("2024-01-01");
  });

  it("handles a Sunday due date crossing a year boundary", () => {
    expect(last(sunday, "2024-01-03")).toBe("2023-12-31"); // Sun before
    expect(next(sunday, "2024-01-03")).toBe("2024-01-07"); // Sun after
  });

  it("periodStart is 7 days before the due date", () => {
    const due = computeOccurrences(monday, at("2024-01-03")).upcomingDue; // 2024-01-08
    expect(formatUtcDate(periodStart(monday, due))).toBe("2024-01-01");
  });
});

// ── MONTHLY ─────────────────────────────────────────────────────────────────

describe("MONTHLY", () => {
  const dom15 = sched({ frequency: "MONTHLY", dayOfMonth: 15 });
  const dom31 = sched({ frequency: "MONTHLY", dayOfMonth: 31 });

  it("resolves before/after the due day within a month", () => {
    expect(last(dom15, "2024-03-20")).toBe("2024-03-15");
    expect(next(dom15, "2024-03-20")).toBe("2024-04-15");
    expect(last(dom15, "2024-03-10")).toBe("2024-02-15");
    expect(next(dom15, "2024-03-10")).toBe("2024-03-15");
  });

  it("clamps day 31 to the month's last day (Feb, leap year)", () => {
    expect(next(dom31, "2024-02-15")).toBe("2024-02-29");
    expect(last(dom31, "2024-02-15")).toBe("2024-01-31");
  });

  it("clamps day 31 in a non-leap February", () => {
    expect(next(dom31, "2023-02-10")).toBe("2023-02-28");
  });

  it("on the due day, last and next both equal today", () => {
    expect(last(dom15, "2024-03-15")).toBe("2024-03-15");
    expect(next(dom15, "2024-03-15")).toBe("2024-03-15");
  });
});

// ── QUARTERLY ──────────────────────────────────────────────────────────────

describe("QUARTERLY", () => {
  // 1st month of quarter, day 10 → Jan 10 / Apr 10 / Jul 10 / Oct 10.
  const q1 = sched({ frequency: "QUARTERLY", monthOfQuarter: 1, dayOfMonth: 10 });
  // 3rd month of quarter, day 15 → Mar 15 / Jun 15 / Sep 15 / Dec 15.
  const q3 = sched({ frequency: "QUARTERLY", monthOfQuarter: 3, dayOfMonth: 15 });

  it("steps a full quarter for the first month of the quarter", () => {
    expect(last(q1, "2024-05-20")).toBe("2024-04-10");
    expect(next(q1, "2024-05-20")).toBe("2024-07-10");
  });

  it("crosses the year boundary for the third month of the quarter", () => {
    expect(next(q3, "2024-01-05")).toBe("2024-03-15");
    expect(last(q3, "2024-01-05")).toBe("2023-12-15");
  });

  it("periodStart of a quarterly due is the previous quarter's occurrence", () => {
    const due = at("2024-07-10");
    expect(formatUtcDate(periodStart(q1, due))).toBe("2024-04-10");
  });
});

// ── YEARLY ───────────────────────────────────────────────────────────────────

describe("YEARLY", () => {
  // Feb 29 → clamps to Feb 28 in non-leap years.
  const feb29 = sched({ frequency: "YEARLY", monthOfYear: 2, dayOfMonth: 29 });
  const jul4 = sched({ frequency: "YEARLY", monthOfYear: 7, dayOfMonth: 4 });

  it("resolves the leap-year occurrence and clamps the next non-leap year", () => {
    expect(next(feb29, "2024-01-01")).toBe("2024-02-29");
    expect(last(feb29, "2024-01-01")).toBe("2023-02-28");
  });

  it("steps a full year, clamping Feb 29 → Feb 28", () => {
    expect(last(feb29, "2025-06-01")).toBe("2025-02-28");
    expect(next(feb29, "2025-06-01")).toBe("2026-02-28");
  });

  it("handles a mid-year due date", () => {
    expect(last(jul4, "2024-09-01")).toBe("2024-07-04");
    expect(next(jul4, "2024-09-01")).toBe("2025-07-04");
  });
});

// ── nextDueDate + describeSchedule ─────────────────────────────────────────────

describe("nextDueDate", () => {
  it("returns the upcoming occurrence", () => {
    const s = sched({ frequency: "MONTHLY", dayOfMonth: 1 });
    expect(formatUtcDate(nextDueDate(s, at("2024-03-15")))).toBe("2024-04-01");
  });
});

describe("describeSchedule", () => {
  it("renders human-readable cadences", () => {
    expect(describeSchedule(sched({ frequency: "WEEKLY", weekday: 0 }))).toBe("Weekly on Monday");
    expect(describeSchedule(sched({ frequency: "MONTHLY", dayOfMonth: 15 }))).toBe("Monthly on the 15th");
    expect(describeSchedule(sched({ frequency: "MONTHLY", dayOfMonth: 1 }))).toBe("Monthly on the 1st");
    expect(describeSchedule(sched({ frequency: "MONTHLY", dayOfMonth: 22 }))).toBe("Monthly on the 22nd");
    expect(describeSchedule(sched({ frequency: "YEARLY", monthOfYear: 7, dayOfMonth: 4 }))).toBe("Yearly on July 4");
  });
});
