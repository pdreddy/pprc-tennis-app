import { describe, it, expect } from "vitest";
import {
  availabilitySchema,
  playerAvailableAt,
  sharedWindows,
} from "./availability";

describe("player availability", () => {
  it("normalizes weekdays and dates and rejects inverted windows", () => {
    const parsed = availabilitySchema.parse({
      weekdays: [2, 0, 2],
      windows: [{ start: "18:00", end: "20:00" }],
      unavailableDates: ["2031-03-17", "2031-03-17"],
    });
    expect(parsed.weekdays).toEqual([0, 2]);
    expect(parsed.unavailableDates).toEqual(["2031-03-17"]);
    expect(parsed.notes).toBe("");
    expect(() =>
      availabilitySchema.parse({
        weekdays: [1],
        windows: [{ start: "20:00", end: "18:00" }],
        unavailableDates: [],
      }),
    ).toThrow();
  });

  it("rejects malformed clock times, weekdays and dates", () => {
    const base = { weekdays: [1], windows: [], unavailableDates: [] };
    expect(() =>
      availabilitySchema.parse({ ...base, weekdays: [7] }),
    ).toThrow();
    expect(() =>
      availabilitySchema.parse({
        ...base,
        windows: [{ start: "9am", end: "10:00" }],
      }),
    ).toThrow();
    expect(() =>
      availabilitySchema.parse({ ...base, unavailableDates: ["03/17/2031"] }),
    ).toThrow();
  });

  it("strips markup from notes", () => {
    const parsed = availabilitySchema.parse({
      weekdays: [],
      windows: [],
      unavailableDates: [],
      notes: "<b>Evenings</b> only",
    });
    expect(parsed.notes).toBe("Evenings only");
  });

  it("finds the overlap of two players' windows", () => {
    const a = [{ start: "08:00", end: "12:00" }];
    const b = [
      { start: "10:00", end: "11:00" },
      { start: "11:30", end: "14:00" },
    ];
    expect(sharedWindows(a, b)).toEqual([
      { start: "10:00", end: "11:00" },
      { start: "11:30", end: "12:00" },
    ]);
    expect(sharedWindows([{ start: "08:00", end: "09:00" }], b)).toEqual([]);
  });
});

describe("availability against a match slot", () => {
  const tz = "America/Chicago";
  // 2031-03-17 is a Monday. 18:00 Chicago (CDT, UTC-5) is 23:00Z.
  const monday18 = Date.parse("2031-03-17T23:00:00.000Z");
  const pref = {
    weekdays: [1],
    windows: [{ start: "18:00", end: "20:00" }],
    unavailableDates: [] as string[],
  };

  it("allows any slot when the player has no stated availability", () => {
    expect(playerAvailableAt(undefined, monday18, 75, tz)).toBe(true);
  });

  it("allows a slot inside the preferred day and window", () => {
    expect(playerAvailableAt(pref, monday18, 75, tz)).toBe(true);
  });

  it("rejects a slot on another weekday", () => {
    const tuesday = monday18 + 86400000;
    expect(playerAvailableAt(pref, tuesday, 75, tz)).toBe(false);
  });

  it("rejects a slot that runs past the preferred window", () => {
    expect(playerAvailableAt(pref, monday18 + 90 * 60000, 75, tz)).toBe(false);
  });

  it("rejects an unavailable date", () => {
    expect(
      playerAvailableAt(
        { ...pref, unavailableDates: ["2031-03-17"] },
        monday18,
        75,
        tz,
      ),
    ).toBe(false);
  });

  it("rejects a slot that crosses local midnight", () => {
    // 23:30 Chicago start with 75 minutes runs past midnight.
    const late = Date.parse("2031-03-18T04:30:00.000Z");
    expect(playerAvailableAt({}, late, 75, tz)).toBe(false);
  });
});

import { teamAvailable } from "./availability";

describe("team availability", () => {
  const tz = "America/Chicago";
  const monday18 = Date.parse("2031-03-17T23:00:00.000Z");
  const mondayOnly = { weekdays: [1], windows: [], unavailableDates: [] };
  const tuesdayOnly = { weekdays: [2], windows: [], unavailableDates: [] };

  it("needs at least the minimum number of available members", () => {
    const prefs = { a: mondayOnly, b: mondayOnly, c: tuesdayOnly };
    expect(teamAvailable(["a", "b", "c"], prefs, monday18, 75, tz)).toBe(true);
    expect(teamAvailable(["a", "c"], prefs, monday18, 75, tz)).toBe(false);
  });

  it("treats members without saved availability as available", () => {
    expect(teamAvailable(["x", "y"], {}, monday18, 75, tz)).toBe(true);
  });
});
