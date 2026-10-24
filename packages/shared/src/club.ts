import { z } from "zod";
import type { Entity } from "./index";

export const membershipRequestInput = z
  .object({
    requestId: z.string().uuid(),
    clubId: z.literal("pprc"),
    message: z.string().trim().max(500).default(""),
  })
  .strict();
export const membershipReviewInput = z
  .object({
    requestId: z.string().uuid(),
    clubId: z.literal("pprc"),
    playerId: z.string().regex(/^[\w-]{1,120}$/),
    decision: z.enum(["Approved", "Rejected"]),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
export const membershipWithdrawalInput = z
  .object({
    requestId: z.string().uuid(),
    clubId: z.literal("pprc"),
  })
  .strict();
export interface MembershipRequest extends Entity {
  playerId: string;
  displayName: string;
  city: string;
  message: string;
  status: "Pending" | "Approved" | "Rejected" | "Withdrawn";
  attempt: number;
  reviewedBy?: string;
  decisionReason?: string;
}
export interface PublicPlayerProfile extends Entity {
  displayName: string;
  city: string;
  tennisLevel: string;
  externalRating: number | null;
  singlesUtr: number | null;
  doublesUtr: number | null;
  ratingSource: string;
  memberClubId: "pprc" | null;
}
/** A whitelist shared by profile edits, role changes, verification and demo seed. */
export function publicPlayerProfile(
  player: Entity,
  membership?: Entity | Record<string, any>,
): PublicPlayerProfile | null {
  if (player.visibility !== "public") return null;
  return {
    id: player.id,
    clubId: "pprc",
    displayName: player.displayName,
    city: player.city ?? "",
    tennisLevel: player.tennisLevel ?? "",
    externalRating: player.externalRating ?? null,
    singlesUtr: player.singlesUtr ?? null,
    doublesUtr: player.doublesUtr ?? null,
    ratingSource: player.ratingSource ?? "Player provided",
    ratingVerifiedAt: player.ratingVerifiedAt ?? null,
    memberClubId:
      membership?.clubId === "pprc" && membership.member === true
        ? "pprc"
        : null,
  };
}
