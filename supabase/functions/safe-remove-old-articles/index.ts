import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const DEFAULT_MAX_AGE_HOURS = 48;
const MS_PER_HOUR = 60 * 60 * 1000;
function log(step, data = null) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    step,
    data
  }));
}
function extractTimestampFromUrl(rawUrl) {
  try {
    let value = String(rawUrl).trim();
    if (!/^[a-zA-Z]+:\/\//.test(value)) {
      value = `https://${value}`;
    }
    const url = new URL(value);
    const target = `${url.hostname}${url.pathname}`.toLowerCase();
    // /2026/04/11/
    let match = target.match(/\/(20\d{2})\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])(?:\/|$)/);
    if (match) {
      const [, year, month, day] = match;
      return Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
    }
    // /2026-04-11/ or /2026_04_11/
    match = target.match(/(?:^|\/)(20\d{2})[-_](0[1-9]|1[0-2])[-_](0[1-9]|[12]\d|3[01])(?:\/|[-_]|$)/);
    if (match) {
      const [, year, month, day] = match;
      return Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
    }
    // /20260411/
    match = target.match(/(?:^|\/)(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:\/|[^0-9]|$)/);
    if (match) {
      const [, year, month, day] = match;
      return Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
    }
    // ...-07-05-24/...  => MM-DD-YY
    match = target.match(/(?:^|[/-])(?:[a-z0-9-]*?)(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-(\d{2})(?:\/|\.|-|$)/);
    if (match) {
      const [, month, day, year2] = match;
      const year = 2000 + Number(year2);
      return Date.UTC(year, Number(month) - 1, Number(day), 0, 0, 0, 0);
    }
    return null;
  } catch  {
    return null;
  }
}
function shouldDeleteRow(row, nowMs, maxAgeHours) {
  const normalizedStatus = (row.status ?? "").trim().toLowerCase();
  if (normalizedStatus === "complete" || normalizedStatus === "not-applicable") {
    return {
      deleteIt: false,
      reason: "protected-status",
      timestampMs: null
    };
  }
  if (typeof row.url !== "string" || row.url.trim().length === 0) {
    return {
      deleteIt: false,
      reason: "missing-url",
      timestampMs: null
    };
  }
  const timestampMs = extractTimestampFromUrl(row.url);
  if (timestampMs === null) {
    return {
      deleteIt: false,
      reason: "no-parseable-url-date",
      timestampMs: null
    };
  }
  const maxAgeMs = maxAgeHours * MS_PER_HOUR;
  const ageMs = nowMs - timestampMs;
  if (ageMs < -6 * MS_PER_HOUR) {
    return {
      deleteIt: false,
      reason: "future-dated",
      timestampMs
    };
  }
  if (ageMs > maxAgeMs) {
    return {
      deleteIt: true,
      reason: "older-than-threshold",
      timestampMs
    };
  }
  return {
    deleteIt: false,
    reason: "within-threshold",
    timestampMs
  };
}
Deno.serve(async (req)=>{
  const requestId = crypto.randomUUID();
  try {
    const internalKey = Deno.env.get("INTERNAL_KEY");
    const providedKey = req.headers.get("x-internal-key");
    log("startup", {
      requestId,
      hasInternalKey: Boolean(internalKey),
      hasProvidedKey: Boolean(providedKey),
      method: req.method,
      url: req.url
    });
    if (!internalKey) {
      log("missing-env", {
        requestId,
        missing: "INTERNAL_KEY"
      });
      throw new Error("Missing INTERNAL_KEY");
    }
    if (!providedKey || providedKey !== internalKey) {
      log("auth-failed", {
        requestId,
        hasProvidedKey: Boolean(providedKey),
        keyMatched: providedKey === internalKey
      });
      return new Response(JSON.stringify({
        error: "Unauthorized"
      }), {
        status: 401,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    log("auth-passed", {
      requestId
    });
    let body = {};
    try {
      body = await req.json();
    } catch  {
      body = {};
    }
    const maxAgeHoursRaw = body.max_age_hours;
    const maxAgeHours = typeof maxAgeHoursRaw === "number" && Number.isFinite(maxAgeHoursRaw) && maxAgeHoursRaw > 0 ? maxAgeHoursRaw : DEFAULT_MAX_AGE_HOURS;
    log("parsed-body", {
      requestId,
      body,
      maxAgeHours
    });
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    log("env-check", {
      requestId,
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey)
    });
    if (!supabaseUrl || !serviceRoleKey) {
      log("missing-env", {
        requestId,
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceRoleKey: Boolean(serviceRoleKey)
      });
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const nowMs = Date.now();
    log("queue-fetch-start", {
      requestId,
      table: "article_queue"
    });
    const { data: rows, error: rowsError } = await supabase.from("article_queue").select("id, url, status");
    if (rowsError) {
      log("queue-fetch-failed", {
        requestId,
        error: rowsError.message
      });
      throw rowsError;
    }
    const queueRows = rows ?? [];
    log("queue-fetch-finished", {
      requestId,
      rowCount: queueRows.length,
      sample: queueRows.slice(0, 10)
    });
    const evaluatedRows = queueRows.map((row)=>{
      const decision = shouldDeleteRow(row, nowMs, maxAgeHours);
      return {
        row,
        ...decision
      };
    });
    const rowsToDelete = evaluatedRows.filter((item)=>item.deleteIt);
    log("queue-evaluated", {
      requestId,
      totalRows: evaluatedRows.length,
      deleteCount: rowsToDelete.length,
      skippedProtected: evaluatedRows.filter((r)=>r.reason === "protected-status").length,
      skippedMissingUrl: evaluatedRows.filter((r)=>r.reason === "missing-url").length,
      skippedNoParseableUrlDate: evaluatedRows.filter((r)=>r.reason === "no-parseable-url-date").length,
      skippedWithinThreshold: evaluatedRows.filter((r)=>r.reason === "within-threshold").length,
      skippedFutureDated: evaluatedRows.filter((r)=>r.reason === "future-dated").length,
      deleteSample: rowsToDelete.slice(0, 10).map((item)=>({
          id: item.row.id,
          url: item.row.url,
          status: item.row.status,
          timestampMs: item.timestampMs,
          reason: item.reason
        }))
    });
    if (rowsToDelete.length === 0) {
      log("early-return-no-deletes", {
        requestId
      });
      return new Response(JSON.stringify({
        checked: evaluatedRows.length,
        deleted: 0,
        threshold_hours: maxAgeHours,
        deleted_rows: []
      }), {
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const idsToDelete = rowsToDelete.map((item)=>item.row.id);
    log("delete-start", {
      requestId,
      deleteCount: idsToDelete.length,
      idsSample: idsToDelete.slice(0, 20)
    });
    const { error: deleteError } = await supabase.from("article_queue").delete().in("id", idsToDelete);
    if (deleteError) {
      log("delete-failed", {
        requestId,
        error: deleteError.message
      });
      throw deleteError;
    }
    log("delete-finished", {
      requestId,
      deletedCount: idsToDelete.length
    });
    return new Response(JSON.stringify({
      checked: evaluatedRows.length,
      deleted: idsToDelete.length,
      threshold_hours: maxAgeHours,
      deleted_rows: rowsToDelete.map((item)=>({
          id: item.row.id,
          url: item.row.url,
          status: item.row.status,
          resolved_timestamp_ms: item.timestampMs
        }))
    }), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    log("fatal-error", {
      requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null
    });
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
