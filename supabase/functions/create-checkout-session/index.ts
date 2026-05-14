import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

function parseAmount(raw: unknown) {
  const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : 10;
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(250, Math.max(5, Math.round(parsed * 100) / 100));
}

async function getAuthenticatedUser(req: Request, supabaseUrl: string, serviceRole: string) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user ?? null;
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
  if (!supabaseUrl || !serviceRole || !stripeSecretKey) {
    return respond(origin, 500, { ok: false, error: "Missing checkout configuration" });
  }

  try {
    const user = await getAuthenticatedUser(req, supabaseUrl, serviceRole);
    if (!user) {
      return respond(origin, 401, { ok: false, error: "Sign in required" });
    }

    const body = await req.json().catch(() => ({}));
    const amountUsd = parseAmount(body.amount_usd);
    const cents = Math.round(amountUsd * 100);
    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", `${siteUrl}/?credits=success`);
    form.set("cancel_url", `${siteUrl}/?credits=cancelled`);
    form.set("customer_email", user.email ?? "");
    form.set("client_reference_id", user.id);
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(cents));
    form.set("line_items[0][price_data][product_data][name]", `Pepe Silv.AI research credits`);
    form.set("metadata[user_id]", user.id);
    form.set("metadata[credits_usd]", amountUsd.toFixed(2));

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

    const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    await supabase.from("stripe_checkout_sessions").insert({
      user_id: user.id,
      stripe_session_id: stripeJson.id,
      amount_usd: amountUsd,
      credits_usd: amountUsd,
      status: "created",
      metadata: {
        checkout_url: stripeJson.url,
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
