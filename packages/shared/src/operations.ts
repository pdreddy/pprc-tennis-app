import { z } from "zod";

// Reminder policy defaults. Reminders are created by the scheduled maintenance
// job and are deduplicated by a deterministic notification id, so a job that
// runs repeatedly never sends the same reminder twice.
export const reminderPolicy = {
  upcomingMatchMinutes: 30,
  overdueScoreHours: 2,
} as const;

export type CalendarView = "day" | "week" | "month";

// Local calendar date (YYYY-MM-DD) for an instant in a timezone.
export function localDateKey(iso: string, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

const dayMs = 86400000;
const toUtc = (key: string) => Date.parse(`${key}T00:00:00.000Z`);
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// Inclusive date range that a view covers around an anchor date. Weeks start on
// Monday, as in the rest of the scheduling UI.
export function viewRange(
  view: CalendarView,
  anchor: string,
): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: anchor };
  if (view === "week") {
    const day = new Date(toUtc(anchor)).getUTCDay(); // 0 = Sunday
    const mondayOffset = (day + 6) % 7;
    const monday = toUtc(anchor) - mondayOffset * dayMs;
    return { from: fromUtc(monday), to: fromUtc(monday + 6 * dayMs) };
  }
  const [year, month] = anchor.split("-").map(Number);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = Date.UTC(year, month, 1);
  return { from: first, to: fromUtc(next - dayMs) };
}

// Items whose local start date falls inside the view, sorted by start time.
export function inCalendarView<T extends { start: string }>(
  items: T[],
  view: CalendarView,
  anchor: string,
  timezone: string,
): T[] {
  const { from, to } = viewRange(view, anchor);
  return items
    .filter((item) => {
      const key = localDateKey(item.start, timezone);
      return key >= from && key <= to;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

export interface OperationsMatch {
  id: string;
  status?: string;
  scheduledAt?: string | null;
  courtId?: string | null;
  p1?: string | null;
  p2?: string | null;
}

// Counts for the organizer dashboard, computed from match records only. The
// server is the source of truth for results; this view never changes them.
export function operationsSummary(
  matches: OperationsMatch[],
  now: number,
  options: {
    durationMinutes: number;
    bufferMinutes: number;
    upcomingDays?: number;
  },
) {
  const live = matches.filter((m) => m.status !== "Bye");
  const final = live.filter((m) => m.status === "Final").length;
  const soon = now + (options.upcomingDays ?? 7) * 86400000;
  const when = (m: OperationsMatch) =>
    m.scheduledAt ? Date.parse(m.scheduledAt) : NaN;
  const open = live.filter((m) => m.status !== "Final");
  const interval = options.durationMinutes + options.bufferMinutes;
  let courtConflicts = 0;
  const dated = live.filter((m) => Number.isFinite(when(m)));
  for (let i = 0; i < dated.length; i++)
    for (let j = i + 1; j < dated.length; j++) {
      const a = dated[i],
        b = dated[j];
      const close = Math.abs(when(a) - when(b)) < interval * 60000;
      const sameCourt = !!a.courtId && a.courtId === b.courtId;
      const sharedPlayer = [a.p1, a.p2].some(
        (p) => !!p && [b.p1, b.p2].includes(p),
      );
      if (close && (sameCourt || sharedPlayer)) courtConflicts++;
    }
  return {
    total: live.length,
    final,
    completionPercent: live.length
      ? Math.round((final / live.length) * 100)
      : null,
    upcoming: open.filter(
      (m) => Number.isFinite(when(m)) && when(m) >= now && when(m) <= soon,
    ).length,
    unscheduled: open.filter((m) => !m.scheduledAt && !!m.p1 && !!m.p2).length,
    overdue: open.filter((m) => Number.isFinite(when(m)) && when(m) < now)
      .length,
    missingScores: open.filter(
      (m) =>
        m.status === "Scheduled" && Number.isFinite(when(m)) && when(m) < now,
    ).length,
    courtConflicts,
  };
}

export const notificationPreferencesSchema = z.object({
  inApp: z.boolean(),
  push: z.boolean(),
  reminders: z.boolean(),
  quietStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  quietEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
});

// True when a reminder should be held back: reminders switched off, or the
// local time falls inside the player's quiet hours. Quiet hours may cross
// midnight (for example 21:00 to 07:00).
export function reminderSuppressed(
  prefs: Partial<z.infer<typeof notificationPreferencesSchema>> | undefined,
  nowMs: number,
  timezone: string,
): boolean {
  if (prefs?.reminders === false) return true;
  if (!prefs?.quietStart || !prefs?.quietEnd) return false;
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(new Date(nowMs))
    .map((p) => [p.type, p.value]);
  const parts = Object.fromEntries(local);
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  const toMinutes = (v: string) =>
    Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  const from = toMinutes(prefs.quietStart),
    to = toMinutes(prefs.quietEnd);
  return from <= to
    ? minute >= from && minute < to
    : minute >= from || minute < to;
}
