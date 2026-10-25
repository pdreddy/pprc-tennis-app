import { describe, it, expect } from "vitest";
import {
  notificationPreferencesSchema,
  reminderSuppressed,
} from "./operations";

const tz = "America/Chicago";
const at = (local: string) => Date.parse(`2031-03-17T${local}:00-05:00`);

describe("notification preferences", () => {
  it("validates clock times and nullable quiet hours", () => {
    expect(() =>
      notificationPreferencesSchema.parse({
        inApp: true,
        push: false,
        reminders: true,
        quietStart: "25:00",
        quietEnd: null,
      }),
    ).toThrow();
    expect(
      notificationPreferencesSchema.parse({
        inApp: true,
        push: false,
        reminders: true,
        quietStart: "21:00",
        quietEnd: "07:00",
      }).quietStart,
    ).toBe("21:00");
  });

  it("suppresses reminders when switched off", () => {
    expect(reminderSuppressed({ reminders: false }, at("12:00"), tz)).toBe(
      true,
    );
    expect(reminderSuppressed({ reminders: true }, at("12:00"), tz)).toBe(
      false,
    );
  });

  it("suppresses reminders inside quiet hours that cross midnight", () => {
    const prefs = { reminders: true, quietStart: "21:00", quietEnd: "07:00" };
    expect(reminderSuppressed(prefs, at("23:30"), tz)).toBe(true);
    expect(reminderSuppressed(prefs, at("06:30"), tz)).toBe(true);
    expect(reminderSuppressed(prefs, at("12:00"), tz)).toBe(false);
  });
});
