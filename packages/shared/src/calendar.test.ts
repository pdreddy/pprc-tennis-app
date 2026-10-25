import { describe, it, expect } from "vitest";
import { matchesToIcs } from "./calendar";

const now = new Date("2031-03-01T00:00:00.000Z");
const item = {
  id: "match-1",
  title: "Round 1: Lee, J; Patel, A",
  start: "2031-03-17T15:00:00.000Z",
  minutes: 75,
  location: "Court 2, West, PPRC",
};

describe("calendar export", () => {
  it("writes a valid calendar with CRLF endings and computed end times", () => {
    const ics = matchesToIcs("My matches", [item], now);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART:20310317T150000Z");
    expect(ics).toContain("DTEND:20310317T161500Z");
    expect(ics).toContain("UID:match-1@pprc-sports-elite");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });

  it("escapes commas, semicolons and backslashes in text values", () => {
    const ics = matchesToIcs("Club", [item], now);
    expect(ics).toContain("SUMMARY:Round 1: Lee\\, J\; Patel\\, A");
    expect(ics).toContain("LOCATION:Court 2\\, West\\, PPRC");
    const slash = matchesToIcs("Club", [{ ...item, title: "A\\B" }], now);
    expect(slash).toContain("SUMMARY:A\\\\B");
  });

  it("folds long lines so no content line exceeds 75 octets", () => {
    const long = "x".repeat(200);
    const ics = matchesToIcs("Club", [{ ...item, description: long }], now);
    const rows = ics.split("\r\n");
    expect(rows.every((r) => new TextEncoder().encode(r).length <= 75)).toBe(
      true,
    );
    // Unfolding (CRLF followed by a space) must restore the original text.
    expect(ics.replace(/\r\n /g, "")).toContain("x".repeat(200));
  });

  it("produces an empty but valid calendar when there are no matches", () => {
    const ics = matchesToIcs("Club", [], now);
    expect(ics).toBe(
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//PPRC Sports Elite//Schedule//EN\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Club\r\nEND:VCALENDAR\r\n",
    );
  });
});
