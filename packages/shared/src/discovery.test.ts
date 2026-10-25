import { describe, it, expect } from "vitest";
import { discoveryGroup, registrationOpenNow } from "./discovery";

const day = 86400000;
const now = Date.parse("2031-03-10T12:00:00.000Z");
const future = new Date(now + 5 * day).toISOString();
const past = new Date(now - 5 * day).toISOString();

describe("tournament discovery groups", () => {
  it("places open and closed registrations with future end dates in upcoming", () => {
    expect(
      discoveryGroup({ status: "Registration Open", endDate: future }, now),
    ).toBe("upcoming");
    expect(
      discoveryGroup({ status: "Registration Closed", endDate: future }, now),
    ).toBe("upcoming");
  });

  it("keeps play-in-progress events active even after their scheduled end", () => {
    expect(discoveryGroup({ status: "In Progress", endDate: past }, now)).toBe(
      "active",
    );
    expect(discoveryGroup({ status: "Check-In", endDate: future }, now)).toBe(
      "active",
    );
  });

  it("lists completed and cancelled events as completed", () => {
    expect(discoveryGroup({ status: "Completed", endDate: future }, now)).toBe(
      "completed",
    );
    expect(discoveryGroup({ status: "Cancelled", endDate: future }, now)).toBe(
      "completed",
    );
  });

  it("moves a still-open event whose end date has passed into completed", () => {
    expect(
      discoveryGroup({ status: "Registration Open", endDate: past }, now),
    ).toBe("completed");
  });
});

describe("registration availability", () => {
  const window = {
    status: "Registration Open" as const,
    registrationOpen: new Date(now - day).toISOString(),
    registrationClose: future,
  };

  it("is open only inside the registration window", () => {
    expect(registrationOpenNow(window, now)).toBe(true);
    expect(
      registrationOpenNow({ ...window, registrationOpen: future }, now),
    ).toBe(false);
    expect(
      registrationOpenNow({ ...window, registrationClose: past }, now),
    ).toBe(false);
  });

  it("is never open for other statuses", () => {
    expect(
      registrationOpenNow({ ...window, status: "Registration Closed" }, now),
    ).toBe(false);
  });
});
