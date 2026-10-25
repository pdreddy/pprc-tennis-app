import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";
import Stripe from "stripe";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { execute, assertEventAdmin, requiredReason } from "./engine.js";
import { verifyStripeWebhook, reconcileStripeCheckout } from "./payments.js";
import { runEventMaintenance } from "./maintenance.js";
import { getMyPerformance as ownPerformance } from "./players.js";
initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });
const inEmulator = process.env.FUNCTIONS_EMULATOR === "true";
const stripeKey = defineSecret("STRIPE_SECRET_KEY");
const webhookKey = defineSecret("STRIPE_WEBHOOK_SECRET");
function callable(name: string, handler: typeof execute = execute) {
  return onCall({ cors: true }, async (request) => {
    if (!request.auth)
      throw new HttpsError("unauthenticated", "Sign in required");
    try {
      return await handler(name, request.auth.uid, request.data);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof ZodError)
        throw new HttpsError(
          "invalid-argument",
          error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        );
      throw new HttpsError(
        "failed-precondition",
        error instanceof Error ? error.message : "Operation failed",
      );
    }
  });
}
export const createEvent = callable("createEvent");
export const updateEvent = callable("updateEvent");
export const publishEvent = callable("publishEvent");
export const registerForDivision = callable("registerForDivision");
export const cancelRegistration = callable("cancelRegistration");
export const promoteWaitlist = callable("promoteWaitlist");
export const confirmDevelopmentPayment = callable("confirmDevelopmentPayment");
export const approveRegistration = callable("approveRegistration");
export const rejectRegistration = callable("rejectRegistration");
export const generateDraw = callable("generateDraw");
export const publishDraw = callable("publishDraw");
export const generateSchedule = callable("generateSchedule");
export const rescheduleMatch = callable("rescheduleMatch");
export const checkInPlayer = callable("checkInPlayer");
export const submitScore = callable("submitScore");
export const requestScoreCorrection = callable("requestScoreCorrection");
export const finalizeScore = callable("finalizeScore");
export const updateRoundRobinStandings = callable("updateRoundRobinStandings");
export const exportEventReport = callable("exportEventReport");
export const createEventTemplate = callable("createEventTemplate");
export const applyAdminOverride = callable("applyAdminOverride");
export const saveProfile = callable("saveProfile");
export const saveAvailability = callable("saveAvailability");
export const requestAccountDeletion = callable("requestAccountDeletion");
export const manageClub = callable("manageClub");
export const registerPushToken = callable("registerPushToken");
export const triace = callable("triace");
export const teamCompetition = callable("teamCompetition");
export const ladder = callable("ladder");
export const getMyPerformance = callable(
  "getMyPerformance",
  (_operation, uid, data) => ownPerformance(uid, data),
);
export const requestClubMembership = callable("requestClubMembership");
export const reviewClubMembership = callable("reviewClubMembership");
export const withdrawClubMembershipRequest = callable(
  "withdrawClubMembershipRequest",
);
interface PaymentProvider {
  checkout(input: {
    paymentId: string;
    eventId: string;
    registrationId: string;
    amount: number;
    uid: string;
    requestId: string;
  }): Promise<{ url?: string; development: boolean; paymentId: string }>;
}
class DevelopmentPayments implements PaymentProvider {
  async checkout(input: { paymentId: string }) {
    return { development: true, paymentId: input.paymentId };
  }
}
class StripePayments implements PaymentProvider {
  constructor(private stripe: Stripe) {}
  async checkout(input: {
    paymentId: string;
    eventId: string;
    registrationId: string;
    amount: number;
    uid: string;
    requestId: string;
  }) {
    const origin = process.env.APP_ORIGIN;
    if (!origin?.startsWith("https://"))
      throw new HttpsError("failed-precondition", "Configure HTTPS APP_ORIGIN");
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: input.uid,
        metadata: {
          paymentId: input.paymentId,
          eventId: input.eventId,
          uid: input.uid,
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: input.amount,
              product_data: { name: "PPRC event registration" },
            },
          },
        ],
        success_url: `${origin}/my-events?payment=success`,
        cancel_url: `${origin}/my-events?payment=cancelled`,
      },
      { idempotencyKey: input.paymentId },
    );
    await getFirestore().doc(`payments/${input.paymentId}`).update({
      stripeSessionId: session.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return {
      url: session.url!,
      development: false,
      paymentId: input.paymentId,
    };
  }
}
export const startCheckout = onCall(
  { cors: true, secrets: inEmulator ? [] : [stripeKey] },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const payment = await execute("reserveCheckout", req.auth.uid, req.data);
    const provider: PaymentProvider =
      process.env.FUNCTIONS_EMULATOR === "true"
        ? new DevelopmentPayments()
        : new StripePayments(new Stripe(testStripeKey()));
    return provider.checkout({
      ...payment,
      uid: req.auth.uid,
      requestId: req.data.requestId,
    });
  },
);
export const stripeWebhook = onRequest(
  { secrets: inEmulator ? [] : [webhookKey] },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("POST required");
      return;
    }
    let event: Stripe.Event;
    try {
      event = verifyStripeWebhook(
        req.rawBody,
        req.headers["stripe-signature"] as string,
        webhookKey.value(),
      );
    } catch {
      res.status(400).send("Invalid signature");
      return;
    }
    try {
      await reconcileStripeCheckout(event);
      res.status(200).send("ok");
    } catch (error) {
      console.error("Stripe event needs retry", event.id, error);
      res.status(500).send("Payment reconciliation required");
    }
  },
);
export const refundPayment = onCall(
  { secrets: inEmulator ? [] : [stripeKey] },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required");
    const data = z
      .object({
        requestId: z.string().uuid(),
        eventId: z.string(),
        paymentId: z.string().regex(/^[\w-]+$/),
        reason: z.string().min(5).max(1000),
      })
      .parse(req.data);
    requiredReason(data);
    await assertEventAdmin(req.auth.uid, data.eventId);
    const db = getFirestore(),
      ref = db.doc(`payments/${data.paymentId}`);
    const snap = await ref.get();
    if (snap.get("eventId") !== data.eventId)
      throw new HttpsError("permission-denied", "Wrong event");
    if (snap.get("provider") === "development")
      return execute("applyAdminOverride", req.auth.uid, {
        ...data,
        kind: "refund",
      });
    if (snap.get("state") === "Refunded") return { status: "Refunded" };
    if (
      !["Paid", "Refund Required"].includes(snap.get("state")) ||
      !snap.get("refundRequested") ||
      !snap.get("providerReference")
    )
      throw new HttpsError(
        "failed-precondition",
        "Paid Stripe payment required",
      );
    const refund = await new Stripe(testStripeKey()).refunds.create(
      {
        payment_intent: snap.get("providerReference"),
        metadata: { reason: data.reason },
      },
      { idempotencyKey: `refund-${data.paymentId}` },
    );
    if (refund.status !== "succeeded")
      throw new HttpsError(
        "failed-precondition",
        "Refund pending; retry reconciliation",
      );
    await db.runTransaction(async (tx) => {
      const current = await tx.get(ref);
      if (current.get("state") === "Refunded") return;
      tx.update(ref, {
        state: "Refunded",
        refundId: refund.id,
        refundReason: data.reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(db.doc(`registrations/${current.get("registrationId")}`), {
        state: "Refunded",
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.create(db.collection("auditEvents").doc(), {
        actor: req.auth!.uid,
        action: "refundPayment",
        eventId: data.eventId,
        clubId: "pprc",
        entityType: "payment",
        entityId: data.paymentId,
        before: { state: "Paid" },
        after: { state: "Refunded", refundId: refund.id },
        reason: data.reason,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: req.auth!.uid,
      });
    });
    await execute("promoteWaitlist", req.auth.uid, {
      eventId: data.eventId,
      requestId: randomUUID(),
    });
    return { status: "Refunded" };
  },
);
export const eventMaintenance = onSchedule(
  "every 5 minutes",
  runEventMaintenance,
);
export const deliverPush = onDocumentCreated(
  "notifications/{notificationId}",
  async (event) => {
    if (process.env.FUNCTIONS_EMULATOR === "true") return;
    const n = event.data?.data();
    if (!n) return;
    const db = getFirestore();
    const user = await db.doc(`users/${n.playerId}`).get();
    if (!user.get("notificationPreferences.push")) return;
    const tokens = await db
      .collection("pushTokens")
      .where("playerId", "==", n.playerId)
      .get();
    for (const doc of tokens.docs) {
      try {
        await getMessaging().send({
          token: doc.get("token"),
          notification: { title: n.title, body: n.body },
          webpush: {
            fcmOptions: { link: `${process.env.APP_ORIGIN}/notifications` },
          },
        });
      } catch (e) {
        console.error("Push delivery failed", doc.id, e);
      }
    }
  },
);
function testStripeKey() {
  const key = stripeKey.value();
  if (!key.startsWith("sk_test_"))
    throw new HttpsError(
      "failed-precondition",
      "Stripe test-mode key required; live charges are disabled",
    );
  return key;
}
