import { describe, it, expect } from "vitest";
import { availabilitySchema, sharedWindows } from "./availability";

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
