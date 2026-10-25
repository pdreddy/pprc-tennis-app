import { describe, it, expect } from "vitest";
import {
  inCalendarView,
  localDateKey,
  reminderPolicy,
  viewRange,
} from "./operations";

const tz = "America/Chicago";
// 2031-03-17 is a Monday. 18:00 Chicago (CDT) is 23:00Z.
const items = [
  { id: "sun", start: "2031-03-16T15:00:00.000Z" }, // Sun 10:00
  { id: "mon", start: "2031-03-17T23:00:00.000Z" }, // Mon 18:00
  { id: "wed", start: "2031-03-19T15:00:00.000Z" }, // Wed 10:00
  { id: "next", start: "2031-04-02T15:00:00.000Z" }, // next month
];

describe("calendar views", () => {
  it("uses the event's local date, not UTC", () => {
    // 23:00Z is still Monday locally, but 04:00Z Tuesday would be Tuesday in UTC.
    expect(localDateKey("2031-03-18T04:00:00.000Z", tz)).toBe("2031-03-17");
  });

  it("day view shows only that local day", () => {
    expect(
      inCalendarView(items, "day", "2031-03-17", tz).map((i) => i.id),
    ).toEqual(["mon"]);
  });

  it("week view runs Monday to Sunday around the anchor", () => {
    expect(viewRange("week", "2031-03-19")).toEqual({
      from: "2031-03-17",
      to: "2031-03-23",
    });
    // Sunday belongs to the week that started the previous Monday.
    expect(viewRange("week", "2031-03-16")).toEqual({
      from: "2031-03-10",
      to: "2031-03-16",
    });
    expect(
      inCalendarView(items, "week", "2031-03-19", tz).map((i) => i.id),
    ).toEqual(["mon", "wed"]);
  });

  it("month view covers the whole calendar month", () => {
    expect(viewRange("month", "2031-03-05")).toEqual({
      from: "2031-03-01",
      to: "2031-03-31",
    });
    expect(viewRange("month", "2031-12-05")).toEqual({
      from: "2031-12-01",
      to: "2031-12-31",
    });
    expect(
      inCalendarView(items, "month", "2031-03-01", tz).map((i) => i.id),
    ).toEqual(["sun", "mon", "wed"]);
  });

  it("keeps reminder defaults explicit", () => {
    expect(reminderPolicy.upcomingMatchMinutes).toBe(30);
    expect(reminderPolicy.overdueScoreHours).toBe(2);
  });
});

import { operationsSummary } from "./operations";

describe("organizer operations summary", () => {
  const now = Date.parse("2031-03-17T12:00:00.000Z");
  const opts = { durationMinutes: 75, bufferMinutes: 15 };
  it("counts upcoming, unscheduled, overdue and missing scores", () => {
    const summary = operationsSummary(
      [
        {
          id: "done",
          status: "Final",
          scheduledAt: "2031-03-16T15:00:00.000Z",
          p1: "a",
          p2: "b",
        },
        {
          id: "late",
          status: "Scheduled",
          scheduledAt: "2031-03-16T15:00:00.000Z",
          courtId: "c1",
          p1: "c",
          p2: "d",
        },
        {
          id: "soon",
          status: "Scheduled",
          scheduledAt: "2031-03-18T15:00:00.000Z",
          courtId: "c2",
          p1: "e",
          p2: "f",
        },
        {
          id: "open",
          status: "Scheduled",
          scheduledAt: null,
          p1: "g",
          p2: "h",
        },
        { id: "bye", status: "Bye", p1: "i" },
      ],
      now,
      opts,
    );
    expect(summary.total).toBe(4);
    expect(summary.final).toBe(1);
    expect(summary.completionPercent).toBe(25);
    expect(summary.upcoming).toBe(1);
    expect(summary.unscheduled).toBe(1);
    expect(summary.overdue).toBe(1);
    expect(summary.missingScores).toBe(1);
  });

  it("reports no completion percentage when nothing is scheduled to play", () => {
    expect(operationsSummary([], now, opts).completionPercent).toBeNull();
  });

  it("detects court and player overlaps within the slot interval", () => {
    const summary = operationsSummary(
      [
        {
          id: "x",
          status: "Scheduled",
          scheduledAt: "2031-03-18T15:00:00.000Z",
          courtId: "c1",
          p1: "a",
          p2: "b",
        },
        {
          id: "y",
          status: "Scheduled",
          scheduledAt: "2031-03-18T15:30:00.000Z",
          courtId: "c1",
          p1: "c",
          p2: "d",
        },
        {
          id: "z",
          status: "Scheduled",
          scheduledAt: "2031-03-18T15:45:00.000Z",
          courtId: "c2",
          p1: "a",
          p2: "e",
        },
        {
          id: "w",
          status: "Scheduled",
          scheduledAt: "2031-03-18T20:00:00.000Z",
          courtId: "c1",
          p1: "f",
          p2: "g",
        },
      ],
      now,
      opts,
    );
    // x–y share court c1 within 90 minutes; x–z share player a within 90 minutes.
    expect(summary.courtConflicts).toBe(2);
  });
});
