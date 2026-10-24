import Stripe from "stripe";
import { getFirestore } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import { execute } from "./engine.js";
export function verifyStripeWebhook(
  raw: Buffer | string,
  signature: string,
  signingSecret: string,
) {
  if (!signingSecret || !signature)
    throw Error("Webhook signature configuration required");
  const event = Stripe.webhooks.constructEvent(raw, signature, signingSecret);
  if (event.livemode)
    throw Error("Live charges are disabled; use Stripe test mode");
  return event;
}
function receiptId(input: string) {
  const h = createHash("sha256").update(input).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function reconcileStripeCheckout(event: Stripe.Event) {
  if (event.livemode) throw Error("Live charges are disabled");
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ].includes(event.type)
  )
    return;
  const session = event.data.object as Stripe.Checkout.Session,
    m = session.metadata;
  if (
    !m ||
    !/^[\w-]+$/.test(m.paymentId ?? "") ||
    !/^[\w-]+$/.test(m.uid ?? "") ||
    !/^[\w-]+$/.test(m.eventId ?? "")
  )
    throw Error("Invalid payment metadata");
  const p = await getFirestore().doc(`payments/${m.paymentId}`).get();
  if (
    !p.exists ||
    p.get("provider") !== "stripe" ||
    p.get("stripeSessionId") !== session.id ||
    p.get("playerId") !== m.uid ||
    p.get("eventId") !== m.eventId
  )
    throw Error("Session binding mismatch");
  if (
    [
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ].includes(event.type)
  ) {
    await execute(
      "recordStripeFailure",
      m.uid,
      {
        eventId: m.eventId,
        paymentId: m.paymentId,
        reason: event.type,
        requestId: receiptId(event.id),
      },
      true,
    );
    return;
  }
  if (session.payment_status !== "paid") return;
  if (
    session.currency !== p.get("currency") ||
    session.currency !== "usd" ||
    session.amount_total !== p.get("amount")
  )
    throw Error("Payment amount/currency mismatch");
  await execute(
    "recordStripePayment",
    m.uid,
    {
      eventId: m.eventId,
      paymentId: m.paymentId,
      amount: session.amount_total,
      providerReference:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id,
      requestId: receiptId(event.id),
    },
    true,
  );
}
