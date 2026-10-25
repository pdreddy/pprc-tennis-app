import { describe, it, expect } from "vitest";
import { courtBlockSchema, courtBlocked, collections } from "./index";

const block = {
  courtId: "court-1",
  start: "2026-11-02T14:00:00.000Z",
  end: "2026-11-02T16:00:00.000Z",
};

describe("court maintenance blocks", () => {
  it("accepts a synthetic block and strips markup from its reason", () => {
    const parsed = courtBlockSchema.parse({
      ...block,
      reason: " <b>Resurfacing</b> ",
    });
    expect(parsed.reason).toBe("Resurfacing");
  });

  it("rejects a block whose end is not after its start", () => {
    expect(() =>
      courtBlockSchema.parse({ ...block, end: block.start }),
    ).toThrow();
    expect(() =>
      courtBlockSchema.parse({
        ...block,
        end: "2026-11-02T13:00:00.000Z",
        reason: "Net repair",
      }),
    ).toThrow();
  });

  it("rejects a reason that is empty after stripping markup", () => {
    expect(() =>
      courtBlockSchema.parse({ ...block, reason: "<i></i>" }),
    ).toThrow();
  });

  it("detects overlap on the blocked court only", () => {
    const blocks = [block];
    const at = (h: number) => Date.parse(`2026-11-02T${h}:00:00.000Z`);
    expect(courtBlocked(blocks, "court-1", at(15), at(15) + 3600000)).toBe(
      true,
    );
    expect(courtBlocked(blocks, "court-2", at(15), at(15) + 3600000)).toBe(
      false,
    );
  });

  it("treats touching intervals as free (half-open [start, end))", () => {
    const blocks = [block];
    const at = (h: number) => Date.parse(`2026-11-02T${h}:00:00.000Z`);
    // A match ending exactly when the block starts is allowed.
    expect(courtBlocked(blocks, "court-1", at(12), at(14))).toBe(false);
    // A match starting exactly when the block ends is allowed.
    expect(courtBlocked(blocks, "court-1", at(16), at(17))).toBe(false);
    // Any overlap, even one minute, is blocked.
    expect(
      courtBlocked(blocks, "court-1", at(13) + 59 * 60000, at(14) + 60000),
    ).toBe(true);
  });

  it("is registered as a backed-up collection", () => {
    expect(collections).toContain("courtBlocks");
  });
});
