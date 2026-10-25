import { serverNow } from "./clock.js";
import { randomUUID, createHash } from "node:crypto";
import {
  getFirestore,
  FieldValue,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  executeTriace,
  triaceCollections,
  type TriaceContext,
} from "./triace.js";
import {
  executeLadder,
  ladderCollections,
  validateLadderTeamOperation,
  reconcileLadder,
} from "./ladder.js";
import {
  eventSchema,
  divisionSchema,
  scoreSchema,
  eligibility,
  canManage,
  registrationPlacement,
  elimination,
  roundRobin,
  standings,
  advance,
  validateScore,
  scheduleConflict,
  withinDailyHours,
  courtBlockSchema,
  courtBlocked,
  csv,
  type CourtBlock,
  type Entity,
  type Event,
  type Division,
  type Match,
  type Role,
  triaceRulesSchema,
  competitionRules,
  ladderRulesSchema,
  ladderCalendar,
  isTeamCompetition,
  membershipRequestInput,
  membershipReviewInput,
  membershipWithdrawalInput,
  publicPlayerProfile,
} from "@pprc/shared";
export const eventCollections = [
  "divisions",
  "registrations",
  "payments",
  "draws",
  "drawNodes",
  "matches",
  "matchResults",
  "notifications",
  ...triaceCollections,
  ...ladderCollections,
] as const;
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const active = ["Pending Payment", "Registered", "Approved"];
export const fail = (
  message: string,
  code: ConstructorParameters<typeof HttpsError>[0] = "failed-precondition",
): never => {
  throw new HttpsError(code, message);
};
export const requiredReason = (input: Entity | any) =>
  z
    .string()
    .trim()
    .min(5, "A reason of at least 5 characters is required")
    .max(1000)
    .parse(input.reason);
export async function execute(
  operation: string,
  uid: string,
  raw: any,
  system = false,
): Promise<any> {
  const db = getFirestore();
  const data: any = z
    .object({ requestId: z.string().uuid(), eventId: idSchema.optional() })
    .passthrough()
    .parse(raw);
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ operation, ...data }))
    .digest("hex");
  const eventId =
    data.eventId ??
    (operation === "createEvent" ? `event-${data.requestId}` : "");
  const receipt = db.doc(`operationRequests/${uid}-${data.requestId}`);
  return db.runTransaction(async (tx) => {
    const [receiptSnap, memberSnap, profileSnap, eventSnap] = await Promise.all(
      [
        tx.get(receipt),
        tx.get(db.doc(`memberships/${uid}`)),
        tx.get(db.doc(`users/${uid}`)),
        eventId ? tx.get(db.doc(`events/${eventId}`)) : Promise.resolve(null),
      ],
    );
    if (receiptSnap.exists) {
      if (receiptSnap.get("hash") !== requestHash)
        fail("Request ID reused for a different operation");
      return receiptSnap.get("result");
    }
    const role =
      memberSnap.data()?.clubId === "pprc"
        ? (memberSnap.data()?.role as Role)
        : undefined;
    const event = eventSnap?.data() as Event | undefined;
    const manager = canManage(role, uid, event);
    const profile = profileSnap.data() as Entity | undefined;
    const rateRef = db.doc(`registrationLimits/${uid}`);
    const rateSnap =
      operation === "registerForDivision" ? await tx.get(rateRef) : null;
    const clubOperation = [
      "requestClubMembership",
      "reviewClubMembership",
      "withdrawClubMembershipRequest",
    ].includes(operation);
    const operationLimitId = clubOperation ? `club-${uid}` : uid;
    const operationLimit =
      ["triace", "teamCompetition", "ladder"].includes(operation) ||
      clubOperation
        ? await tx.get(db.doc(`operationLimits/${operationLimitId}`))
        : null;
    const buckets: Record<string, Entity[]> = {};
    if (eventId) {
      const snapshots = await Promise.all(
        eventCollections.map((c) =>
          tx.get(db.collection(c).where("eventId", "==", eventId)),
        ),
      );
      eventCollections.forEach(
        (c, i) =>
          (buckets[c] = snapshots[i].docs.map(
            (d) => ({ id: d.id, ...d.data() }) as Entity,
          )),
      );
    }
    // Court maintenance blocks are read inside this transaction so a concurrent
    // block cannot be missed by a schedule or reschedule that commits after it.
    const courtBlocks: CourtBlock[] = [];
    if (
      eventId &&
      event?.courtIds?.length &&
      ["generateSchedule", "rescheduleMatch", "triace", "teamCompetition"].includes(operation)
    ) {
      const blockSnapshots = await Promise.all(
        event.courtIds.map((courtId) =>
          tx.get(db.collection("courtBlocks").where("courtId", "==", courtId)),
        ),
      );
      for (const snapshot of blockSnapshots)
        for (const d of snapshot.docs) courtBlocks.push(d.data() as CourtBlock);
    }
    const updates = new Map<string, Entity | null>();
    const now = FieldValue.serverTimestamp();
    let result: any = { eventId };
    let auditBefore: any = null;
    let auditAfter: any = null;
    const put = (collection: string, entity: Entity) => {
      updates.set(`${collection}/${entity.id}`, entity);
      const list = buckets[collection];
      if (list) {
        const i = list.findIndex((x) => x.id === entity.id);
        if (i >= 0) list[i] = entity;
        else list.push(entity);
      }
      return entity;
    };
    const make = (collection: string, fields: any, id: string = randomUUID()) =>
      put(collection, {
        id,
        clubId: "pprc",
        ...(eventId ? { eventId } : {}),
        ...fields,
        createdAt: now,
        updatedAt: now,
        createdBy: uid,
      });
    const edit = (collection: string, entity: Entity, fields: any) => {
      auditBefore ??= JSON.parse(JSON.stringify(entity));
      return put(collection, { ...entity, ...fields, updatedAt: now });
    };
    const list = (c: string) => buckets[c] ?? [];
    const find = (c: string, id: unknown) =>
      list(c).find((x) => x.id === id) ??
      fail(`${c} record not found`, "not-found");
    const notify = (
      playerId: string,
      title: string,
      body: string,
      type: string,
      href?: string,
    ) =>
      make("notifications", {
        playerId,
        title,
        body,
        type,
        read: false,
        ...(href ? { href } : {}),
      });
    const applyOperationLimit = (maximum: number) => {
      const recent = serverNow() - (operationLimit?.get("window") ?? 0) < 60000;
      const count = recent ? (operationLimit?.get("count") ?? 0) : 0;
      if (count >= maximum)
        fail("Too many operations; retry in a minute", "resource-exhausted");
      make(
        "operationLimits",
        {
          window: recent ? operationLimit!.get("window") : serverNow(),
          count: count + 1,
        },
        operationLimitId,
      );
    };
    const projectPlayer = (
      player: Entity,
      membership?: Entity | Record<string, any>,
    ) => {
      const projection = publicPlayerProfile(player, membership);
      if (projection)
        put("publicProfiles", {
          ...projection,
          createdAt: player.createdAt ?? now,
          updatedAt: now,
        });
      else updates.set(`publicProfiles/${player.id}`, null);
    };
    const requireAdmin = () => {
      if (!manager)
        fail("Event administrator access required", "permission-denied");
    };
    const requireClub = () => {
      if (role !== "clubAdmin")
        fail("Club administrator access required", "permission-denied");
    };
    const getDivision = (id: unknown) => find("divisions", id) as Division;
    const regFor = (id: unknown) => find("registrations", id);
    const price = (d: Entity) => d.fee ?? event!.fee;
    const promote = () => {
      if (
        !event ||
        !["Registration Open", "Registration Closed"].includes(event.status)
      )
        return;
      const regs = list("registrations");
      if (isTeamCompetition(event) && list("teamEncounters").length) return;
      for (const waiting of regs
        .filter((r) => r.state === "Waitlisted")
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
        const d = getDivision(waiting.divisionId);
        if (list("draws").some((draw) => draw.divisionId === d.id)) continue;
        if (
          regs.filter((r) => r.divisionId === d.id && active.includes(r.state))
            .length >= d.capacity ||
          regs.filter((r) => active.includes(r.state)).length >= event.capacity
        )
          continue;
        const next = price(d) > 0 ? "Pending Payment" : "Registered";
        edit("registrations", waiting, {
          state: next,
          paymentExpiresAt: serverNow() + 30 * 60000,
        });
        notify(
          waiting.playerId,
          "A place is yours",
          `You were promoted from the waitlist for ${event.name}. ${next === "Pending Payment" ? "Complete payment within 30 minutes." : ""}`,
          "waitlist-promoted",
        );
      }
    };
    const finalize = (match: Match, res: Entity) => {
      if (match.version !== res.baseVersion)
        fail("Score version changed; reload before finalizing");
      const division = getDivision(match.divisionId);
      validateScore(res.score, match.p1!, match.p2!, division.scoring);
      const all = list("matches") as Match[];
      advance(all, match, res.score.winner);
      match.version++;
      put("matches", { ...match, updatedAt: now });
      if (match.nextId)
        put("matches", { ...find("matches", match.nextId), updatedAt: now });
      edit("matchResults", res, {
        state: "Final",
        version: match.version,
        finalizedBy: uid,
        finalizedAt: now,
      });
      updateStandings(division);
      for (const p of [match.p1!, match.p2!])
        notify(
          p,
          "Result finalized",
          `${event!.name}: match result is final.`,
          "result-finalized",
        );
    };
    const updateStandings = (division: Division) => {
      for (const draw of list("draws").filter(
        (d) => d.divisionId === division.id && d.phase === "groups",
      )) {
        const grouped = (draw.groups as { players: string[] }[]).map(
          (g) => g.players,
        );
        const tables = grouped.map((players, i) =>
          standings(
            players,
            (list("matches") as Match[]).filter(
              (m) => m.drawId === draw.id && m.group === i,
            ),
            list("matchResults"),
            division.tieBreakOrder,
            draw.resolutions ?? {},
          ),
        );
        edit("draws", draw, { standings: tables.map((rows) => ({ rows })) });
        const games = list("matches").filter((m) => m.drawId === draw.id);
        if (
          division.format === "round-robin-playoffs" &&
          games.length &&
          games.every((m) => m.status === "Final") &&
          !list("draws").some(
            (d) => d.divisionId === division.id && d.phase === "playoffs",
          )
        ) {
          if (
            tables.some((t) =>
              t.slice(0, division.qualifiers).some((r) => r.tied),
            )
          )
            return;
          const qualifiers = tables.flatMap((t) =>
            t.slice(0, division.qualifiers).map((r) => r.playerId),
          );
          if (qualifiers.length >= 2) {
            const id = `${draw.id}-playoffs`;
            make(
              "draws",
              {
                divisionId: division.id,
                phase: "playoffs",
                published: false,
                players: qualifiers,
              },
              id,
            );
            for (const m of elimination(qualifiers, id, division.id)) {
              make("matches", { ...m, published: false }, m.id);
              make(
                "drawNodes",
                {
                  drawId: id,
                  divisionId: division.id,
                  matchId: m.id,
                  published: false,
                  round: m.round,
                  position: m.position,
                },
                m.id,
              );
            }
          }
        }
      }
    };
    if (
      event &&
      isTeamCompetition(event) &&
      [
        "registerForDivision",
        "generateDraw",
        "publishDraw",
        "generateSchedule",
        "rescheduleMatch",
        "submitScore",
        "finalizeScore",
        "approveRegistration",
        "updateRoundRobinStandings",
      ].includes(operation)
    )
      fail(
        event?.competition === "triace"
          ? "Use the TRIACE team workspace for this operation"
          : "Use the team competition workspace for this operation",
      );
    if (
      ![
        "createEvent",
        "saveProfile",
        "requestAccountDeletion",
        "manageClub",
        "registerPushToken",
        "createEventTemplate",
        "requestClubMembership",
        "reviewClubMembership",
        "withdrawClubMembershipRequest",
      ].includes(operation) &&
      !event
    )
      fail("Event not found", "not-found");
    if (event && event.clubId !== "pprc")
      fail("This deployment cannot manage another club", "permission-denied");
    switch (operation) {
      case "requestClubMembership": {
        const input = membershipRequestInput.parse(data);
        const applicant =
          profile ?? fail("Complete your player profile before joining a club");
        if (role === "platformAdmin")
          fail("Support role is read only", "permission-denied");
        if (memberSnap.exists && memberSnap.get("clubId") !== "pprc")
          fail(
            "An existing foreign-club membership cannot be replaced",
            "permission-denied",
          );
        const [clubSnap, requestSnap, admins] = await Promise.all([
          tx.get(db.doc("clubs/pprc")),
          tx.get(db.doc(`membershipRequests/${uid}`)),
          tx.get(
            db
              .collection("memberships")
              .where("clubId", "==", "pprc")
              .where("role", "==", "clubAdmin"),
          ),
        ]);
        if (!clubSnap.exists) fail("Club not found", "not-found");
        if (requestSnap.exists && requestSnap.get("clubId") !== "pprc")
          fail("Foreign-club request cannot be replaced", "permission-denied");
        applyOperationLimit(5);
        if (memberSnap.get("member") === true) {
          result = { status: "Member" };
          break;
        }
        if (clubSnap.get("acceptingMembershipRequests") === false)
          fail("This club is not accepting membership requests");
        if (requestSnap.get("status") === "Pending") {
          result = { status: "Pending" };
          break;
        }
        make(
          "membershipRequests",
          {
            playerId: uid,
            displayName: applicant.displayName,
            city: applicant.city ?? "",
            message: input.message,
            status: "Pending",
            attempt: (requestSnap.get("attempt") ?? 0) + 1,
          },
          uid,
        );
        for (const admin of admins.docs)
          notify(
            admin.id,
            "Club membership request",
            `${applicant.displayName} would like to join PPRC.`,
            "membership-request",
            "/admin/members",
          );
        result = { status: "Pending" };
        break;
      }
      case "withdrawClubMembershipRequest": {
        membershipWithdrawalInput.parse(data);
        if (role === "platformAdmin")
          fail("Support role is read only", "permission-denied");
        const request = await tx.get(db.doc(`membershipRequests/${uid}`));
        if (
          !request.exists ||
          request.get("clubId") !== "pprc" ||
          request.get("status") !== "Pending"
        )
          fail("No pending membership request");
        applyOperationLimit(20);
        edit("membershipRequests", { id: uid, ...request.data() } as Entity, {
          status: "Withdrawn",
        });
        result = { status: "Withdrawn" };
        break;
      }
      case "reviewClubMembership": {
        requireClub();
        const input = membershipReviewInput.parse(data);
        const [request, player, membership] = await Promise.all([
          tx.get(db.doc(`membershipRequests/${input.playerId}`)),
          tx.get(db.doc(`users/${input.playerId}`)),
          tx.get(db.doc(`memberships/${input.playerId}`)),
        ]);
        if (
          !request.exists ||
          request.get("clubId") !== "pprc" ||
          request.get("status") !== "Pending"
        )
          fail("Membership request is not pending");
        if (!player.exists || player.get("clubId") !== "pprc")
          fail("Player profile not found", "not-found");
        if (membership.exists && membership.get("clubId") !== "pprc")
          fail(
            "Foreign-club membership cannot be overwritten",
            "permission-denied",
          );
        applyOperationLimit(240);
        edit(
          "membershipRequests",
          { id: request.id, ...request.data() } as Entity,
          {
            status: input.decision,
            reviewedBy: uid,
            reviewedAt: now,
            decisionReason: input.reason,
          },
        );
        if (input.decision === "Approved") {
          const m = make(
            "memberships",
            {
              ...membership.data(),
              role: membership.get("role") ?? "player",
              member: true,
              playerId: input.playerId,
            },
            input.playerId,
          );
          projectPlayer({ id: player.id, ...player.data() } as Entity, m);
        }
        notify(
          input.playerId,
          input.decision === "Approved"
            ? "Club membership approved"
            : "Club membership request reviewed",
          input.reason,
          "membership-decision",
          "/clubs/pprc",
        );
        result = { status: input.decision };
        break;
      }
      case "triace":
      case "teamCompetition":
      case "ladder": {
        if (!system) applyOperationLimit(manager ? 240 : 120);
        const context: TriaceContext = {
          uid,
          role,
          data,
          get event() {
            return (updates.get(`events/${eventId}`) ?? event!) as Entity;
          },
          profile,
          manager,
          clubMember:
            memberSnap.get("clubId") === "pprc" &&
            memberSnap.get("member") === true,
          list,
          find,
          make,
          edit,
          notify,
          reason: () => requiredReason(data),
          readPlayer: async (playerId) => {
            const s = await tx.get(db.doc(`users/${idSchema.parse(playerId)}`));
            return s.exists ? ({ id: s.id, ...s.data() } as Entity) : undefined;
          },
          courtBlocks,
          readMembership: async (playerId) => {
            const s = await tx.get(
              db.doc(`memberships/${idSchema.parse(playerId)}`),
            );
            return s.exists ? ({ id: s.id, ...s.data() } as Entity) : undefined;
          },
          readCourt: async (courtId) => {
            const s = await tx.get(db.doc(`courts/${idSchema.parse(courtId)}`));
            return s.exists ? ({ id: s.id, ...s.data() } as Entity) : undefined;
          },
        };
        if (operation === "ladder")
          result = await executeLadder(context, system);
        else {
          if (event!.competition === "ladder")
            validateLadderTeamOperation(context);
          result = await executeTriace(context);
          if (event!.competition === "ladder") reconcileLadder(context);
        }
        if (data.action === "withdrawTeam") promote();
        break;
      }
      case "saveProfile": {
        if (profile && profile.clubId !== "pprc")
          fail(
            "Foreign-club profile cannot be overwritten",
            "permission-denied",
          );
        const p = z
          .object({
            displayName: z.string().min(2).max(100),
            city: z.string().max(100),
            preferredSport: z.enum(["Tennis", "Pickleball"]),
            tennisLevel: z.string().max(100),
            externalRating: z.number().min(0).max(20).optional(),
            singlesUtr: z.number().min(0).max(20).optional(),
            doublesUtr: z.number().min(0).max(20).optional(),
            ratingSource: z.string().max(100).default("Player provided"),
            handedness: z.enum(["Right", "Left", "Ambidextrous"]),
            availability: z.string().max(500),
            emergencyContact: z.string().max(300),
            visibility: z.enum(["public", "private"]),
            notificationPreferences: z.object({
              inApp: z.boolean(),
              push: z.boolean(),
            }),
            birthDate: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .refine(
                (v) =>
                  Number.isFinite(Date.parse(v)) &&
                  new Date(v).toISOString().slice(0, 10) === v &&
                  Date.parse(v) <= serverNow(),
                "Valid past birth date required",
              )
              .optional(),
            gender: z.enum(["Male", "Female", "Other"]).optional(),
            photoPath: z.string().startsWith(`photos/${uid}/`).optional(),
          })
          .parse(data.profile);
        const entity = {
          ...profile,
          ...p,
          ratingSource:
            profile?.ratingSource === "Admin verified" &&
            profile.externalRating === p.externalRating &&
            (p.singlesUtr === undefined ||
              profile.singlesUtr === p.singlesUtr) &&
            (p.doublesUtr === undefined || profile.doublesUtr === p.doublesUtr)
              ? "Admin verified"
              : "Player provided",
          ratingVerifiedAt:
            profile?.ratingSource === "Admin verified" &&
            profile.externalRating === p.externalRating &&
            (p.singlesUtr === undefined ||
              profile.singlesUtr === p.singlesUtr) &&
            (p.doublesUtr === undefined || profile.doublesUtr === p.doublesUtr)
              ? profile.ratingVerifiedAt
              : null,
          id: uid,
          clubId: "pprc",
          updatedAt: now,
          createdAt: profile?.createdAt ?? now,
          createdBy: uid,
        };
        put("users", entity);
        projectPlayer(entity, memberSnap.data());
        result = { id: uid };
        break;
      }
      case "requestAccountDeletion": {
        if (!profile) fail("Create a profile first");
        edit("users", profile!, { deletionRequestedAt: now });
        make("deletionRequests", { playerId: uid, status: "Pending" }, uid);
        result = { status: "Pending" };
        break;
      }
      case "registerPushToken": {
        const token = z.string().min(20).max(4096).parse(data.token);
        put("pushTokens", {
          id: createHash("sha256").update(token).digest("hex"),
          clubId: "pprc",
          playerId: uid,
          token,
          createdAt: now,
          updatedAt: now,
        });
        break;
      }
      case "manageClub": {
        requireClub();
        requiredReason(data);
        const target = z
          .enum(["court", "courtBlock", "membership", "template", "rating", "venue", "club"])
          .parse(data.target);
        if (["court", "venue"].includes(target) && data.id) {
          const existing = await tx.get(
            db.doc(
              `${target === "court" ? "courts" : "venues"}/${idSchema.parse(data.id)}`,
            ),
          );
          if (existing.exists && existing.get("clubId") !== "pprc")
            fail(
              "Foreign-club resources cannot be overwritten",
              "permission-denied",
            );
        }
        if (target === "club") {
          const existingClub = await tx.get(db.doc("clubs/pprc"));
          const value = z
            .object({
              name: z.string().min(2).max(160),
              timezone: z.string().refine((v) => {
                try {
                  new Intl.DateTimeFormat("en", { timeZone: v });
                  return true;
                } catch {
                  return false;
                }
              }),
              location: z.string().max(200),
              contactEmail: z.string().email(),
              acceptingMembershipRequests: z
                .boolean()
                .default(
                  existingClub.get("acceptingMembershipRequests") !== false,
                ),
            })
            .parse(data.value);
          make("clubs", value, "pprc");
        }
        if (target === "membership") {
          const id = idSchema.parse(data.id);
          const memberRole = z
            .enum(["player", "eventAdmin", "clubAdmin", "platformAdmin"])
            .parse(data.role);
          if (id === uid && memberRole !== "clubAdmin")
            fail("Cannot remove your own club-admin role");
          const [player, request, existingMembership] = await Promise.all([
            tx.get(db.doc(`users/${id}`)),
            tx.get(db.doc(`membershipRequests/${id}`)),
            tx.get(db.doc(`memberships/${id}`)),
          ]);
          if (
            (existingMembership.exists &&
              existingMembership.get("clubId") !== "pprc") ||
            (player.exists && player.get("clubId") !== "pprc")
          )
            fail(
              "Foreign-club membership cannot be overwritten",
              "permission-denied",
            );
          const membership = make(
            "memberships",
            { role: memberRole, member: !!data.member, playerId: id },
            id,
          );
          if (player.exists)
            projectPlayer({ id, ...player.data() } as Entity, membership);
          if (
            data.member &&
            request.get("status") === "Pending" &&
            request.get("clubId") === "pprc"
          ) {
            edit("membershipRequests", { id, ...request.data() } as Entity, {
              status: "Approved",
              reviewedBy: uid,
              reviewedAt: now,
              decisionReason: data.reason,
            });
            notify(
              id,
              "Club membership approved",
              data.reason,
              "membership-decision",
              "/clubs/pprc",
            );
          }
        }
        if (target === "rating") {
          const id = idSchema.parse(data.id);
          const snap = await tx.get(db.doc(`users/${id}`));
          if (!snap.exists || snap.get("clubId") !== "pprc")
            fail("PPRC player not found");
          const rating = z.number().min(0).max(20).parse(data.rating);
          const singlesUtr = z
            .number()
            .min(0)
            .max(20)
            .parse(data.singlesUtr ?? rating);
          const doublesUtr = z
            .number()
            .min(0)
            .max(20)
            .parse(data.doublesUtr ?? rating);
          const current = { id, ...snap.data() } as Entity;
          const updated = edit("users", current, {
            externalRating: rating,
            singlesUtr,
            doublesUtr,
            ratingSource: "Admin verified",
            ratingVerifiedAt: now,
          });
          const membership = await tx.get(db.doc(`memberships/${id}`));
          projectPlayer(updated, membership.data());
        }
        if (target === "venue") {
          const value = z
            .object({
              name: z.string().min(2).max(160),
              location: z.string().min(2).max(160),
            })
            .parse(data.value);
          make("venues", value, idSchema.parse(data.id));
        }
        if (target === "court") {
          const p = z
            .object({
              name: z.string().min(2).max(100),
              venueId: idSchema,
              surface: z.string(),
              active: z.boolean(),
            })
            .parse(data.value);
          const venue = await tx.get(db.doc(`venues/${p.venueId}`));
          if (!venue.exists || venue.get("clubId") !== "pprc")
            fail("Choose an existing PPRC venue");
          make("courts", p, idSchema.parse(data.id ?? randomUUID()));
        }
        if (target === "courtBlock") {
          // Blocks are club-scoped maintenance windows. Each change is a single
          // audited write carrying the organizer's reason.
          const action = z.enum(["add", "remove"]).parse(data.action ?? "add");
          if (action === "add") {
            const p = courtBlockSchema.parse(data.value);
            const court = await tx.get(db.doc(`courts/${idSchema.parse(p.courtId)}`));
            if (!court.exists || court.get("clubId") !== "pprc" || !court.get("active"))
              fail("Choose an active PPRC court");
            make("courtBlocks", p, randomUUID());
          } else {
            const blockId = idSchema.parse(data.blockId);
            const existing = await tx.get(db.doc(`courtBlocks/${blockId}`));
            if (!existing.exists || existing.get("clubId") !== "pprc")
              fail("Court block not found");
            updates.set(`courtBlocks/${blockId}`, null);
          }
        }
        if (target === "template") {
          make("eventTemplates", {
            name: z.string().min(2).parse(data.name),
            event: eventSchema.parse(data.event),
            divisions: z.array(divisionSchema).min(1).parse(data.divisions),
          });
        }
        break;
      }
      case "createEvent": {
        if (role !== "clubAdmin" && role !== "eventAdmin")
          fail("Administrator access required", "permission-denied");
        const e = eventSchema.parse(data.event),
          divisions = z
            .array(divisionSchema)
            .min(1)
            .max(8)
            .parse(data.divisions);
        if (divisions.reduce((n, d) => n + d.capacity, 0) > 128)
          fail("Maximum 128 entries per event");
        const ladderConfig =
          e.competition === "ladder"
            ? ladderRulesSchema.parse(e.ladderRules ?? {})
            : null;
        const ladderDates = ladderConfig
          ? ladderCalendar(e.startDate, e.endDate, e.timezone)
          : null;
        if (isTeamCompetition(e))
          competitionRules({
            ...e,
            ...(ladderConfig ? { ladderRules: ladderConfig } : {}),
            id: eventId,
            clubId: "pprc",
          });
        if (
          isTeamCompetition(e) &&
          (divisions.length !== 1 ||
            e.capacity > (e.competition === "ladder" ? 32 : 16) ||
            divisions[0].capacity > (e.competition === "ladder" ? 32 : 16))
        )
          fail("Team competitions use one division and at most 16 teams");
        make(
          "events",
          {
            ...e,
            ...(e.competition === "triace"
              ? {
                  triaceRules: triaceRulesSchema.parse(e.triaceRules ?? {}),
                  schemaVersion: 2,
                }
              : {}),
            ...(["koc", "doubles"].includes(e.competition)
              ? {
                  teamRules: competitionRules({
                    ...e,
                    id: eventId,
                    clubId: "pprc",
                  }),
                  schemaVersion: 3,
                  formatLabel:
                    e.competition === "doubles" ? "Doubles" : "KOC teams",
                }
              : {}),
            ...(ladderConfig
              ? {
                  ladderRules: ladderConfig,
                  schemaVersion: 4,
                  endDate: new Date(ladderDates!.freezeAt).toISOString(),
                  formatLabel: `${ladderConfig.entryKind === "doubles" ? "Doubles" : "Singles"} ladder`,
                }
              : {}),
            divisionFilters: divisions.map((d) => ({
              minRating: d.minRating,
              maxRating: d.maxRating,
            })),
            registeredCount: 0,
            waitlistCount: 0,
            waiverVersion: 1,
            status: "Draft",
            assignedAdmins: [...new Set([...e.assignedAdmins, uid])],
          },
          eventId,
        );
        divisions.forEach((d, i) =>
          make("divisions", d, `${eventId}-d${i + 1}`),
        );
        result = { eventId };
        break;
      }
      case "updateEvent": {
        requireAdmin();
        if (
          list("registrations").some((r) => active.includes(r.state)) &&
          data.divisions
        )
          fail("Divisions cannot be replaced after registration");
        const patch = eventSchema.parse({ ...event, ...data.event });
        if (patch.competition !== (event!.competition ?? "individual"))
          fail("Competition format cannot be changed; create a separate event");
        if (isTeamCompetition(patch)) {
          if (patch.capacity > (patch.competition === "ladder" ? 32 : 16))
            fail("TRIACE capacity is at most 16 teams");
          if (
            data.event?.triaceRules ||
            data.event?.teamRules ||
            data.event?.ladderRules
          )
            fail("Change TRIACE rules through the audited team workspace");
          if (
            data.divisions &&
            (data.divisions.length !== 1 ||
              data.divisions[0].capacity >
                (patch.competition === "ladder" ? 32 : 16))
          )
            fail("Team competitions use one division and at most 16 teams");
          if (
            list("teams").length &&
            (patch.waiverRequired !== event!.waiverRequired ||
              patch.refundPolicy !== event!.refundPolicy)
          )
            fail("Waiver policy is locked after team creation");
        }
        if (patch.competition === "ladder") {
          ladderCalendar(patch.startDate, patch.endDate, patch.timezone);
          if (
            event!.ladderState?.started &&
            (patch.startDate !== event!.startDate ||
              patch.endDate !== event!.endDate ||
              patch.timezone !== event!.timezone)
          )
            fail("Season calendar locks after the ladder starts");
        }
        if (
          patch.capacity <
          list("registrations").filter((r) => active.includes(r.state)).length
        )
          fail("Capacity below existing entries");
        edit("events", event!, {
          ...patch,
          waiverVersion:
            patch.waiverRequired !== event!.waiverRequired ||
            patch.refundPolicy !== event!.refundPolicy ||
            JSON.stringify(patch.questions) !== JSON.stringify(event!.questions)
              ? (event!.waiverVersion ?? 1) + 1
              : (event!.waiverVersion ?? 1),
        });
        if (
          patch.startDate !== event!.startDate ||
          patch.endDate !== event!.endDate ||
          patch.venue !== event!.venue ||
          patch.timezone !== event!.timezone
        )
          for (const reg of list("registrations").filter(
            (r) => active.includes(r.state) || r.state === "Waitlisted",
          ))
            notify(
              reg.playerId,
              "Event rescheduled",
              `${event!.name}: review the updated event details.`,
              "event-rescheduled",
            );
        if (data.divisions) {
          const ds = z
            .array(divisionSchema)
            .min(1)
            .max(8)
            .parse(data.divisions);
          for (const d of list("divisions"))
            updates.set(`divisions/${d.id}`, null);
          ds.forEach((d, i) => make("divisions", d, `${eventId}-d${i + 1}`));
        }
        break;
      }
      case "publishEvent": {
        requireAdmin();
        eventSchema.parse(event);
        if (
          event!.competition === "ladder" &&
          !ladderRulesSchema.parse(event!.ladderRules).policyConfirmed
        )
          fail("Review and confirm the ladder policy before publishing");
        if (!list("divisions").length) fail("At least one division required");
        if (
          ["koc", "doubles"].includes(event!.competition) &&
          !competitionRules(event!).policyConfirmed
        )
          fail("Review and confirm the competition policy before publishing");
        if (event!.status !== "Draft" && event!.status !== "Published")
          fail("Event already published");
        edit("events", event!, {
          status:
            serverNow() >= Date.parse(event!.registrationOpen) &&
            serverNow() < Date.parse(event!.registrationClose)
              ? "Registration Open"
              : "Published",
        });
        break;
      }
      case "createEventTemplate": {
        requireClub();
        if (!event) fail("Event required");
        make("eventTemplates", {
          name: event!.name,
          event: { ...event, id: undefined },
          divisions: list("divisions"),
        });
        break;
      }
      case "registerForDivision": {
        const window = rateSnap?.get("window") ?? 0;
        const count =
          serverNow() - window < 60000 ? (rateSnap?.get("count") ?? 0) : 0;
        if (count >= 5)
          fail(
            "Registration limit reached; try again in a minute",
            "resource-exhausted",
          );
        make(
          "registrationLimits",
          { window: count ? window : serverNow(), count: count + 1 },
          uid,
        );
        if (!profile) fail("Complete your player profile before registering");
        if (role === "platformAdmin")
          fail("Support role is read only", "permission-denied");
        if (
          event!.visibility === "private" &&
          (!memberSnap.exists ||
            memberSnap.get("member") !== true ||
            memberSnap.get("clubId") !== "pprc")
        )
          fail("Club membership required", "permission-denied");
        if (
          event!.status !== "Registration Open" ||
          serverNow() < Date.parse(event!.registrationOpen) ||
          serverNow() > Date.parse(event!.registrationClose)
        )
          fail("Registration is closed");
        const division = getDivision(data.divisionId);
        if (list("draws").some((d) => d.divisionId === division.id))
          fail("Registration closed for this division: draw generated");
        const issue = eligibility(profile!, division);
        if (issue) fail(issue);
        if (event!.waiverRequired && !data.waiver)
          fail("Waiver acknowledgement required");
        const answers = z
          .record(z.string().max(2000))
          .parse(data.answers ?? {});
        for (const q of event!.questions)
          if (!answers[q]?.trim()) fail(`Answer required: ${q}`);
        if (
          list("registrations").some(
            (r) =>
              r.playerId === uid &&
              r.divisionId === division.id &&
              !["Withdrawn", "Rejected", "Refunded", "Cancelled"].includes(
                r.state,
              ),
          )
        )
          fail("Already registered in this division");
        const recent = list("registrations").filter(
          (r) => r.playerId === uid && r.order > serverNow() - 60000,
        );
        if (recent.length >= 3)
          fail("Please wait before registering again", "resource-exhausted");
        const state = registrationPlacement(
          list("registrations").filter(
            (r) => r.divisionId === division.id && active.includes(r.state),
          ).length,
          list("registrations").filter((r) => active.includes(r.state)).length,
          division.capacity,
          event!.capacity,
          event!.waitlist,
        );
        const reg = make("registrations", {
          playerId: uid,
          displayName: profile!.displayName,
          eventName: event!.name,
          divisionName: division.name,
          externalRating: profile!.externalRating ?? 0,
          divisionId: division.id,
          state:
            state === "Registered" && price(division) > 0
              ? "Pending Payment"
              : state,
          order: serverNow(),
          seed: 0,
          checkIn: "Not Checked In",
          waiver: !!data.waiver,
          waiverVersion: event!.waiverVersion ?? 1,
          waiverAcceptedAt: now,
          answers,
          ...(data.waiverPath
            ? {
                waiverPath: z
                  .string()
                  .startsWith(`waivers/${eventId}/${uid}/`)
                  .max(500)
                  .parse(data.waiverPath),
              }
            : {}),
          paymentExpiresAt: serverNow() + 30 * 60000,
        });
        notify(
          uid,
          state === "Waitlisted"
            ? "Added to waitlist"
            : "Registration received",
          event!.name,
          "registration",
        );
        result = { eventId, registrationId: reg.id, state: reg.state };
        break;
      }
      case "cancelRegistration":
      case "rejectRegistration": {
        const reg = regFor(data.registrationId);
        if (
          reg.teamId &&
          (list("teamEncounters").length || event!.ladderState?.started)
        )
          fail("Team fixtures are locked; use encounter forfeits and disputes");
        if (reg.playerId !== uid) requireAdmin();
        if (operation === "rejectRegistration") requireAdmin();
        requiredReason(data);
        if (!active.includes(reg.state) && reg.state !== "Waitlisted")
          fail("Registration is not active");
        const inDraw = list("draws").some(
          (d) =>
            d.divisionId === reg.divisionId &&
            (d.players ?? []).includes(reg.playerId),
        );
        if (event!.status === "Completed")
          fail("Completed event entries cannot be withdrawn");
        edit("registrations", reg, {
          state: operation === "rejectRegistration" ? "Rejected" : "Withdrawn",
          reason: data.reason,
          ...(inDraw ? { checkIn: "Withdrawn" } : {}),
        });
        if (inDraw)
          for (const admin of event!.assignedAdmins)
            notify(
              admin,
              "Player withdrew after draw",
              `${reg.displayName} withdrew. Review their scheduled matches and record a walkover where appropriate.`,
              "withdrawal",
            );
        for (const p of list("payments").filter(
          (p) => p.registrationId === reg.id && p.state === "Paid",
        ))
          edit("payments", p, {
            refundRequested: true,
            refundReason: data.reason,
          });
        promote();
        notify(
          reg.playerId,
          "Registration updated",
          `Status: ${operation === "rejectRegistration" ? "Rejected" : "Withdrawn"}`,
          "registration",
        );
        break;
      }
      case "promoteWaitlist": {
        requireAdmin();
        promote();
        break;
      }
      case "approveRegistration": {
        requireAdmin();
        const reg = regFor(data.registrationId);
        if (!["Registered", "Approved"].includes(reg.state))
          fail("Registration must be paid or free before approval");
        const seed = z
          .number()
          .int()
          .min(0)
          .max(128)
          .parse(data.seed ?? reg.seed);
        if (seed !== reg.seed) requiredReason(data);
        if (list("draws").some((d) => d.divisionId === reg.divisionId))
          fail("Seeding is locked after draw generation");
        if (
          seed > 0 &&
          list("registrations").some(
            (r) =>
              r.id !== reg.id &&
              r.divisionId === reg.divisionId &&
              r.seed === seed,
          )
        )
          fail("Seed is already assigned");
        edit("registrations", reg, { state: "Approved", seed });
        break;
      }
      case "reserveCheckout": {
        const reg = regFor(data.registrationId);
        if (reg.playerId !== uid)
          fail("Own registration required", "permission-denied");
        if (reg.state !== "Pending Payment") fail("Payment not required");
        if (reg.paymentExpiresAt < serverNow())
          fail("Payment reservation expired");
        const division = getDivision(reg.divisionId);
        const existing = list("payments").find(
          (p) => p.registrationId === reg.id && p.state === "Pending",
        );
        const payment =
          existing ??
          make("payments", {
            registrationId: reg.id,
            playerId: uid,
            amount: price(division),
            currency: "usd",
            state: "Pending",
            provider:
              process.env.FUNCTIONS_EMULATOR === "true"
                ? "development"
                : "stripe",
          });
        result = {
          paymentId: payment.id,
          amount: payment.amount,
          registrationId: reg.id,
          eventId,
        };
        break;
      }
      case "confirmDevelopmentPayment":
      case "recordStripePayment": {
        if (
          operation === "confirmDevelopmentPayment" &&
          process.env.FUNCTIONS_EMULATOR !== "true"
        )
          fail(
            "Payment simulation is available only in the emulator",
            "permission-denied",
          );
        if (operation === "recordStripePayment" && !system)
          fail("Webhook only", "permission-denied");
        const payment = find("payments", data.paymentId);
        if (!system && payment.playerId !== uid)
          fail("Own payment required", "permission-denied");
        if (payment.state === "Paid") {
          result = { paymentId: payment.id };
          break;
        }
        const reg = regFor(payment.registrationId);
        if (system && data.amount !== payment.amount)
          fail("Payment amount mismatch");
        if (
          reg.state !== "Pending Payment" ||
          reg.paymentExpiresAt < serverNow()
        ) {
          if (!system) fail("Payment reservation expired");
          edit("payments", payment, {
            state: "Refund Required",
            providerReference: data.providerReference,
            refundRequested: true,
            refundReason: "Payment arrived after reservation expired",
          });
          notify(
            reg.playerId,
            "Payment needs review",
            "Your payment arrived after your place expired. The club will arrange a refund.",
            "payment-review",
          );
          result = { paymentId: payment.id, status: "Refund Required" };
          break;
        }
        edit("payments", payment, {
          state: "Paid",
          paidAt: now,
          providerReference: data.providerReference ?? "emulator",
        });
        edit("registrations", reg, { state: "Registered" });
        notify(
          reg.playerId,
          "Payment completed",
          `Registration confirmed for ${event!.name}.`,
          "payment-completed",
        );
        result = { paymentId: payment.id };
        break;
      }
      case "recordStripeFailure": {
        if (!system) fail("Verified webhook only", "permission-denied");
        const payment = find("payments", data.paymentId),
          reg = regFor(payment.registrationId);
        if (payment.playerId !== uid)
          fail("Payment owner mismatch", "permission-denied");
        if (payment.state === "Pending") {
          edit("payments", payment, {
            state: "Failed",
            failureReason: data.reason,
          });
          if (reg.state === "Pending Payment")
            edit("registrations", reg, {
              state: "Cancelled",
              reason: "Payment failed or checkout expired",
            });
          notify(
            reg.playerId,
            "Payment could not be completed",
            event!.name,
            "payment-failed",
          );
          promote();
        }
        result = { paymentId: payment.id };
        break;
      }
      case "generateDraw": {
        requireAdmin();
        const d = getDivision(data.divisionId);
        if (list("draws").some((draw) => draw.divisionId === d.id))
          fail("Draw already exists");
        if (
          list("registrations").some(
            (r) =>
              r.divisionId === d.id &&
              ["Registered", "Pending Payment"].includes(r.state),
          )
        )
          fail("Resolve pending registrations before drawing");
        const players = list("registrations")
          .filter((r) => r.divisionId === d.id && r.state === "Approved")
          .sort(
            (a, b) =>
              (a.seed || 999) - (b.seed || 999) ||
              (b.externalRating ?? 0) - (a.externalRating ?? 0) ||
              a.id.localeCompare(b.id),
          )
          .map((r) => r.playerId);
        if (players.length < 2) fail("Approve at least two players");
        const drawId = `${d.id}-draw`;
        let matches: Match[] = [];
        if (d.format === "single-elimination") {
          make(
            "draws",
            { divisionId: d.id, phase: "knockout", players, published: false },
            drawId,
          );
          matches = elimination(players, drawId, d.id);
        } else {
          const groups: string[][] = Array.from(
            {
              length:
                d.format === "round-robin"
                  ? 1
                  : Math.ceil(players.length / d.groupSize),
            },
            () => [],
          );
          players.forEach((p, i) => groups[i % groups.length].push(p));
          if (groups.some((g) => g.length < 2))
            fail("Groups need at least two players");
          make(
            "draws",
            {
              divisionId: d.id,
              phase: "groups",
              players,
              groups: groups.map((players) => ({ players })),
              published: false,
              standings: [],
              resolutions: {},
            },
            drawId,
          );
          matches = groups.flatMap((g, i) => roundRobin(g, drawId, d.id, i));
        }
        for (const m of matches) {
          make("matches", { ...m, published: false }, m.id);
          make(
            "drawNodes",
            {
              drawId,
              divisionId: d.id,
              matchId: m.id,
              published: false,
              round: m.round,
              position: m.position,
            },
            m.id,
          );
        }
        if (
          event!.status === "Registration Open" &&
          list("divisions").every((d) =>
            list("draws").some((draw) => draw.divisionId === d.id),
          )
        )
          edit("events", event!, { status: "Registration Closed" });
        result = { drawId, matches: matches.length };
        break;
      }
      case "publishDraw": {
        requireAdmin();
        const draw = find("draws", data.drawId);
        edit("draws", draw, { published: data.published !== false });
        for (const collection of ["matches", "drawNodes", "matchResults"])
          for (const record of list(collection).filter(
            (r) => r.drawId === draw.id,
          ))
            edit(collection, record, { published: data.published !== false });
        for (const p of draw.players)
          notify(
            p,
            "Draw updated",
            `${event!.name}: ${data.published === false ? "draw unpublished" : "draw published"}.`,
            "draw-published",
          );
        break;
      }
      case "generateSchedule": {
        requireAdmin();
        if (!event!.courtIds.length) fail("Configure courts first");
        const courtSnapshots = await Promise.all(
          event!.courtIds.map((id) => tx.get(db.doc(`courts/${id}`))),
        );
        const availableCourts = courtSnapshots
          .filter(
            (c) => c.exists && c.get("active") && c.get("clubId") === "pprc",
          )
          .map((c) => c.id);
        if (!availableCourts.length) fail("No active PPRC courts configured");
        const interval = event!.duration + event!.buffer;
        const matches = (list("matches") as Match[])
          .filter((m) => m.status !== "Bye" && !m.scheduledAt)
          .sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));
        const scheduled = (list("matches") as Match[]).filter(
          (m) => m.scheduledAt,
        );
        const start = Date.parse(
            z
              .string()
              .datetime()
              .parse(data.start ?? event!.startDate),
          ),
          end = Date.parse(event!.endDate);
        for (const m of matches) {
          let placed = false;
          const prior = (list("matches") as Match[]).filter(
            (x) => x.nextId === m.id,
          );
          const earliest = Math.max(
            start,
            ...prior.map(
              (x) =>
                Date.parse(x.scheduledAt ?? event!.startDate) +
                interval * 60000,
            ),
          );
          for (
            let t = earliest;
            t + event!.duration * 60000 <= end && !placed;
            t += interval * 60000
          ) {
            const localHour = Number(
              new Intl.DateTimeFormat("en-US", {
                timeZone: event!.timezone,
                hour: "numeric",
                hourCycle: "h23",
              }).format(new Date(t)),
            );
            if (
              localHour < (event!.dailyStartHour ?? 8) ||
              !withinDailyHours(
                new Date(t).toISOString(),
                event!.timezone,
                event!.dailyStartHour ?? 8,
                event!.dailyEndHour ?? 21,
                interval,
              )
            )
              continue;
            if (
              (event!.blackouts ?? []).some(
                (b: any) =>
                  t < Date.parse(b.end) &&
                  t + interval * 60000 > Date.parse(b.start),
              )
            )
              continue;
            for (const courtId of availableCourts) {
              if (courtBlocked(courtBlocks, courtId, t, t + event!.duration * 60000))
                continue;
              const proposed = {
                ...m,
                courtId,
                scheduledAt: new Date(t).toISOString(),
              };
              if (
                !scheduled.some((x) => scheduleConflict(proposed, x, interval))
              ) {
                edit("matches", m, proposed);
                scheduled.push(proposed);
                placed = true;
                break;
              }
            }
          }
          if (!placed)
            fail("Not enough available court time; expand dates or add courts");
          for (const p of [m.p1, m.p2].filter(Boolean) as string[])
            notify(p, "Match scheduled", event!.name, "match-scheduled");
        }
        break;
      }
      case "rescheduleMatch": {
        requireAdmin();
        requiredReason(data);
        const m = find("matches", data.matchId) as Match;
        if (m.status === "Final" || m.status === "Bye")
          fail("Completed matches cannot be rescheduled");
        const proposed = {
          ...m,
          courtId: z
            .enum(event!.courtIds as [string, ...string[]])
            .parse(data.courtId),
          scheduledAt: z.string().datetime().parse(data.scheduledAt),
        };
        const t = Date.parse(proposed.scheduledAt);
        if (
          !withinDailyHours(
            proposed.scheduledAt,
            event!.timezone,
            event!.dailyStartHour ?? 8,
            event!.dailyEndHour ?? 21,
            event!.duration + event!.buffer,
          )
        )
          fail("Outside daily playing hours");
        if (
          t < Date.parse(event!.startDate) ||
          t + event!.duration * 60000 > Date.parse(event!.endDate)
        )
          fail("Outside event dates");
        if (
          (event!.blackouts ?? []).some(
            (b: any) =>
              t < Date.parse(b.end) &&
              t + (event!.duration + event!.buffer) * 60000 >
                Date.parse(b.start),
          )
        )
          fail("Court blackout");
        if (
          courtBlocked(courtBlocks, proposed.courtId, t, t + event!.duration * 60000)
        )
          fail("Court blocked for maintenance");
        if (
          list("matches").some(
            (other) =>
              other.id !== m.id &&
              scheduleConflict(
                proposed,
                other,
                event!.duration + event!.buffer,
              ),
          )
        )
          fail("Court or player conflict");
        for (const previous of list("matches").filter((x) => x.nextId === m.id))
          if (
            !previous.scheduledAt ||
            Date.parse(previous.scheduledAt) +
              (event!.duration + event!.buffer) * 60000 >
              t
          )
            fail("Preceding round not finished");
        if (m.nextId) {
          const next = find("matches", m.nextId);
          if (
            next.scheduledAt &&
            t + (event!.duration + event!.buffer) * 60000 >
              Date.parse(next.scheduledAt)
          )
            fail("Next round starts too early");
        }
        edit("matches", m, proposed);
        for (const p of [m.p1, m.p2].filter(Boolean) as string[])
          notify(
            p,
            "Schedule changed",
            `${event!.name}: your court time changed.`,
            "match-changed",
          );
        break;
      }
      case "checkInPlayer": {
        requireAdmin();
        const r = regFor(data.registrationId);
        if (r.state !== "Approved") fail("Approved registration required");
        edit("registrations", r, {
          checkIn: z
            .enum(["Not Checked In", "Checked In", "No Show", "Withdrawn"])
            .parse(data.status),
        });
        break;
      }
      case "submitScore": {
        const match = find("matches", data.matchId) as Match;
        if (!manager && ![match.p1, match.p2].includes(uid))
          fail("Participant or administrator required", "permission-denied");
        if (!match.p1 || !match.p2 || match.status === "Bye")
          fail("Both participants required");
        if (match.status === "Final")
          fail("Request a correction before resubmitting");
        if (data.version !== match.version) fail("Stale match version");
        if (
          list("matchResults").some(
            (r) => r.matchId === match.id && r.state === "Submitted",
          )
        )
          fail("Score already awaiting confirmation");
        const score = scoreSchema.parse(data.score);
        validateScore(
          score,
          match.p1!,
          match.p2!,
          getDivision(match.divisionId).scoring,
        );
        const res = make("matchResults", {
          matchId: match.id,
          drawId: match.drawId,
          published: !!find("draws", match.drawId).published,
          divisionId: match.divisionId,
          score,
          state: "Submitted",
          baseVersion: match.version,
          version: match.version + 1,
          submittedBy: uid,
          participants: [match.p1, match.p2],
          reportingStatus: "Not Required",
        });
        edit("matches", match, { status: "Awaiting confirmation" });
        for (const p of [match.p1!, match.p2!])
          if (p !== uid)
            notify(p, "Score submitted", event!.name, "score-submitted");
        if (manager && data.finalize) finalize(match, res);
        result = { resultId: res.id };
        break;
      }
      case "finalizeScore": {
        const res = find("matchResults", data.resultId),
          match = find("matches", res.matchId) as Match;
        if (
          !manager &&
          (![match.p1, match.p2].includes(uid) || res.submittedBy === uid)
        )
          fail("Opponent or admin must confirm", "permission-denied");
        if (res.state !== "Submitted")
          fail("Score is not awaiting confirmation");
        if (res.correctionRequested)
          fail("Resolve the correction request before finalizing");
        finalize(match, res);
        break;
      }
      case "requestScoreCorrection": {
        const res = find("matchResults", data.resultId),
          match = find("matches", res.matchId) as Match;
        if (!manager && ![match.p1, match.p2].includes(uid))
          fail("Participant required", "permission-denied");
        requiredReason(data);
        if (res.state === "Superseded") fail("Already superseded");
        edit("matchResults", res, {
          correctionRequested: true,
          correctionReason: data.reason,
        });
        for (const p of event!.assignedAdmins)
          notify(
            p,
            "Score correction requested",
            event!.name,
            "score-correction",
          );
        break;
      }
      case "updateRoundRobinStandings": {
        requireAdmin();
        updateStandings(getDivision(data.divisionId));
        break;
      }
      case "exportEventReport": {
        requireAdmin();
        const kind = z
          .enum(["registrations", "results", "payments"])
          .parse(data.kind);
        let rows: Record<string, unknown>[] = [];
        if (kind === "registrations")
          rows = list("registrations").map((r) => ({
            name: r.displayName,
            playerId: r.playerId,
            division: r.divisionId,
            status: r.state,
            seed: r.seed,
            checkIn: r.checkIn,
          }));
        if (kind === "payments")
          rows = list("payments").map((p) => ({
            paymentId: p.id,
            playerId: p.playerId,
            amount: p.amount,
            currency: p.currency,
            status: p.state,
            refundRequested: !!p.refundRequested,
          }));
        if (kind === "results")
          rows = list("matchResults")
            .filter((r) => r.state === "Final")
            .map((r) => ({
              matchId: r.matchId,
              winner: r.score.winner,
              score: r.score.sets.map((s: any) => `${s.a}-${s.b}`).join(" "),
              version: r.version,
              reportingStatus: r.reportingStatus,
            }));
        result = { csv: csv(rows), filename: `${eventId}-${kind}.csv` };
        break;
      }
      case "applyAdminOverride": {
        requireAdmin();
        requiredReason(data);
        const kind = z
          .enum([
            "status",
            "score",
            "standings",
            "rating",
            "reporting",
            "refund",
          ])
          .parse(data.kind);
        if (kind === "status") {
          if (
            event!.competition === "ladder" &&
            !["Cancelled", "Registration Open", "Registration Closed"].includes(
              data.status,
            )
          )
            fail("Use ladder season controls for lifecycle changes");
          const status = z
            .enum([
              "Registration Open",
              "Registration Closed",
              "Check-In",
              "In Progress",
              "Completed",
              "Cancelled",
            ])
            .parse(data.status);
          if (
            isTeamCompetition(event!) &&
            status === "Completed" &&
            !event!.championTeamId
          )
            fail("Complete the TRIACE final to declare the champion");
          if (
            status === "Completed" &&
            list("matches").some((m) => !["Final", "Bye"].includes(m.status))
          )
            fail("All matches must be final");
          if (
            status === "Registration Open" &&
            serverNow() > Date.parse(event!.registrationClose)
          )
            fail("Update registration deadline first");
          edit("events", event!, { status });
          if (["Cancelled", "Registration Closed"].includes(status)) {
            for (const reg of list("registrations").filter(
              (r) => active.includes(r.state) || r.state === "Waitlisted",
            )) {
              if (status === "Cancelled") {
                edit("registrations", reg, { state: "Cancelled" });
                for (const p of list("payments").filter(
                  (p) => p.registrationId === reg.id && p.state === "Paid",
                ))
                  edit("payments", p, {
                    refundRequested: true,
                    refundReason: data.reason,
                  });
              }
              notify(
                reg.playerId,
                `Event ${status.toLowerCase()}`,
                event!.name,
                "event-updated",
              );
            }
          }
        }
        if (kind === "score") {
          const res = find("matchResults", data.resultId),
            match = find("matches", res.matchId) as Match;
          if (
            match.group !== undefined &&
            list("draws").some(
              (d) =>
                d.divisionId === match.divisionId && d.phase === "playoffs",
            )
          )
            fail("Group qualification is locked after playoffs are created");
          if (!res.correctionRequested) fail("Correction request required");
          if (match.nextId) {
            const next = find("matches", match.nextId);
            if (next.version > 0 || next.status === "Awaiting confirmation")
              fail("Downstream score must be resolved first");
          }
          edit("matchResults", res, {
            state: "Superseded",
            correctionResolvedBy: uid,
          });
          edit("matches", match, { status: "Scheduled", winner: null });
          if (match.nextId)
            edit("matches", find("matches", match.nextId), {
              [match.nextSlot!]: null,
            });
        }
        if (kind === "standings") {
          const draw = find("draws", data.drawId);
          if (list("draws").some((d) => d.phase === "playoffs"))
            fail("Playoffs already generated");
          const resolutions = z
            .record(z.number().int().positive())
            .parse(data.resolutions);
          if (
            Object.keys(resolutions).some((p) => !draw.players.includes(p)) ||
            new Set(Object.values(resolutions)).size !==
              Object.values(resolutions).length
          )
            fail("Unique placements for draw participants required");
          edit("draws", draw, { resolutions });
          updateStandings(getDivision(draw.divisionId));
        }
        if (kind === "rating") {
          requireClub();
          const playerId = idSchema.parse(data.playerId);
          const snap = await tx.get(db.doc(`users/${playerId}`));
          if (!snap.exists) fail("Player not found");
          edit("users", { id: playerId, ...snap.data() } as Entity, {
            externalRating: z.number().min(0).max(20).parse(data.rating),
            ratingSource: "Admin verified",
            ratingVerifiedAt: now,
          });
        }
        if (kind === "reporting") {
          const res = find("matchResults", data.resultId);
          edit("matchResults", res, {
            reportingStatus: z
              .enum(["Not Required", "Pending", "Submitted", "Confirmed"])
              .parse(data.status),
          });
        }
        if (kind === "refund") {
          const payment = find("payments", data.paymentId);
          if (payment.provider !== "development")
            fail("Stripe refunds use refundPayment");
          if (payment.state !== "Paid" || !payment.refundRequested)
            fail("Withdraw or cancel the registration before refunding");
          edit("payments", payment, {
            state: "Refunded",
            refundReason: data.reason,
            refundedAt: now,
          });
          edit("registrations", regFor(payment.registrationId), {
            state: "Refunded",
          });
          promote();
        }
        break;
      }
      case "expireReservations": {
        if (!system) fail("Scheduled task only", "permission-denied");
        for (const reg of list("registrations").filter(
          (r) =>
            r.state === "Pending Payment" && r.paymentExpiresAt < serverNow(),
        )) {
          edit("registrations", reg, {
            state: "Cancelled",
            reason: "Payment reservation expired",
          });
          notify(
            reg.playerId,
            "Payment reservation expired",
            event!.name,
            "payment-required",
          );
        }
        promote();
        break;
      }
      default:
        fail("Unsupported operation", "invalid-argument");
    }
    if (
      [...updates.keys()].some((path) => path.startsWith("registrations/")) &&
      event
    ) {
      const current = (updates.get(`events/${eventId}`) ?? event) as Entity;
      if (isTeamCompetition(event))
        for (const r of list("registrations").filter(
          (r) =>
            r.teamId &&
            ["Withdrawn", "Rejected", "Refunded", "Cancelled"].includes(
              r.state,
            ),
        )) {
          const t = list("teams").find((t) => t.id === r.teamId);
          if (t && !t.withdrawn) edit("teams", t, { withdrawn: true });
        }
      put("events", {
        ...current,
        registeredCount: list("registrations").filter((r) =>
          active.includes(r.state),
        ).length,
        waitlistCount: list("registrations").filter(
          (r) => r.state === "Waitlisted",
        ).length,
        updatedAt: now,
      });
      for (const division of list("divisions"))
        put("divisions", {
          ...division,
          registeredCount: list("registrations").filter(
            (r) => r.divisionId === division.id && active.includes(r.state),
          ).length,
          waitlistCount: list("registrations").filter(
            (r) => r.divisionId === division.id && r.state === "Waitlisted",
          ).length,
          updatedAt: now,
        });
    }
    if (updates.size > 400) fail("Operation too large; reduce event capacity");
    for (const [path, entity] of updates) {
      if (entity === null) tx.delete(db.doc(path));
      else tx.set(db.doc(path), stripUndefined(entity));
    }
    auditAfter = JSON.parse(
      JSON.stringify(
        [...updates].map(([path, value]) => ({ path, value })),
        (key, value) => (key === "token" ? "[redacted]" : value),
      ),
    );
    const auditId = randomUUID();
    tx.create(
      db.doc(`auditEvents/${auditId}`),
      stripUndefined({
        id: auditId,
        clubId: "pprc",
        eventId,
        actor: uid,
        action: ["triace", "teamCompetition", "ladder"].includes(operation)
          ? `${event?.competition}.${data.action}`
          : operation,
        entityType: eventId ? "event" : "club",
        entityId: eventId || uid,
        before: auditBefore,
        after: auditAfter,
        reason: data.reason ?? null,
        createdAt: now,
        updatedAt: now,
        createdBy: uid,
        requestId: data.requestId,
      }),
    );
    tx.create(receipt, { hash: requestHash, result, createdAt: now });
    return result;
  });
}
function stripUndefined(value: any): any {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v));
  if (value && typeof value === "object" && value.constructor === Object)
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)]),
    );
  return value;
}
export async function assertEventAdmin(
  uid: string,
  eventId: string,
  tx?: Transaction,
) {
  const db = getFirestore();
  const read = (p: string) => (tx ? tx.get(db.doc(p)) : db.doc(p).get());
  const [m, e] = await Promise.all([
    read(`memberships/${uid}`),
    read(`events/${idSchema.parse(eventId)}`),
  ]);
  if (
    !e.exists ||
    e.get("clubId") !== "pprc" ||
    m.data()?.clubId !== "pprc" ||
    !canManage(m.data()?.role, uid, e.data() as Event)
  )
    fail("Administrator required", "permission-denied");
}
