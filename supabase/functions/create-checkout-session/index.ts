import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyToken } from "https://esm.sh/@clerk/backend@1";

const ALLOWED_ORIGINS = new Set(
  (Deno.env.get("ALLOWED_ORIGINS") ??
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173,https://pepesilv.ai,https://www.pepesilv.ai")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function getCorsHeaders(origin: string | null) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function respond(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

const CREDIT_PACKS: Record<string, { amountUsd: number; creditsUsd: number; name: string }> = {
  credits_10: {
    amountUsd: 10,
    creditsUsd: 10,
    name: "Pepe Silv.AI research credits",
  },
};

type ClerkUser = {
  id: string;
  email: string | null;
};

function getClerkAuthorizedParties() {
  return (Deno.env.get("CLERK_AUTHORIZED_PARTIES") ?? "")
    .split(",")
    .map((party) => party.trim())
    .filter(Boolean);
}

function getClaimEmail(claims: Record<string, unknown>) {
  return typeof claims.email === "string"
    ? claims.email
    : typeof claims.email_address === "string"
      ? claims.email_address
      : null;
}

function getPack(raw: unknown) {
  const packId = typeof raw === "string" && raw.trim() ? raw.trim() : "credits_10";
  return {
    packId,
    pack: CREDIT_PACKS[packId] ?? null,
  };
}

function parseBooleanSetting(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function isMockAuthEnabled() {
  return (Deno.env.get("PEPE_AUTH_MODE") ?? "").trim().toLowerCase() === "mock";
}

function isMockPaymentsEnabled() {
  return (Deno.env.get("PEPE_PAYMENTS_MODE") ?? "").trim().toLowerCase() === "mock";
}

async function getAuthenticatedUser(req: Request, body: Record<string, unknown>): Promise<ClerkUser | null> {
  if (isMockAuthEnabled()) {
    const mockUserId =
      typeof body.mock_user_id === "string" && body.mock_user_id.trim()
        ? body.mock_user_id.trim()
        : req.headers.get("x-mock-user-id")?.trim() ?? "";
    if (!mockUserId) return null;
    return {
      id: mockUserId,
      email: typeof body.mock_email === "string" ? body.mock_email : null,
    };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;
  const clerkJwtKey = Deno.env.get("CLERK_JWT_KEY") ?? "";
  const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY") ?? "";
  if (!clerkJwtKey && !clerkSecretKey) {
    throw new Error("Missing Clerk token verification configuration");
  }

  const verifyOptions: any = {
    jwtKey: clerkJwtKey || undefined,
    secretKey: clerkSecretKey || undefined,
  };
  const authorizedParties = getClerkAuthorizedParties();
  if (authorizedParties.length > 0) {
    verifyOptions.authorizedParties = authorizedParties;
  }
  const verifiedToken = await verifyToken(token, verifyOptions);
  const claims = verifiedToken as Record<string, unknown>;
  const userId = typeof claims.sub === "string" ? claims.sub : "";
  if (!userId) return null;
  const email = getClaimEmail(claims);
  return { id: userId, email };
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return respond(origin, 405, { ok: false, error: "Method Not Allowed" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const siteUrl = (Deno.env.get("SITE_URL") ?? Deno.env.get("PUBLIC_SITE_URL") ?? "https://pepesilv.ai").replace(/\/+$/, "");
  if (!supabaseUrl || !serviceRole || (!stripeSecretKey && !isMockPaymentsEnabled())) {
    return respond(origin, 500, { ok: false, error: "Missing checkout configuration" });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const user = await getAuthenticatedUser(req, body);
    if (!user) {
      return respond(origin, 401, { ok: false, error: "Sign in required" });
    }

    const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const featureFlag = await supabase
      .from("site_feature_flags")
      .select("enabled")
      .eq("key", "investigation_credits")
      .maybeSingle();
    if (featureFlag.error) {
      return respond(origin, 500, { ok: false, error: featureFlag.error.message });
    }
    if (!parseBooleanSetting(featureFlag.data?.enabled, false)) {
      return respond(origin, 403, { ok: false, error: "Credit purchases are not enabled" });
    }

    const { packId, pack } = getPack(body.pack_id);
    if (!pack) {
      return respond(origin, 400, { ok: false, error: "Unknown credit pack" });
    }
    const amountUsd = pack.amountUsd;
    const creditsUsd = pack.creditsUsd;
    const cents = Math.round(amountUsd * 100);
    if (isMockPaymentsEnabled()) {
      const mockSessionId = `cs_mock_${crypto.randomUUID()}`;
      await supabase.from("credit_accounts").upsert({
        user_id: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      await supabase.from("stripe_checkout_sessions").insert({
        user_id: user.id,
        stripe_session_id: mockSessionId,
        amount_usd: amountUsd,
        credits_usd: creditsUsd,
        status: "paid",
        metadata: {
          checkout_url: `${siteUrl}/?credits=success&mock_session_id=${encodeURIComponent(mockSessionId)}`,
          pack_id: packId,
          mock: true,
        },
      });
      await supabase.from("credit_ledger").insert({
        user_id: user.id,
        amount_usd: creditsUsd,
        entry_type: "purchase",
        stripe_session_id: mockSessionId,
        metadata: {
          pack_id: packId,
          mock: true,
        },
      });
      return respond(origin, 200, {
        ok: true,
        checkout_url: `${siteUrl}/?credits=success&mock_session_id=${encodeURIComponent(mockSessionId)}`,
        stripe_session_id: mockSessionId,
        mock: true,
        credits_usd: creditsUsd,
      });
    }

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", `${siteUrl}/?credits=success`);
    form.set("cancel_url", `${siteUrl}/?credits=cancelled`);
    if (user.email) {
      form.set("customer_email", user.email);
    }
    form.set("client_reference_id", user.id);
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(cents));
    form.set("line_items[0][price_data][product_data][name]", pack.name);
    form.set("metadata[clerk_user_id]", user.id);
    form.set("metadata[user_id]", user.id);
    form.set("metadata[pack_id]", packId);
    form.set("metadata[credits_usd]", creditsUsd.toFixed(2));

    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const stripeJson = await stripeRes.json();
    if (!stripeRes.ok) {
      return respond(origin, 500, {
        ok: false,
        error: "Stripe checkout session failed",
        details: stripeJson,
      });
    }

    await supabase.from("stripe_checkout_sessions").insert({
      user_id: user.id,
      stripe_session_id: stripeJson.id,
      amount_usd: amountUsd,
      credits_usd: creditsUsd,
      status: "created",
      metadata: {
        checkout_url: stripeJson.url,
        pack_id: packId,
      },
    });

    return respond(origin, 200, {
      ok: true,
      checkout_url: stripeJson.url,
      stripe_session_id: stripeJson.id,
    });
  } catch (error) {
    return respond(origin, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
