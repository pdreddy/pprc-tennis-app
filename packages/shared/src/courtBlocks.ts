import { z } from "zod";

// Court maintenance blocks. A block removes one PPRC court from scheduling
// for a half-open interval [start, end). Blocks are stored one document per
// block so that court edits (which replace the court document) never drop them.
export const courtBlockSchema = z
  .object({
    courtId: z.string().min(1).max(120),
    start: z.string().datetime(),
    end: z.string().datetime(),
    reason: z
      .string()
      .max(300)
      .transform((s) => s.replace(/<[^>]*>/g, "").trim())
      .pipe(z.string().min(2)),
  })
  .refine((b) => Date.parse(b.end) > Date.parse(b.start), {
    message: "Block end must be after its start",
    path: ["end"],
  });

export interface CourtBlock {
  courtId: string;
  start: string;
  end: string;
}

// True when a court is blocked at any point in [startMs, endMs).
export function courtBlocked(
  blocks: CourtBlock[],
  courtId: string,
  startMs: number,
  endMs: number,
) {
  return blocks.some(
    (b) =>
      b.courtId === courtId &&
      startMs < Date.parse(b.end) &&
      endMs > Date.parse(b.start),
  );
}
