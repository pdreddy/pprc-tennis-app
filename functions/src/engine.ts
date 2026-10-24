import { randomUUID, createHash } from "node:crypto";
import {
  getFirestore,
  FieldValue,
  type Transaction,
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { executeTriace, triaceCollections } from "./triace.js";
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
  csv,
  type Entity,
  type Event,
  type Division,
  type Match,
  type Role,
  triaceRulesSchema,
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
    const operationLimit =
      operation === "triace"
        ? await tx.get(db.doc(`operationLimits/${uid}`))
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
    ) => make("notifications", { playerId, title, body, type, read: false });
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
      if (event.competition === "triace" && list("teamEncounters").length)
        return;
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
          paymentExpiresAt: Date.now() + 30 * 60000,
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
      event?.competition === "triace" &&
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
      fail("Use the TRIACE team workspace for this operation");
    if (
      ![
        "createEvent",
        "saveProfile",
        "requestAccountDeletion",
        "manageClub",
        "registerPushToken",
        "createEventTemplate",
      ].includes(operation) &&
      !event
    )
      fail("Event not found", "not-found");
    switch (operation) {
      case "triace": {
        const recent =
          Date.now() - (operationLimit?.get("window") ?? 0) < 60000;
        const count = recent ? (operationLimit?.get("count") ?? 0) : 0;
        if (count >= (manager ? 240 : 120))
          fail(
            "Too many team operations; retry in a minute",
            "resource-exhausted",
          );
        make(
          "operationLimits",
          {
            window: recent ? operationLimit!.get("window") : Date.now(),
            count: count + 1,
          },
          uid,
        );
        result = await executeTriace({
          uid,
          role,
          data,
          event: event!,
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
          readCourt: async (courtId) => {
            const s = await tx.get(db.doc(`courts/${idSchema.parse(courtId)}`));
            return s.exists ? ({ id: s.id, ...s.data() } as Entity) : undefined;
          },
        });
        if (data.action === "withdrawTeam") promote();
        break;
      }
      case "saveProfile": {
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
                  Date.parse(v) <= Date.now(),
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
        if (p.visibility === "public")
          put("publicProfiles", {
            id: uid,
            clubId: "pprc",
            displayName: p.displayName,
            city: p.city,
            tennisLevel: p.tennisLevel,
            externalRating: p.externalRating ?? null,
            singlesUtr: p.singlesUtr ?? profile?.singlesUtr ?? null,
            doublesUtr: p.doublesUtr ?? profile?.doublesUtr ?? null,
            updatedAt: now,
            createdAt: now,
          });
        else updates.set(`publicProfiles/${uid}`, null);
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
          .enum(["court", "membership", "template", "rating", "venue", "club"])
          .parse(data.target);
        if (target === "club") {
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
          make(
            "memberships",
            { role: memberRole, member: !!data.member, playerId: id },
            id,
          );
        }
        if (target === "rating") {
          const id = idSchema.parse(data.id);
          const snap = await tx.get(db.doc(`users/${id}`));
          if (!snap.exists) fail("Player not found");
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
          edit("users", current, {
            externalRating: rating,
            singlesUtr,
            doublesUtr,
            ratingSource: "Admin verified",
            ratingVerifiedAt: now,
          });
          if (current.visibility === "public")
            make(
              "publicProfiles",
              {
                displayName: current.displayName,
                city: current.city,
                tennisLevel: current.tennisLevel,
                externalRating: rating,
                singlesUtr,
                doublesUtr,
                ratingSource: "Admin verified",
                ratingVerifiedAt: now,
              },
              id,
            );
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
        if (
          e.competition === "triace" &&
          (divisions.length !== 1 ||
            e.capacity > 16 ||
            divisions[0].capacity > 16)
        )
          fail("TRIACE uses one division and at most 16 teams");
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
        if (patch.competition === "triace") {
          if (patch.capacity > 16) fail("TRIACE capacity is at most 16 teams");
          if (data.event?.triaceRules)
            fail("Change TRIACE rules through the audited team workspace");
          if (
            data.divisions &&
            (data.divisions.length !== 1 || data.divisions[0].capacity > 16)
          )
            fail("TRIACE uses one division and at most 16 teams");
          if (
            list("teams").length &&
            (patch.waiverRequired !== event!.waiverRequired ||
              patch.refundPolicy !== event!.refundPolicy)
          )
            fail("Waiver policy is locked after team creation");
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
        if (!list("divisions").length) fail("At least one division required");
        if (event!.status !== "Draft" && event!.status !== "Published")
          fail("Event already published");
        edit("events", event!, {
          status:
            Date.now() >= Date.parse(event!.registrationOpen) &&
            Date.now() < Date.parse(event!.registrationClose)
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
          Date.now() - window < 60000 ? (rateSnap?.get("count") ?? 0) : 0;
        if (count >= 5)
          fail(
            "Registration limit reached; try again in a minute",
            "resource-exhausted",
          );
        make(
          "registrationLimits",
          { window: count ? window : Date.now(), count: count + 1 },
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
          Date.now() < Date.parse(event!.registrationOpen) ||
          Date.now() > Date.parse(event!.registrationClose)
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
          (r) => r.playerId === uid && r.order > Date.now() - 60000,
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
          order: Date.now(),
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
          paymentExpiresAt: Date.now() + 30 * 60000,
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
        if (reg.teamId && list("teamEncounters").length)
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
        if (reg.paymentExpiresAt < Date.now())
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
          reg.paymentExpiresAt < Date.now()
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
            event!.competition === "triace" &&
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
            Date.now() > Date.parse(event!.registrationClose)
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
            r.state === "Pending Payment" && r.paymentExpiresAt < Date.now(),
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
      if (event.competition === "triace")
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
        action: operation === "triace" ? `triace.${data.action}` : operation,
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
    m.data()?.clubId !== "pprc" ||
    !canManage(m.data()?.role, uid, e.data() as Event)
  )
    fail("Administrator required", "permission-denied");
}
