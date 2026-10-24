import { it, expect } from "vitest";
import {
  membershipRequestInput,
  membershipReviewInput,
  publicPlayerProfile,
} from "./club";
const player = {
  id: "player",
  clubId: "pprc",
  displayName: "Club Player",
  city: "Prosper",
  tennisLevel: "Competitive",
  visibility: "public",
  externalRating: 4.8,
  singlesUtr: 4.7,
  doublesUtr: 5.2,
  ratingSource: "Admin verified",
  email: "private@example.test",
  birthDate: "1995-01-01",
  emergencyContact: "Private",
  notificationPreferences: { push: true },
};
it("whitelists public directory fields without leaking contacts, birth dates or preferences", () => {
  const p = publicPlayerProfile(player, {
    clubId: "pprc",
    member: true,
    role: "clubAdmin",
  })!;
  expect(p.memberClubId).toBe("pprc");
  expect(p.singlesUtr).toBe(4.7);
  expect(p.doublesUtr).toBe(5.2);
  for (const key of [
    "email",
    "birthDate",
    "emergencyContact",
    "notificationPreferences",
    "role",
  ])
    expect(p).not.toHaveProperty(key);
});
it("does not list private profiles even when membership is approved", () =>
  expect(
    publicPlayerProfile(
      { ...player, visibility: "private" },
      { clubId: "pprc", member: true },
    ),
  ).toBeNull());
it("requires current PPRC membership for the club directory projection", () => {
  for (const membership of [
    undefined,
    { clubId: "pprc", member: false },
    { clubId: "other", member: true },
  ])
    expect(publicPlayerProfile(player, membership)?.memberClubId).toBeNull();
});
it("rejects self-selected roles, foreign clubs and impersonated applicants", () => {
  const input = {
    requestId: "10000000-0000-4000-a000-000000000000",
    clubId: "pprc",
    message: " Please review ",
  };
  expect(membershipRequestInput.parse(input).message).toBe("Please review");
  for (const invalid of [
    { ...input, role: "clubAdmin" },
    { ...input, playerId: "someone-else" },
    { ...input, clubId: "other" },
  ])
    expect(() => membershipRequestInput.parse(invalid)).toThrow();
});
it("requires an explicit reviewed decision and meaningful audit reason", () => {
  const input = {
    requestId: "10000000-0000-4000-a000-000000000000",
    clubId: "pprc",
    playerId: "player",
    decision: "Approved",
    reason: "Verified club application",
  };
  expect(membershipReviewInput.parse(input).decision).toBe("Approved");
  expect(() =>
    membershipReviewInput.parse({ ...input, decision: "clubAdmin" }),
  ).toThrow();
  expect(() =>
    membershipReviewInput.parse({ ...input, reason: "yes" }),
  ).toThrow();
});
