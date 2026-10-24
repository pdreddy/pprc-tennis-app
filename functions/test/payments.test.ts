import { beforeAll, afterAll, it, expect } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { execute } from "../src/engine";
import { verifyStripeWebhook, reconcileStripeCheckout } from "../src/payments";
const app = initializeApp({ projectId: "demo-pprc-events" }),
  db = getFirestore(),
  secret = "whsec_synthetic_emulator_signature_only";
const req = (x: any = {}) => ({ requestId: randomUUID(), ...x });
let eid: string, a: any, b: any, c: any;
function signed(
  session: any,
  type = "checkout.session.completed",
  eventId = `evt_${randomUUID()}`,
) {
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    api_version: "2025-05-28.basil",
    type,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: session },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
  return verifyStripeWebhook(payload, signature, secret);
}
const session = (payment: any, uid: string, changes: any = {}) => ({
  id: `cs_test_${uid}`,
  object: "checkout.session",
  payment_status: "paid",
  currency: "usd",
  amount_total: 500,
  payment_intent: `pi_test_${uid}`,
  metadata: { eventId: eid, paymentId: payment.paymentId, uid },
  ...changes,
});
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw Error("Use demo emulators only");
  process.env.FUNCTIONS_EMULATOR = "true";
  for (const uid of [
    "payments-admin",
    "payments-a",
    "payments-b",
    "payments-c",
  ]) {
    await db
      .doc(`memberships/${uid}`)
      .set({
        clubId: "pprc",
        role: uid === "payments-admin" ? "clubAdmin" : "player",
        member: true,
      });
    await db
      .doc(`users/${uid}`)
      .set({ id: uid, clubId: "pprc", displayName: uid });
  }
  const event = {
    name: "Synthetic payment integration",
    description: "No external charges",
    venue: "PPRC",
    location: "Prosper",
    startDate: new Date(Date.now() + 86400000).toISOString(),
    endDate: new Date(Date.now() + 2 * 86400000).toISOString(),
    registrationOpen: new Date(Date.now() - 60000).toISOString(),
    registrationClose: new Date(Date.now() + 3600000).toISOString(),
    timezone: "America/Chicago",
    visibility: "public",
    fee: 500,
    capacity: 2,
    waitlist: true,
    waiverRequired: false,
    refundPolicy: "Synthetic full refund",
    organizer: "PPRC",
    questions: [],
    courtIds: [],
    assignedAdmins: ["payments-admin"],
  };
  eid = (
    await execute(
      "createEvent",
      "payments-admin",
      req({
        event,
        divisions: [
          { name: "Open", capacity: 2, format: "single-elimination" },
        ],
      }),
    )
  ).eventId;
  await execute("publishEvent", "payments-admin", req({ eventId: eid }));
  const register = async (uid: string) =>
    execute(
      "registerForDivision",
      uid,
      req({ eventId: eid, divisionId: `${eid}-d1`, waiver: true }),
    );
  a = await register("payments-a");
  b = await register("payments-b");
  c = await register("payments-c");
  a = {
    ...a,
    ...(await execute(
      "reserveCheckout",
      "payments-a",
      req({ eventId: eid, registrationId: a.registrationId }),
    )),
  };
  b = {
    ...b,
    ...(await execute(
      "reserveCheckout",
      "payments-b",
      req({ eventId: eid, registrationId: b.registrationId }),
    )),
  };
  for (const [p, uid] of [
    [a, "payments-a"],
    [b, "payments-b"],
  ])
    await db
      .doc(`payments/${p.paymentId}`)
      .update({ provider: "stripe", stripeSessionId: `cs_test_${uid}` });
}, 60000);
afterAll(async () => {
  await db.terminate();
  await deleteApp(app);
});
it("uses the real Stripe signature verifier and rejects altered, stale and live payloads", () => {
  const payload = JSON.stringify({
      id: "evt_synthetic",
      livemode: false,
      type: "ignored",
      data: { object: {} },
    }),
    signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  expect(verifyStripeWebhook(payload, signature, secret).id).toBe(
    "evt_synthetic",
  );
  expect(() => verifyStripeWebhook(payload + " ", signature, secret)).toThrow();
  expect(() =>
    verifyStripeWebhook(
      payload,
      Stripe.webhooks.generateTestHeaderString({
        payload,
        secret,
        timestamp: Math.floor(Date.now() / 1000) - 600,
      }),
      secret,
    ),
  ).toThrow();
  const live = JSON.stringify({
    id: "evt_live",
    livemode: true,
    type: "ignored",
    data: { object: {} },
  });
  expect(() =>
    verifyStripeWebhook(
      live,
      Stripe.webhooks.generateTestHeaderString({ payload: live, secret }),
      secret,
    ),
  ).toThrow("Live");
});
it("rejects forged signatures at the running Gen 2 HTTP endpoint", async () => {
  const r = await fetch(
    "http://127.0.0.1:5001/demo-pprc-events/us-central1/stripeWebhook",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "forged",
      },
      body: "{}",
    },
  );
  expect(r.status).toBe(400);
});
it("binds signed payment ownership, session, amount and currency before registration changes", async () => {
  for (const changes of [
    { amount_total: 1 },
    { currency: "eur" },
    { id: "cs_test_wrong" },
    { metadata: { eventId: eid, paymentId: a.paymentId, uid: "payments-b" } },
  ])
    await expect(
      reconcileStripeCheckout(signed(session(a, "payments-a", changes))),
    ).rejects.toThrow();
  expect(
    (await db.doc(`registrations/${a.registrationId}`).get()).get("state"),
  ).toBe("Pending Payment");
});
it("reconciles repeated signed successful deliveries exactly once", async () => {
  const event = signed(session(a, "payments-a"));
  await reconcileStripeCheckout(event);
  await reconcileStripeCheckout(event);
  expect(
    (await db.doc(`registrations/${a.registrationId}`).get()).get("state"),
  ).toBe("Registered");
  const audit = await db
    .collection("auditEvents")
    .where("eventId", "==", eid)
    .where("action", "==", "recordStripePayment")
    .get();
  expect(audit.size).toBe(1);
});
it("handles payment failure, duplicate delivery and waitlist promotion transactionally", async () => {
  const event = signed(
    session(b, "payments-b", { payment_status: "unpaid" }),
    "checkout.session.async_payment_failed",
  );
  await reconcileStripeCheckout(event);
  await reconcileStripeCheckout(event);
  expect((await db.doc(`payments/${b.paymentId}`).get()).get("state")).toBe(
    "Failed",
  );
  expect(
    (await db.doc(`registrations/${b.registrationId}`).get()).get("state"),
  ).toBe("Cancelled");
  expect(
    (await db.doc(`registrations/${c.registrationId}`).get()).get("state"),
  ).toBe("Pending Payment");
});
it("holds late successful payments for refund without taking a promoted player's place", async () => {
  await reconcileStripeCheckout(
    signed(
      session(b, "payments-b"),
      "checkout.session.async_payment_succeeded",
    ),
  );
  expect((await db.doc(`payments/${b.paymentId}`).get()).get("state")).toBe(
    "Refund Required",
  );
  expect(
    (await db.doc(`registrations/${c.registrationId}`).get()).get("state"),
  ).toBe("Pending Payment");
});
it("records emulator-only full refunds with an immutable audit reason", async () => {
  const p = await execute(
    "reserveCheckout",
    "payments-c",
    req({ eventId: eid, registrationId: c.registrationId }),
  );
  await execute(
    "confirmDevelopmentPayment",
    "payments-c",
    req({ eventId: eid, paymentId: p.paymentId }),
  );
  await execute(
    "cancelRegistration",
    "payments-c",
    req({
      eventId: eid,
      registrationId: c.registrationId,
      reason: "Synthetic refund rehearsal",
    }),
  );
  await execute(
    "applyAdminOverride",
    "payments-admin",
    req({
      eventId: eid,
      kind: "refund",
      paymentId: p.paymentId,
      reason: "Approved synthetic full refund",
    }),
  );
  expect((await db.doc(`payments/${p.paymentId}`).get()).get("state")).toBe(
    "Refunded",
  );
});
