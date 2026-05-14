import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a[i] ^ b[i];
  }
  return out === 0;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyStripeSignature(rawBody: string, signatureHeader: string | null, webhookSecret: string) {
  if (!signatureHeader || !webhookSecret) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=", 2);
      return [key, value];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const expectedHex = await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`);
  return timingSafeEqual(hexToBytes(expectedHex), hexToBytes(signature));
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
  if (!supabaseUrl || !serviceRole || !webhookSecret) {
    return new Response(JSON.stringify({ ok: false, error: "Missing webhook configuration" }), { status: 500 });
  }

  const rawBody = await req.text();
  const signatureOk = await verifyStripeSignature(rawBody, req.headers.get("stripe-signature"), webhookSecret);
  if (!signatureOk) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid Stripe signature" }), { status: 400 });
  }

  const event = JSON.parse(rawBody);
  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const session = event.data?.object ?? {};
  const userId =
    typeof session.metadata?.clerk_user_id === "string"
      ? session.metadata.clerk_user_id
      : typeof session.metadata?.user_id === "string"
        ? session.metadata.user_id
        : null;
  const creditsUsd = Number(session.metadata?.credits_usd ?? 0);
  const packId = typeof session.metadata?.pack_id === "string" ? session.metadata.pack_id : null;
  const sessionId = typeof session.id === "string" ? session.id : null;
  if (!userId || !sessionId || !Number.isFinite(creditsUsd) || creditsUsd <= 0) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid checkout session metadata" }), { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const existing = await supabase
    .from("stripe_checkout_sessions")
    .select("stripe_session_id, status")
    .eq("stripe_session_id", sessionId)
    .maybeSingle();
  if (existing.error) {
    return new Response(JSON.stringify({ ok: false, error: existing.error.message }), { status: 500 });
  }

  if (existing.data?.status !== "paid") {
    await supabase.from("credit_accounts").upsert({
      user_id: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    await supabase.from("stripe_checkout_sessions").upsert({
      user_id: userId,
      stripe_session_id: sessionId,
      amount_usd: creditsUsd,
      credits_usd: creditsUsd,
      status: "paid",
      metadata: session,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stripe_session_id" });

    const ledger = await supabase.from("credit_ledger").insert({
      user_id: userId,
      amount_usd: creditsUsd,
      entry_type: "purchase",
      stripe_session_id: sessionId,
      metadata: {
        stripe_event_id: event.id,
        pack_id: packId,
      },
    });
    if (ledger.error && ledger.error.code !== "23505") {
      return new Response(JSON.stringify({ ok: false, error: ledger.error.message }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
});
