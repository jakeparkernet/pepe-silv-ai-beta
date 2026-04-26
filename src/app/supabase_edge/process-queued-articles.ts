// process-queued-articles.refactored.ts

import { createClient } from "npm:@supabase/supabase-js@2";

type QueuedArticle = {
  id: string;
  status: string;
};

function log(scope: string, message: string, data: unknown = null): void {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    scope,
    message,
    data,
  }));
}

Deno.serve(async (req) => {
  const runId = crypto.randomUUID();

  const internalKey = req.headers.get("x-internal-key");
  const expectedKey = Deno.env.get("INTERNAL_EDGE_API_KEY");

  if (!expectedKey || internalKey !== expectedKey) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required", runId }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const { data, error } = await supabase
      .from("article_queue")
      .select("id, status")
      .in("status", ["queued", "deferred"])
      .is("remote_requested_at", null);

    if (error) throw error;

    const articles: QueuedArticle[] = data ?? [];

    let invoked = 0;
    const errors: string[] = [];

    for (const article of articles) {
      const { data: res, error: invokeErr } = await supabase.functions.invoke(
        "investigation_start",
        {
          body: { queue_id: article.id },
          headers: { "x-internal-key": expectedKey! },
        }
      );

      if (invokeErr) {
        errors.push(`${article.id}: ${invokeErr.message}`);
        continue;
      }

      if (res?.did_call_remote === true) {
        invoked++;
      }
    }

    return new Response(JSON.stringify({
      runId,
      total: articles.length,
      invoked,
      errors,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e), runId }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});