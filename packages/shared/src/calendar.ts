// RFC 5545 iCalendar export for scheduled matches. Output is plain text with
// CRLF line endings, escaped text values and lines folded at 75 octets.
export interface CalendarItem {
  id: string;
  title: string;
  start: string; // ISO time
  minutes: number;
  location?: string;
  description?: string;
}

const escapeText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

const stamp = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

// Folds a content line at 75 octets, continuing with a leading space.
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const len = new TextEncoder().encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + len > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += len;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export function matchesToIcs(
  calendarName: string,
  items: CalendarItem[],
  now = new Date(),
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PPRC Sports Elite//Schedule//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  const dtstamp = stamp(now.toISOString());
  for (const item of items) {
    const end = new Date(Date.parse(item.start) + item.minutes * 60000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(item.id)}@pprc-sports-elite`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(item.start)}`,
      `DTEND:${stamp(end.toISOString())}`,
      `SUMMARY:${escapeText(item.title)}`,
    );
    if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`);
    if (item.description)
      lines.push(`DESCRIPTION:${escapeText(item.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
