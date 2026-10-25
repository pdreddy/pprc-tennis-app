import { z } from "zod";

// Player availability is private. Only the player and club administrators can
// read it (see firestore.rules). Times are local to the player's stated
// preference, expressed as HH:MM; the scheduler converts them to event time.
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const availabilityWindowSchema = z
  .object({ start: clock, end: clock })
  .refine((w) => w.start < w.end, {
    message: "Window end must be after its start",
    path: ["end"],
  });

export const availabilitySchema = z.object({
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  windows: z.array(availabilityWindowSchema).max(6),
  unavailableDates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .max(120)
    .transform((dates) => [...new Set(dates)].sort()),
  notes: z
    .string()
    .max(300)
    .transform((s) => s.replace(/<[^>]*>/g, "").trim())
    .default(""),
});

export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;

// Windows that both players can use, returned as their overlap. Used for
// doubles and team scheduling; inputs are already validated.
export function sharedWindows(
  a: AvailabilityWindow[],
  b: AvailabilityWindow[],
): AvailabilityWindow[] {
  const shared: AvailabilityWindow[] = [];
  for (const x of a)
    for (const y of b) {
      const start = x.start > y.start ? x.start : y.start;
      const end = x.end < y.end ? x.end : y.end;
      if (start < end) shared.push({ start, end });
    }
  return shared;
}

// Local calendar facts for an instant in an event or club timezone.
function localFacts(ms: number, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: days.indexOf(String(parts.weekday)),
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// True when a player's stated availability allows a match from startMs for
// `minutes`, in the event timezone. Empty preferences mean "no restriction".
// A match that would cross local midnight is never allowed.
export function playerAvailableAt(
  availability:
    | {
        weekdays?: number[];
        windows?: AvailabilityWindow[];
        unavailableDates?: string[];
      }
    | undefined,
  startMs: number,
  minutes: number,
  timezone: string,
): boolean {
  if (!availability) return true;
  const start = localFacts(startMs, timezone);
  const end = localFacts(startMs + minutes * 60000, timezone);
  if (start.date !== end.date) return false;
  if (availability.unavailableDates?.includes(start.date)) return false;
  if (
    availability.weekdays?.length &&
    !availability.weekdays.includes(start.weekday)
  )
    return false;
  const windows = availability.windows ?? [];
  const endMinute = end.minute;
  if (
    windows.length &&
    !windows.some((w) => {
      const from = Number(w.start.slice(0, 2)) * 60 + Number(w.start.slice(3));
      const to = Number(w.end.slice(0, 2)) * 60 + Number(w.end.slice(3));
      return start.minute >= from && endMinute <= to;
    })
  )
    return false;
  return true;
}

// A team can play a slot when at least this many roster members are available.
// Two is the fewest players a singles rubber needs. Organizer-configurable
// minimums are not implemented yet.
export const teamAvailabilityMinimum = 2;

export function teamAvailable(
  memberIds: string[],
  availabilityByPlayer: Record<string, unknown>,
  startMs: number,
  minutes: number,
  timezone: string,
  minimum = teamAvailabilityMinimum,
): boolean {
  const available = memberIds.filter((id) =>
    playerAvailableAt(
      availabilityByPlayer[id] as Parameters<typeof playerAvailableAt>[0],
      startMs,
      minutes,
      timezone,
    ),
  ).length;
  return available >= minimum;
}
