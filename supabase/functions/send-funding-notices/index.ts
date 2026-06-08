import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type NoticeRow = {
  id: string;
  user_id: string;
  notification_type: string;
  subject: string;
  body: string;
  metadata: Record<string, unknown>;
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function getClerkEmail(clerkSecretKey: string, userId: string): Promise<string | null> {
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, {
    headers: {
      "Authorization": `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Clerk user lookup failed: ${res.status} ${await res.text()}`);
  }

  const user = await res.json();
  const primaryEmailId = typeof user.primary_email_address_id === "string" ? user.primary_email_address_id : "";
  const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
  const primary = emails.find((email: Record<string, unknown>) => email.id === primaryEmailId) ?? emails[0] ?? null;
  return typeof primary?.email_address === "string" ? primary.email_address : null;
}

async function sendEmail(args: {
  resendApiKey: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  body: string;
}) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${args.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.fromEmail,
      to: args.toEmail,
      subject: args.subject,
      text: args.body,
    }),
  });

  const responseBody = await res.text();
  if (!res.ok) {
    throw new Error(`Resend email failed: ${res.status} ${responseBody}`);
  }
  return responseBody ? JSON.parse(responseBody) : {};
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method Not Allowed" });
  }

  const expectedKey = Deno.env.get("INTERNAL_EDGE_API_KEY") ?? "";
  const internalKey = req.headers.get("x-internal-key") ?? "";
  if (!expectedKey || internalKey !== expectedKey) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRole) {
    return jsonResponse(500, { ok: false, error: "Missing Supabase configuration" });
  }

  const clerkSecretKey = Deno.env.get("CLERK_SECRET_KEY") ?? "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const fromEmail = Deno.env.get("FUNDING_NOTICE_FROM_EMAIL") ?? "Pepe Silv.AI <notifications@pepesilv.ai>";
  const siteUrl = (Deno.env.get("SITE_URL") ?? Deno.env.get("PUBLIC_SITE_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
  const limit = Math.max(1, Math.min(25, Number(new URL(req.url).searchParams.get("limit") ?? "10") || 10));
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  const notices = await supabase
    .from("user_notification_outbox")
    .select("id, user_id, notification_type, subject, body, metadata")
    .eq("status", "pending")
    .eq("notification_type", "funding_needed")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (notices.error) {
    return jsonResponse(500, { ok: false, error: notices.error.message });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const notice of (notices.data ?? []) as NoticeRow[]) {
    try {
      if (!clerkSecretKey || !resendApiKey) {
        await supabase.from("user_notification_outbox").update({
          status: "skipped",
          error: "CLERK_SECRET_KEY or RESEND_API_KEY is not configured",
          sent_at: new Date().toISOString(),
        }).eq("id", notice.id);
        results.push({ id: notice.id, status: "skipped" });
        continue;
      }

      const toEmail = await getClerkEmail(clerkSecretKey, notice.user_id);
      if (!toEmail) {
        throw new Error("No email address found for Clerk user");
      }

      const queueUrl = typeof notice.metadata?.queue_url === "string" ? notice.metadata.queue_url : "";
      const companyAName = typeof notice.metadata?.company_a_name === "string" ? notice.metadata.company_a_name : "";
      const companyBName = typeof notice.metadata?.company_b_name === "string" ? notice.metadata.company_b_name : "";
      const link = queueUrl ? `${siteUrl}/?url=${encodeURIComponent(queueUrl)}` : siteUrl;
      const context = companyAName || companyBName
        ? `\n\nInvestigation: ${companyAName || "Company A"} / ${companyBName || "Company B"}`
        : "";
      const body = `${notice.body}${context}\n\nOpen Pepe Silv.AI here:\n${link}`;
      const sendResult = await sendEmail({
        resendApiKey,
        fromEmail,
        toEmail,
        subject: notice.subject,
        body,
      });

      await supabase.from("user_notification_outbox").update({
        status: "sent",
        sent_at: new Date().toISOString(),
        metadata: {
          ...notice.metadata,
          provider: "resend",
          provider_response: sendResult,
        },
      }).eq("id", notice.id);
      results.push({ id: notice.id, status: "sent" });
    } catch (error) {
      await supabase.from("user_notification_outbox").update({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }).eq("id", notice.id);
      results.push({
        id: notice.id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return jsonResponse(200, {
    ok: true,
    processed: results.length,
    results,
  });
});
