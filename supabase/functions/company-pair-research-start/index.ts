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
const CHROME_EXTENSION_ID = Deno.env.get("CHROME_EXTENSION_ID") ?? "";
if (CHROME_EXTENSION_ID) {
  ALLOWED_ORIGINS.add(`chrome-extension://${CHROME_EXTENSION_ID}`);
}

type CompanyInput = {
  name: string;
  context: string;
};
type ClerkUser = {
  id: string;
  email: string | null;
};

function getCorsHeaders(origin: string | null) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function respond(origin: string | null, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify({ status, ...body }, null, 2), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeCompany(raw: unknown): CompanyInput | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === "string" ? obj.name.trim() : "";
  const context = typeof obj.context === "string" ? obj.context.trim() : "";
  if (!name) {
    return null;
  }
  return { name, context };
}

function parseMoneySetting(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return fallback;
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

async function safeFetchJson(url: string, init: RequestInit) {
  try {
    const res = await fetch(url, init);
    const bodyText = await res.text();
    let bodyJson = null;
    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      bodyJson = null;
    }
    return { ok: res.ok, status: res.status, bodyText, bodyJson };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      bodyText: error instanceof Error ? error.message : String(error),
      bodyJson: null,
    };
  }
}

function isMockAuthEnabled() {
  return (Deno.env.get("PEPE_AUTH_MODE") ?? "").trim().toLowerCase() === "mock";
}

function getAllowedTesterEmails() {
  return (Deno.env.get("PEPE_ALLOWED_TESTER_EMAILS") ?? "actorjakeparker@gmail.com")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function getClaimEmail(claims: Record<string, unknown>) {
  return typeof claims.email === "string"
    ? claims.email
    : typeof claims.email_address === "string"
      ? claims.email_address
      : null;
}

async function getClerkUserEmail(userId: string) {
  const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY") ?? "";
  if (!clerkSecretKey) return null;

  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      "Authorization": `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return null;

  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  const primaryEmailId = typeof data?.primary_email_address_id === "string" ? data.primary_email_address_id : "";
  const emailAddresses = Array.isArray(data?.email_addresses) ? data.email_addresses : [];
  for (const rawEmail of emailAddresses) {
    if (rawEmail === null || typeof rawEmail !== "object") continue;
    const email = rawEmail as Record<string, unknown>;
    const id = typeof email.id === "string" ? email.id : "";
    const address = typeof email.email_address === "string" ? email.email_address : "";
    if (address && (primaryEmailId === "" || id === primaryEmailId)) return address;
  }
  return null;
}

async function isAllowedTester(user: ClerkUser) {
  if (isMockAuthEnabled()) return true;
  const allowedEmails = getAllowedTesterEmails();
  if (allowedEmails.length === 0) return false;
  const email = (user.email ?? await getClerkUserEmail(user.id) ?? "").trim().toLowerCase();
  return email.length > 0 && allowedEmails.includes(email);
}

async function getAuthenticatedUser(req: Request, body: Record<string, unknown> = {}): Promise<ClerkUser | null> {
  if (isMockAuthEnabled()) {
    const mockUserId =
      typeof body.mock_user_id === "string" && body.mock_user_id.trim()
        ? body.mock_user_id.trim()
        : req.headers.get("x-mock-user-id")?.trim() ?? "";
    return mockUserId ? {
      id: mockUserId,
      email: typeof body.mock_email === "string" ? body.mock_email : null,
    } : null;
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;
  const clerkJwtKey = Deno.env.get("CLERK_JWT_KEY") ?? "";
  const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY") ?? "";
  if (!clerkJwtKey && !clerkSecretKey) {
    throw new Error("Missing Clerk token verification configuration");
  }
  const authorizedParties = (Deno.env.get("CLERK_AUTHORIZED_PARTIES") ?? "")
    .split(",")
    .map((party) => party.trim())
    .filter(Boolean);
  const verifyOptions: any = {
    jwtKey: clerkJwtKey || undefined,
    secretKey: clerkSecretKey || undefined,
  };
  if (authorizedParties.length > 0) {
    verifyOptions.authorizedParties = authorizedParties;
  }
  const verifiedToken = await verifyToken(token, verifyOptions);
  const claims = verifiedToken as Record<string, unknown>;
  const userId = typeof claims.sub === "string" ? claims.sub : "";
  return userId ? { id: userId, email: getClaimEmail(claims) } : null;
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
  const internalEdgeApiKey = Deno.env.get("INTERNAL_EDGE_API_KEY") ?? "";
  if (!supabaseUrl || !serviceRole || !internalEdgeApiKey) {
    return respond(origin, 500, { ok: false, error: "Missing service configuration" });
  }

  try {
    const body = await req.json();
    const user = await getAuthenticatedUser(req, body as Record<string, unknown>);
    if (!user) {
      return respond(origin, 401, { ok: false, error: "Sign in required" });
    }

    const companyA = normalizeCompany(body.company_a);
    const companyB = normalizeCompany(body.company_b);
    if (!companyA || !companyB) {
      return respond(origin, 400, { ok: false, error: "company_a.name and company_b.name are required" });
    }
    if (companyA.name.toLowerCase() === companyB.name.toLowerCase()) {
      return respond(origin, 400, { ok: false, error: "company_a.name and company_b.name must be different" });
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
    const investigationCreditsEnabled = parseBooleanSetting(featureFlag.data?.enabled, false);
    if (investigationCreditsEnabled && !(await isAllowedTester(user))) {
      return respond(origin, 403, { ok: false, error: "under_construction" });
    }

    const requestInsert = await supabase
      .from("company_pair_requests")
      .insert({
        user_id: user.id,
        company_a_name: companyA.name,
        company_a_context: companyA.context,
        company_b_name: companyB.name,
        company_b_context: companyB.context,
        status: "queued",
      })
      .select("*")
      .single();
    if (requestInsert.error || !requestInsert.data) {
      return respond(origin, 500, { ok: false, error: requestInsert.error?.message ?? "Could not create request" });
    }

    const requestRow = requestInsert.data;
    let creditReservationId: string | null = null;
    let reservedAmountUsd = 0;

    if (investigationCreditsEnabled) {
      const fundRes = await supabase.rpc("fund_company_pair_investigation", {
        p_request_id: requestRow.id,
        p_user_id: user.id,
        p_is_starter: true,
      });
      if (fundRes.error) {
        await supabase.from("company_pair_requests").update({
          status: "failed",
          error: fundRes.error.message,
        }).eq("id", requestRow.id);
        return respond(origin, 402, {
          ok: false,
          error: "Could not fund this investigation",
          details: fundRes.error.message,
          request: requestRow,
        });
      }

      const debitRes = await supabase.rpc("debit_company_pair_flat_start_cost", {
        p_request_id: requestRow.id,
      });
      if (debitRes.error) {
        await supabase.from("company_pair_requests").update({
          status: "paused",
          funding_status: "needs_funding",
          needs_funding_at: new Date().toISOString(),
          error: debitRes.error.message,
        }).eq("id", requestRow.id);
        return respond(origin, 402, {
          ok: false,
          error: "Not enough credits to start this investigation",
          details: debitRes.error.message,
          request: requestRow,
        });
      }
    } else {
      const reserveSetting = await supabase
        .from("settings")
        .select("value")
        .eq("key", "company_pair_research_min_reserve_usd")
        .maybeSingle();
      if (reserveSetting.error) {
        return respond(origin, 500, { ok: false, error: reserveSetting.error.message });
      }
      const reserveAmountUsd = parseMoneySetting(reserveSetting.data?.value, 10);
      const reserveRes = await supabase.rpc("reserve_user_credits", {
        p_user_id: user.id,
        p_amount_usd: reserveAmountUsd,
        p_request_id: requestRow.id,
        p_metadata: {
          request_type: "company_pair",
          company_a_name: companyA.name,
          company_b_name: companyB.name,
        },
      });
      if (reserveRes.error || !reserveRes.data) {
        await supabase.from("company_pair_requests").update({
          status: "failed",
          error: reserveRes.error?.message ?? "insufficient credits",
        }).eq("id", requestRow.id);
        return respond(origin, 402, {
          ok: false,
          error: "Not enough credits to reserve this investigation",
          details: reserveRes.error?.message ?? null,
          request: requestRow,
        });
      }

      creditReservationId = reserveRes.data;
      reservedAmountUsd = reserveAmountUsd;
      await supabase
        .from("company_pair_requests")
        .update({ credit_reservation_id: creditReservationId })
        .eq("id", requestRow.id);
    }

    const startRes = await safeFetchJson(`${supabaseUrl}/functions/v1/investigation_start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRole}`,
        "x-internal-key": internalEdgeApiKey,
      },
      body: JSON.stringify({
        company_pair_request_id: requestRow.id,
      }),
    });

    const dispatchOk = startRes.bodyJson?.dispatch_result?.ok === true;
    if (!startRes.ok || !dispatchOk) {
      if (creditReservationId) {
        await supabase.rpc("release_credit_reservation", {
          p_reservation_id: creditReservationId,
          p_metadata: { reason: "dispatch_failed" },
        });
      }
      await supabase.from("company_pair_requests").update({
        status: "failed",
        error: startRes.bodyJson?.dispatch_result?.reason ?? startRes.bodyJson?.error ?? startRes.bodyText ?? "dispatch failed",
      }).eq("id", requestRow.id);
      return respond(origin, 500, {
        ok: false,
        error: "Could not dispatch research",
        details: startRes.bodyJson ?? startRes.bodyText,
      });
    }

    return respond(origin, 200, {
      ok: true,
      request_id: requestRow.id,
      credit_reservation_id: creditReservationId,
      reserved_amount_usd: reservedAmountUsd,
      shared_funding_enabled: investigationCreditsEnabled,
      dispatch_result: startRes.bodyJson,
    });
  } catch (error) {
    return respond(origin, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
