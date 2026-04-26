import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type Json = Record<string, unknown>;
type FlyMachine = Record<string, unknown>;
type ExtractedCompany = {
  name: string;
  prominence: string;
  context: string;
};
type ApplicabilityResult = {
  is_applicable: boolean;
  reason: string;
  identified_company: string | null;
  identified_product: string | null;
};
type PrefetchedEntity = {
  id: string;
  created_at: string;
  metadata: Record<string, unknown>;
  notes: string;
  name: string;
  aliases: string[];
  entity_type: string;
  tags: string[];
  context: string;
  evidence_ids: string[];
  flatname: string;
  top_dog: boolean;
};
type NormalizedPrefetched = {
  domain: string;
  site_id: string;
  site_entity_id: string | null;
  site_news_site: string | null;
  scrape_result: { raw_html: string; result: string };
  extracted_companies: ExtractedCompany[];
  applicability_result?: ApplicabilityResult;
  article_subject_entity?: PrefetchedEntity | null;
};

const jsonHeaders: Record<string, string> = {
  "Content-Type": "application/json; charset=utf-8",
};

function makeRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    message: String(error),
  };
}

function logInfo(
  requestId: string,
  step: string,
  details: Record<string, unknown> = {},
) {
  console.log(
    JSON.stringify({
      level: "info",
      request_id: requestId,
      step,
      ...details,
    }),
  );
}

function logError(
  requestId: string,
  step: string,
  details: Record<string, unknown> = {},
) {
  console.error(
    JSON.stringify({
      level: "error",
      request_id: requestId,
      step,
      ...details,
    }),
  );
}

function jsonResponse(status: number, body: Json): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: jsonHeaders,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeInputUrl(raw: string): string | null {
  let trimmed = raw.trim();

  if (trimmed.length === 0) return null;

  trimmed = trimmed.replace(/\s+/g, "");

  if (!/^[a-zA-Z]+:\/\//.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }

  try {
    const u = new URL(trimmed);

    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }

    u.hostname = u.hostname.toLowerCase();

    if (u.pathname !== "/") {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }

    return u.toString();
  } catch {
    return null;
  }
}

function makeQueueUrlKey(rawUrl: string): { hostname: string; key: string } {
  const u = new URL(rawUrl);

  const isDefaultPort =
    (u.protocol === "https:" && (u.port === "" || u.port === "443")) ||
    (u.protocol === "http:" && (u.port === "" || u.port === "80"));

  const hostNoWww = u.hostname.toLowerCase().replace(/^www\./, "");
  const hostWithPort = isDefaultPort ? hostNoWww : `${hostNoWww}:${u.port}`;

  let path = u.pathname || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");

  return {
    hostname: hostWithPort,
    key: `${hostWithPort}${path}`,
  };
}

function normalizeQueueUrlToRawUrl(storedQueueUrl: string): string | null {
  const normalized = normalizeInputUrl(storedQueueUrl);
  if (normalized) return normalized;

  // article_queue.url is usually the queue key: example.com/path.
  // Rehydrate that to an http(s) URL for the downstream investigation input.
  return normalizeInputUrl(`https://${storedQueueUrl}`);
}

function normalizePrefetched(value: unknown): NormalizedPrefetched | undefined {
  if (!isRecord(value)) return undefined;

  // Supports both shapes:
  // 1. Stored prepass shape from get-or-enqueue:
  //    { domain, site_data: { site_id, site_entity_id, news_site }, ... }
  // 2. Coordinator/Fly payload shape:
  //    { domain, site_id, site_entity_id, site_news_site, ... }
  const siteData = isRecord(value.site_data) ? value.site_data : null;

  const domain = typeof value.domain === "string" ? value.domain : "";
  const siteId =
    typeof value.site_id === "string"
      ? value.site_id
      : typeof siteData?.site_id === "string"
        ? siteData.site_id
        : typeof siteData?.site_record_id === "string"
          ? siteData.site_record_id
          : "";

  const siteEntityId =
    typeof value.site_entity_id === "string"
      ? value.site_entity_id
      : typeof siteData?.site_entity_id === "string"
        ? siteData.site_entity_id
        : typeof siteData?.news_site_entity_id === "string"
          ? siteData.news_site_entity_id
          : null;

  const siteNewsSite =
    typeof value.site_news_site === "string"
      ? value.site_news_site
      : typeof siteData?.news_site === "string"
        ? siteData.news_site
        : null;

  const scrapeResult = isRecord(value.scrape_result)
    ? {
      raw_html: typeof value.scrape_result.raw_html === "string" ? value.scrape_result.raw_html : "",
      result: typeof value.scrape_result.result === "string" ? value.scrape_result.result : "",
    }
    : { raw_html: "", result: "" };

  const extractedCompanies = Array.isArray(value.extracted_companies)
    ? value.extracted_companies
      .filter(isRecord)
      .map((company) => ({
        name: typeof company.name === "string" ? company.name : "",
        prominence: typeof company.prominence === "string" ? company.prominence : "mention",
        context: typeof company.context === "string" ? company.context : "",
      }))
      .filter((company) => company.name.length > 0)
    : [];

  const applicabilityResult = isRecord(value.applicability_result)
    ? {
      is_applicable: value.applicability_result.is_applicable === true,
      reason: typeof value.applicability_result.reason === "string"
        ? value.applicability_result.reason
        : "",
      identified_company: typeof value.applicability_result.identified_company === "string"
        ? value.applicability_result.identified_company
        : null,
      identified_product: typeof value.applicability_result.identified_product === "string"
        ? value.applicability_result.identified_product
        : null,
    }
    : undefined;

  const articleSubjectEntity = isRecord(value.article_subject_entity)
    ? value.article_subject_entity as PrefetchedEntity
    : null;

  if (!domain || !siteId) {
    return undefined;
  }

  return {
    domain,
    site_id: siteId,
    site_entity_id: siteEntityId,
    site_news_site: siteNewsSite,
    scrape_result: scrapeResult,
    extracted_companies: extractedCompanies,
    applicability_result: applicabilityResult,
    article_subject_entity: articleSubjectEntity,
  };
}

function buildEnqueuePayload(rawUrl: string, prefetched?: NormalizedPrefetched) {
  const session_id = `sess_${crypto.randomUUID()}`;
  const investigation_id = crypto.randomUUID();

  const input: Record<string, unknown> = { url: rawUrl };

  if (prefetched) {
    input.prefetched = {
      domain: prefetched.domain,
      site_data: {
        site_record_id: prefetched.site_id,
        news_site_entity_id: prefetched.site_entity_id,
        news_site: prefetched.site_news_site,
      },
      scrape_result: prefetched.scrape_result,
      extracted_companies: prefetched.extracted_companies,
      applicability_result: prefetched.applicability_result,
      article_subject_entity: prefetched.article_subject_entity,
    };
  }

  const job_spec = {
    type: "investigation",
    params: {
      id: investigation_id,
      input,
    },
    dedupe_key: rawUrl,
  };

  return {
    session_id,
    job_spec,
  };
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeFetchJson(url: string, init: RequestInit) {
  try {
    const res = await fetch(url, init);
    const bodyText = await res.text();

    let bodyJson: unknown = null;
    try {
      bodyJson = bodyText.length > 0 ? JSON.parse(bodyText) : null;
    } catch {
      bodyJson = null;
    }

    return {
      ok: res.ok,
      status: res.status,
      bodyText,
      bodyJson,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 0,
      bodyText: message,
      bodyJson: null,
    };
  }
}

function flyHeaders(flyToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${flyToken}`,
    "Content-Type": "application/json",
  };
}

function flyHeadersWithLease(
  flyToken: string,
  leaseNonce: string | null,
): HeadersInit {
  return {
    Authorization: `Bearer ${flyToken}`,
    "Content-Type": "application/json",
    ...(leaseNonce ? { "fly-machine-lease-nonce": leaseNonce } : {}),
  };
}

function coordinatorHeaders(machineId: string, apiKey?: string): HeadersInit {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    "Content-Type": "application/json",
    "fly-force-instance-id": machineId,
  };
}

async function listFlyMachines(
  flyApiHostname: string,
  flyToken: string,
  appName: string,
) {
  const url = `${flyApiHostname}/v1/apps/${appName}/machines`;

  return await safeFetchJson(url, {
    method: "GET",
    headers: flyHeaders(flyToken),
  });
}

async function leaseFlyMachine(
  flyApiHostname: string,
  flyToken: string,
  appName: string,
  machineId: string,
  ttlSeconds: number,
) {
  const url = `${flyApiHostname}/v1/apps/${appName}/machines/${machineId}/lease`;

  return await safeFetchJson(url, {
    method: "POST",
    headers: flyHeaders(flyToken),
    body: JSON.stringify({
      description: "supabase_edge_pool_claim",
      ttl: ttlSeconds,
    }),
  });
}

async function releaseFlyMachineLease(
  flyApiHostname: string,
  flyToken: string,
  appName: string,
  machineId: string,
  leaseNonce: string,
) {
  const url = `${flyApiHostname}/v1/apps/${appName}/machines/${machineId}/lease`;

  return await safeFetchJson(url, {
    method: "DELETE",
    headers: flyHeadersWithLease(flyToken, leaseNonce),
  });
}

async function startFlyMachine(
  flyApiHostname: string,
  flyToken: string,
  appName: string,
  machineId: string,
  leaseNonce: string,
) {
  const url = `${flyApiHostname}/v1/apps/${appName}/machines/${machineId}/start`;

  return await safeFetchJson(url, {
    method: "POST",
    headers: flyHeadersWithLease(flyToken, leaseNonce),
  });
}

function parseLeaseNonce(bodyJson: unknown): string | null {
  if (!isRecord(bodyJson)) {
    return null;
  }

  const directNonce =
    typeof bodyJson.nonce === "string" && bodyJson.nonce.length > 0 ? bodyJson.nonce : null;

  if (directNonce) return directNonce;

  const data = isRecord(bodyJson.data) ? bodyJson.data : null;
  if (!data) return null;

  const nestedNonce =
    typeof data.nonce === "string" && data.nonce.length > 0 ? data.nonce : null;

  return nestedNonce;
}

function getMachineState(machine: Record<string, unknown>): string {
  return typeof machine.state === "string" ? machine.state : "";
}

function isMachineAvailable(machine: Record<string, unknown>): boolean {
  return getMachineState(machine) === "stopped";
}

function sortMachinesOldestUpdateFirst(
  machines: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return [...machines].sort((a, b) => {
    const aUpdated = typeof a.updated_at === "string" ? a.updated_at : "";
    const bUpdated = typeof b.updated_at === "string" ? b.updated_at : "";
    return String(aUpdated).localeCompare(String(bUpdated));
  });
}

function parsePositiveIntegerSetting(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }

  return null;
}

async function getFlyScaleLimit(
  supabase: ReturnType<typeof createClient>,
  requestId: string,
) {
  logInfo(requestId, "db.settings.fly_scale_lookup.start");

  const settingsRes = await supabase
    .from("settings")
    .select("key, value")
    .eq("key", "fly_scale")
    .maybeSingle();

  if (settingsRes.error) {
    logError(requestId, "db.settings.fly_scale_lookup.error", {
      error: settingsRes.error,
    });

    return {
      ok: false,
      reason: "settings_lookup_failed",
      details: settingsRes.error.message,
    };
  }

  if (!settingsRes.data) {
    return {
      ok: false,
      reason: "fly_scale_missing",
      details: "No settings row found for key 'fly_scale'.",
    };
  }

  const scaleLimit = parsePositiveIntegerSetting(settingsRes.data.value);

  if (scaleLimit === null) {
    return {
      ok: false,
      reason: "fly_scale_invalid",
      details: {
        message: "settings.value for key 'fly_scale' must be a positive integer.",
        value: settingsRes.data.value ?? null,
      },
    };
  }

  logInfo(requestId, "db.settings.fly_scale_lookup.done", {
    fly_scale: scaleLimit,
    settings_key: "fly_scale",
  });

  return {
    ok: true,
    fly_scale: scaleLimit,
  };
}

async function clearRemoteRequestedAt(args: {
  supabase: ReturnType<typeof createClient>;
  queueId: string;
  requestId: string;
  reason: string;
}) {
  const { supabase, queueId, requestId, reason } = args;

  const resetRes = await supabase
    .from("article_queue")
    .update({ remote_requested_at: null })
    .eq("id", queueId)
    .select("id, remote_requested_at, status")
    .maybeSingle();

  if (resetRes.error) {
    logError(requestId, "db.queue_mark_retryable.error", {
      queue_id: queueId,
      reason,
      error: resetRes.error,
    });

    return {
      ok: false,
      reason: "queue_retry_reset_failed",
      details: resetRes.error.message,
    };
  }

  return {
    ok: true,
    queue_id: queueId,
    reason,
  };
}

async function acquireDispatchSlot(args: {
  supabase: ReturnType<typeof createClient>;
  queueId: string;
  requestId: string;
  ttlSeconds?: number;
}) {
  const { supabase, queueId, requestId, ttlSeconds = 90 } = args;

  const res = await supabase.rpc("try_acquire_dispatch_slot", {
    p_queue_id: queueId,
    p_request_id: requestId,
    p_ttl_seconds: ttlSeconds,
  });

  if (res.error) {
    logError(requestId, "db.dispatch_slot.acquire.error", {
      queue_id: queueId,
      error: res.error,
    });

    return {
      ok: false,
      reason: "dispatch_slot_acquire_failed",
      details: res.error.message,
    };
  }

  const row = Array.isArray(res.data) ? res.data[0] : res.data;

  return {
    ok: row?.ok === true,
    reservation_id:
      typeof row?.reservation_id === "string" ? row.reservation_id : null,
    reason: typeof row?.reason === "string" ? row.reason : null,
    raw: row ?? null,
  };
}

async function releaseDispatchSlot(args: {
  supabase: ReturnType<typeof createClient>;
  reservationId: string;
  requestId: string;
  reason: string;
}) {
  const { supabase, reservationId, requestId, reason } = args;

  const res = await supabase.rpc("release_dispatch_slot", {
    p_reservation_id: reservationId,
    p_request_id: requestId,
    p_reason: reason,
  });

  if (res.error) {
    logError(requestId, "db.dispatch_slot.release.error", {
      reservation_id: reservationId,
      reason,
      error: res.error,
    });

    return {
      ok: false,
      reason: "dispatch_slot_release_failed",
      details: res.error.message,
    };
  }

  const row = Array.isArray(res.data) ? res.data[0] : res.data;

  return {
    ok: row?.ok === true,
    reservation_id: reservationId,
    reason: typeof row?.reason === "string" ? row.reason : reason,
    raw: row ?? null,
  };
}

async function markDispatchSlotDispatched(args: {
  supabase: ReturnType<typeof createClient>;
  reservationId: string;
  machineId: string | null;
  enqueuePayload: Record<string, unknown> | null;
  ttlSeconds?: number;
}) {
  const {
    supabase,
    reservationId,
    machineId,
    enqueuePayload,
    ttlSeconds = 900,
  } = args;

  const res = await supabase.rpc("mark_dispatch_slot_dispatched", {
    p_reservation_id: reservationId,
    p_machine_id: machineId,
    p_enqueue_payload: enqueuePayload,
    p_ttl_seconds: ttlSeconds,
  });

  if (res.error) {
    return {
      ok: false,
      reason: "dispatch_slot_mark_dispatched_failed",
      details: res.error.message,
    };
  }

  const row = Array.isArray(res.data) ? res.data[0] : res.data;

  return {
    ok: row?.ok === true,
    raw: row ?? null,
  };
}

async function claimPooledMachine(args: {
  flyApiHostname: string;
  flyToken: string;
  appName: string;
  requestId: string;
}) {
  const { flyApiHostname, flyToken, appName, requestId } = args;

  const listRes = await listFlyMachines(flyApiHostname, flyToken, appName);

  if (!listRes.ok || !Array.isArray(listRes.bodyJson)) {
    return {
      ok: false,
      reason: "list_failed",
      details: listRes.bodyJson ?? listRes.bodyText,
    };
  }

  const machines = listRes.bodyJson as Array<FlyMachine>;
  const candidates = sortMachinesOldestUpdateFirst(
    machines.filter((machine) => isMachineAvailable(machine)),
  );

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "no_available_machine",
    };
  }

  for (const candidate of candidates) {
    const machineId =
      typeof candidate.id === "string" && candidate.id.length > 0
        ? candidate.id
        : null;
    const machineState = getMachineState(candidate);

    if (!machineId || machineState !== "stopped") continue;

    const leaseRes = await leaseFlyMachine(
      flyApiHostname,
      flyToken,
      appName,
      machineId,
      60,
    );

    if (!leaseRes.ok) continue;

    const leaseNonce = parseLeaseNonce(leaseRes.bodyJson);
    if (!leaseNonce) continue;

    logInfo(requestId, "fly.machine.leased", {
      machine_id: machineId,
      state: machineState,
    });

    return {
      ok: true,
      machine_id: machineId,
      lease_nonce: leaseNonce,
      machine_state: machineState,
    };
  }

  return {
    ok: false,
    reason: "all_candidates_failed_or_were_claimed",
  };
}

async function startClaimedMachine(args: {
  flyApiHostname: string;
  flyToken: string;
  appName: string;
  machineId: string;
  leaseNonce: string;
}) {
  const { flyApiHostname, flyToken, appName, machineId, leaseNonce } = args;

  const startRes = await startFlyMachine(
    flyApiHostname,
    flyToken,
    appName,
    machineId,
    leaseNonce,
  );

  if (!startRes.ok) {
    return {
      ok: false,
      reason: "start_failed",
      machine_id: machineId,
      details: startRes.bodyJson ?? startRes.bodyText,
    };
  }

  return {
    ok: true,
    machine_id: machineId,
    start_result: startRes.bodyJson ?? startRes.bodyText,
  };
}

async function waitForCoordinatorHealth(args: {
  baseUrl: string;
  healthPath: string;
  timeoutMs: number;
  intervalMs: number;
  machineId: string;
  requestId: string;
}) {
  const { baseUrl, healthPath, timeoutMs, intervalMs, machineId, requestId } = args;
  const healthUrl = joinUrl(baseUrl, healthPath);
  const start = Date.now();
  let lastAttempt: unknown = null;

  while (Date.now() - start < timeoutMs) {
    const res = await safeFetchJson(healthUrl, {
      method: "GET",
      headers: coordinatorHeaders(machineId),
    });

    lastAttempt = {
      ok: res.ok,
      status: res.status,
      body: res.bodyJson ?? res.bodyText,
    };

    if (res.ok && isRecord(res.bodyJson)) {
      const ok = res.bodyJson.ok === true;
      const ready = typeof res.bodyJson.ready === "boolean" ? res.bodyJson.ready : true;

      if (ok && ready) {
        return {
          ok: true,
          details: res.bodyJson,
        };
      }
    }

    await sleep(intervalMs);
  }

  logInfo(requestId, "coordinator.health.timeout", {
    machine_id: machineId,
    health_url: healthUrl,
    timeout_ms: timeoutMs,
    last_attempt: lastAttempt,
  });

  return {
    ok: false,
    reason: "health_timeout",
    health_url: healthUrl,
    machine_id: machineId,
    timeout_ms: timeoutMs,
    last_attempt: lastAttempt,
  };
}

async function enqueueCoordinatorJob(args: {
  baseUrl: string;
  enqueuePath: string;
  apiKey: string;
  payload: Record<string, unknown>;
  machineId: string;
}) {
  const { baseUrl, enqueuePath, apiKey, payload, machineId } = args;
  const enqueueUrl = joinUrl(baseUrl, enqueuePath);

  const res = await safeFetchJson(enqueueUrl, {
    method: "POST",
    headers: coordinatorHeaders(machineId, apiKey),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return {
      ok: false,
      reason: "enqueue_failed",
      status: res.status,
      details: res.bodyJson ?? res.bodyText,
    };
  }

  return {
    ok: true,
    status: res.status,
    details: res.bodyJson ?? res.bodyText,
  };
}

serve(async (req) => {
  const requestId = makeRequestId();

  const internalKey = req.headers.get("x-internal-key");
  const expectedKey = Deno.env.get("INTERNAL_EDGE_API_KEY");

  if (!expectedKey || internalKey !== expectedKey) {
    logError(requestId, "security.unauthorized", {
      has_key: Boolean(internalKey),
      ip: req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip"),
    });
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(405, {
        error: "Method Not Allowed. Use POST.",
        request_id: requestId,
      });
    }

    const body = await req.json() as {
      queue_id?: unknown;
      url?: unknown;
      prefetched?: unknown;
    };

    const requestQueueId = typeof body.queue_id === "string" ? body.queue_id : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const flyToken = Deno.env.get("FLY_API_TOKEN") ?? "";
    const appName = Deno.env.get("FLY_APP_NAME") ?? "my-ephemeral-jobs";
    const flyApiHostname = Deno.env.get("FLY_API_HOSTNAME") ?? "https://api.machines.dev";
    const coordinatorBaseUrl = Deno.env.get("COORDINATOR_BASE_URL") ?? "";
    const pepeApiKey = Deno.env.get("PEPE_API_KEY") ?? "";
    const healthPath = Deno.env.get("COORDINATOR_HEALTH_PATH") ?? "/api/health";
    const enqueuePath = Deno.env.get("COORDINATOR_ENQUEUE_PATH") ?? "/api/enqueue";
    const healthTimeoutMs = Number(Deno.env.get("COORDINATOR_HEALTH_TIMEOUT_MS") ?? "30000");
    const healthIntervalMs = Number(Deno.env.get("COORDINATOR_HEALTH_INTERVAL_MS") ?? "500");

    const missingSecrets: string[] = [];
    if (!supabaseUrl) missingSecrets.push("SUPABASE_URL");
    if (!supabaseServiceRole) missingSecrets.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!flyToken) missingSecrets.push("FLY_API_TOKEN");
    if (!coordinatorBaseUrl) missingSecrets.push("COORDINATOR_BASE_URL");
    if (!pepeApiKey) missingSecrets.push("PEPE_API_KEY");

    if (missingSecrets.length > 0) {
      return jsonResponse(500, {
        error: "Missing required secrets.",
        missing_secrets: missingSecrets,
        request_id: requestId,
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRole, {
      auth: { persistSession: false },
    });

    const flyScaleRes = await getFlyScaleLimit(supabase, requestId);
    if (!flyScaleRes.ok) {
      return jsonResponse(500, {
        error: "Unable to resolve fly scale limit from settings.",
        details: flyScaleRes,
        request_id: requestId,
      });
    }

    let queueLookup;

    if (requestQueueId) {
      queueLookup = await supabase
        .from("article_queue")
        .select("*")
        .eq("id", requestQueueId)
        .maybeSingle();
    } else if (typeof body.url === "string") {
      // Backward-compatible fallback for manual/internal calls.
      // process-queued-articles should now call with queue_id only.
      const normalizedUrl = normalizeInputUrl(body.url);
      if (!normalizedUrl) {
        return jsonResponse(400, {
          error: "Invalid URL.",
          request_id: requestId,
        });
      }

      const queueUrlKey = makeQueueUrlKey(normalizedUrl).key;
      queueLookup = await supabase
        .from("article_queue")
        .select("*")
        .eq("url", queueUrlKey)
        .maybeSingle();
    } else {
      return jsonResponse(400, {
        error: "Missing required field: queue_id",
        request_id: requestId,
      });
    }

    if (queueLookup.error) {
      return jsonResponse(500, {
        error: "Database error loading queue row.",
        details: queueLookup.error.message,
        request_id: requestId,
      });
    }

    if (!queueLookup.data) {
      return jsonResponse(404, {
        error: "Queue row not found.",
        request_id: requestId,
      });
    }

    const queueRow = queueLookup.data as Record<string, unknown>;
    const resolvedQueueId = typeof queueRow.id === "string" ? queueRow.id : null;
    const storedQueueUrl = typeof queueRow.url === "string" ? queueRow.url : null;
    const queueStatus = typeof queueRow.status === "string" ? queueRow.status : null;
    const alreadyRequested = queueRow.remote_requested_at !== null;

    if (!resolvedQueueId) {
      return jsonResponse(500, {
        error: "Queue row missing id.",
        request_id: requestId,
      });
    }

    if (!storedQueueUrl) {
      return jsonResponse(500, {
        error: "Queue row missing url.",
        request_id: requestId,
      });
    }

    const dispatchableStatuses = new Set(["queued", "deferred"]);

    if (!dispatchableStatuses.has(queueStatus ?? "") || alreadyRequested) {
      return jsonResponse(200, {
        did_call_remote: false,
        fly_scale: flyScaleRes.fly_scale,
        dispatch_result: {
          ok: false,
          reason: alreadyRequested ? "already_requested" : "queue_not_dispatchable",
          queue_status: queueStatus,
        },
        queue: queueRow,
        request_id: requestId,
      });
    }

    const storedPrefetched = normalizePrefetched(queueRow.investigation_prepass_results);
    const requestPrefetched = normalizePrefetched(body.prefetched);
    const prefetched = storedPrefetched ?? requestPrefetched;

    if (queueRow.investigation_prepass_results && !storedPrefetched) {
      logError(requestId, "prefetched.normalize_failed", {
        queue_id: resolvedQueueId,
      });
    }

    const rawUrl = normalizeQueueUrlToRawUrl(storedQueueUrl);
    if (!rawUrl) {
      return jsonResponse(500, {
        error: "Queue row url could not be normalized.",
        queue_url: storedQueueUrl,
        request_id: requestId,
      });
    }

    let didCallRemote = false;
    let dispatchResult: Record<string, unknown> | null = null;
    let reservationId: string | null = null;
    let machineIdForCleanup: string | null = null;
    let leaseNonceForCleanup: string | null = null;

    const slotRes = await acquireDispatchSlot({
      supabase,
      queueId: resolvedQueueId,
      requestId,
      ttlSeconds: 90,
    });

    if (!slotRes.ok || !slotRes.reservation_id) {
      dispatchResult = {
        ok: false,
        reason: slotRes.reason ?? "capacity_reached",
        slot_result: slotRes,
      };
    } else {
      reservationId = slotRes.reservation_id;

      const markRes = await supabase
        .from("article_queue")
        .update({ remote_requested_at: new Date().toISOString() })
        .eq("id", resolvedQueueId)
        .in("status", ["queued", "deferred"])
        .is("remote_requested_at", null)
        .select("id")
        .maybeSingle();

      if (markRes.error) {
        await releaseDispatchSlot({
          supabase,
          reservationId,
          requestId,
          reason: "queue_mark_remote_requested_error",
        });

        return jsonResponse(500, {
          error: "Database error marking queue row as remotely requested.",
          details: markRes.error.message,
          request_id: requestId,
        });
      }

      if (!markRes.data) {
        dispatchResult = {
          ok: false,
          reason: "queue_row_already_claimed",
        };

        await releaseDispatchSlot({
          supabase,
          reservationId,
          requestId,
          reason: "queue_row_already_claimed",
        });
      } else {
        try {
          const claimRes = await claimPooledMachine({
            flyApiHostname,
            flyToken,
            appName,
            requestId,
          });

          if (!claimRes.ok) {
            dispatchResult = {
              ok: false,
              reason: claimRes.reason ?? "claim_failed",
              claim_result: claimRes,
            };
          } else {
            machineIdForCleanup = claimRes.machine_id;
            leaseNonceForCleanup = claimRes.lease_nonce;

            const startRes = await startClaimedMachine({
              flyApiHostname,
              flyToken,
              appName,
              machineId: claimRes.machine_id,
              leaseNonce: claimRes.lease_nonce,
            });

            if (!startRes.ok) {
              dispatchResult = {
                ok: false,
                reason: startRes.reason ?? "start_failed",
                start_result: startRes,
              };
            } else {
              const enqueuePayload = buildEnqueuePayload(rawUrl, prefetched);

              const healthRes = await waitForCoordinatorHealth({
                baseUrl: coordinatorBaseUrl,
                healthPath,
                timeoutMs: Number.isFinite(healthTimeoutMs) ? healthTimeoutMs : 30000,
                intervalMs: Number.isFinite(healthIntervalMs) ? healthIntervalMs : 500,
                machineId: claimRes.machine_id,
                requestId,
              });

              if (!healthRes.ok) {
                dispatchResult = {
                  ok: false,
                  reason: healthRes.reason ?? "health_timeout",
                  health_result: healthRes,
                };
              } else {
                const enqueueRes = await enqueueCoordinatorJob({
                  baseUrl: coordinatorBaseUrl,
                  enqueuePath,
                  apiKey: pepeApiKey,
                  payload: enqueuePayload,
                  machineId: claimRes.machine_id,
                });

                if (!enqueueRes.ok) {
                  dispatchResult = {
                    ok: false,
                    reason: enqueueRes.reason ?? "enqueue_failed",
                    enqueue_result: enqueueRes,
                  };
                } else {
                  didCallRemote = true;
                  dispatchResult = {
                    ok: true,
                    machine_id: claimRes.machine_id,
                    slot_result: slotRes,
                    start_result: startRes,
                    health_result: healthRes,
                    enqueue_result: enqueueRes,
                    used_prefetched: prefetched != null,
                  };

                  const markDispatchedRes = await markDispatchSlotDispatched({
                    supabase,
                    reservationId,
                    machineId: claimRes.machine_id,
                    enqueuePayload,
                    ttlSeconds: 900,
                  });

                  if (!markDispatchedRes.ok) {
                    logError(requestId, "db.dispatch_slot.mark_dispatched.error", {
                      reservation_id: reservationId,
                      result: markDispatchedRes,
                    });
                  }
                }
              }
            }
          }
        } finally {
          if (!didCallRemote) {
            await clearRemoteRequestedAt({
              supabase,
              queueId: resolvedQueueId,
              requestId,
              reason:
                dispatchResult && typeof dispatchResult.reason === "string"
                  ? dispatchResult.reason
                  : "remote_not_dispatched",
            });

            if (reservationId) {
              await releaseDispatchSlot({
                supabase,
                reservationId,
                requestId,
                reason:
                  dispatchResult && typeof dispatchResult.reason === "string"
                    ? dispatchResult.reason
                    : "remote_not_dispatched",
              });
            }
          }

          if (machineIdForCleanup && leaseNonceForCleanup) {
            await releaseFlyMachineLease(
              flyApiHostname,
              flyToken,
              appName,
              machineIdForCleanup,
              leaseNonceForCleanup,
            );
          }
        }
      }
    }

    const finalQueueRes = await supabase
      .from("article_queue")
      .select("*")
      .eq("id", resolvedQueueId)
      .maybeSingle();

    return jsonResponse(200, {
      did_call_remote: didCallRemote,
      fly_scale: flyScaleRes.fly_scale,
      dispatch_result: dispatchResult,
      queue: finalQueueRes.data ?? queueRow,
      request_id: requestId,
    });
  } catch (error) {
    logError(requestId, "request.unhandled_exception", {
      error: serializeError(error),
    });

    return jsonResponse(500, {
      error: "Unhandled edge function error.",
      request_id: requestId,
    });
  }
});