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

function isMockAuthEnabled() {
  return (Deno.env.get("PEPE_AUTH_MODE") ?? "").trim().toLowerCase() === "mock";
}

function getClerkAuthorizedParties() {
  return (Deno.env.get("CLERK_AUTHORIZED_PARTIES") ?? "")
    .split(",")
    .map((party) => party.trim())
    .filter(Boolean);
}

type ClerkUser = {
  id: string;
  email: string | null;
};

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
  const userId = typeof claims.sub === "string" && claims.sub ? claims.sub : "";
  return userId ? { id: userId, email: getClaimEmail(claims) } : null;
}

async function deleteClerkUser(userId: string) {
  const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY") ?? "";
  if (!clerkSecretKey) {
    return { deleted: false, skipped: true, reason: "CLERK_SECRET_KEY is not configured" };
  }

  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Clerk delete failed: ${res.status} ${text}`);
  }
  return { deleted: true, skipped: false };
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
  if (!supabaseUrl || !serviceRole) {
    return respond(origin, 500, { ok: false, error: "Missing Supabase configuration" });
  }

  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const user = await getAuthenticatedUser(req, body);
    if (!user) {
      return respond(origin, 401, { ok: false, error: "Sign in required" });
    }
    if (!(await isAllowedTester(user))) {
      return respond(origin, 403, { ok: false, error: "under_construction" });
    }

    const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    const userId = user.id;
    const prefs = await supabase.rpc("update_user_account_preferences", {
      p_user_id: userId,
      p_email_notifications_enabled: false,
      p_delete_account: true,
    });
    if (prefs.error) {
      return respond(origin, 500, { ok: false, error: prefs.error.message });
    }

    await supabase
      .from("article_investigation_funders")
      .update({ status: "opted_out", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("is_starter", false);

    await supabase
      .from("company_pair_investigation_funders")
      .update({ status: "opted_out", updated_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("is_starter", false);

    const clerkDelete = await deleteClerkUser(userId);
    return respond(origin, 200, {
      ok: true,
      account_preferences: prefs.data,
      clerk_delete: clerkDelete,
    });
  } catch (error) {
    return respond(origin, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
