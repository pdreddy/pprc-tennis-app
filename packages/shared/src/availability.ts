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
