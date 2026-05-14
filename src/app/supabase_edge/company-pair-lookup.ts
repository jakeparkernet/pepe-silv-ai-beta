import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

const SCRAPE_PAGE_URL = Deno.env.get("SCRAPE_PAGE_URL") || "";
const SCRAPE_LAMBDA_ARN = Deno.env.get("SCRAPE_PAGE_ARN") || "scrape_page";
const GET_LLM_RESPONSE_URL = Deno.env.get("GET_LLM_RESPONSE_URL") || "";
const LLM_LAMBDA_ARN = Deno.env.get("GET_LLM_RESPONSE_ARN") || "get_llm_response";
const PEPE_EDGE_KEY = Deno.env.get("PEPE_EDGE_KEY") || "";
const AWS_REGION = Deno.env.get("AWS_DEFAULT_REGION_LAMBDA") || "us-east-2";

type CompanyInput = {
  name: string;
  context: string;
};

type EntityCandidate = {
  id: string;
  name: string;
  aliases: string[];
  entity_type: string;
  tags: string[];
  context: string;
  flatname: string;
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
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeLettersOnly(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
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

function parseMoneySetting(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return fallback;
}

function getWeaviateConfig() {
  let url = (Deno.env.get("WEAVIATE_URL") ?? "").trim();
  const apiKey = Deno.env.get("WEAVIATE_API_KEY") ?? Deno.env.get("WEAVIATE_APIKEY") ?? "";
  if (url && !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url)) {
    url = `https://${url}`;
  }
  if (url) {
    try {
      url = new URL(url).toString().replace(/\/+$/, "");
    } catch {
      return null;
    }
  }
  return url && apiKey ? { url, apiKey } : null;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

async function invokeFunctionUrl(url: string, payload: Record<string, unknown>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (PEPE_EDGE_KEY) {
    headers["x-pepe-edge-key"] = PEPE_EDGE_KEY;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Function URL call failed: ${response.status} - ${text}`);
  }
  const parsed = text ? JSON.parse(text) : null;
  if (parsed && typeof parsed === "object" && typeof parsed.body === "string") {
    return JSON.parse(parsed.body);
  }
  return parsed;
}

async function invokeScrape(url: string) {
  if (SCRAPE_PAGE_URL) {
    return await invokeFunctionUrl(SCRAPE_PAGE_URL, { url });
  }

  const awsAccessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID_LAMBDA");
  const awsSecretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY_LAMBDA");
  if (!awsAccessKeyId || !awsSecretAccessKey) {
    throw new Error("AWS credentials not configured");
  }
  const endpoint = `https://lambda.${AWS_REGION}.amazonaws.com/2015-03-31/functions/${SCRAPE_LAMBDA_ARN}/invocations`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Basic " + btoa(`${awsAccessKeyId}:${awsSecretAccessKey}`),
    },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    throw new Error(`Scrape Lambda failed: ${response.status} - ${await response.text()}`);
  }
  return await response.json();
}

async function expandContext(company: CompanyInput) {
  if (!company.context || !isHttpUrl(company.context)) {
    return company;
  }

  const scrapeRaw = await invokeScrape(company.context);
  const scrapedText = typeof scrapeRaw?.result?.result === "string" ? scrapeRaw.result.result : "";
  return {
    ...company,
    context: [company.context, scrapedText].filter(Boolean).join("\n\n").slice(0, 16000),
  };
}

async function invokeGenericLlm(systemMessage: string, userMessage: string) {
  const payload = {
    model: "x-ai/grok-4.1-fast",
    system_message: systemMessage,
    user_message: userMessage,
  };
  if (GET_LLM_RESPONSE_URL) {
    const res = await invokeFunctionUrl(GET_LLM_RESPONSE_URL, payload);
    if (res.status_code !== 200 || typeof res.result !== "string") {
      throw new Error(`LLM call failed: ${JSON.stringify(res)}`);
    }
    return res.result;
  }

  const awsAccessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID_LAMBDA");
  const awsSecretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY_LAMBDA");
  if (!awsAccessKeyId || !awsSecretAccessKey) {
    throw new Error("AWS credentials not configured");
  }
  const endpoint = `https://lambda.${AWS_REGION}.amazonaws.com/2015-03-31/functions/${LLM_LAMBDA_ARN}/invocations`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Basic " + btoa(`${awsAccessKeyId}:${awsSecretAccessKey}`),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`LLM call failed: ${response.status} - ${await response.text()}`);
  }
  const parsed = await response.json();
  if (parsed.status_code !== 200 || typeof parsed.result !== "string") {
    throw new Error(`LLM call failed: ${JSON.stringify(parsed)}`);
  }
  return parsed.result;
}

async function queryWeaviateEntities(query: string): Promise<EntityCandidate[]> {
  const config = getWeaviateConfig();
  if (!config) return [];

  const response = await fetch(`${config.url}/v1/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) return [];

  const json = await response.json();
  const entities = json?.data?.Get?.Entity || [];
  return entities
    .map((entity: Record<string, unknown>) => ({
      id: typeof entity.uuid === "string" ? entity.uuid : "",
      name: typeof entity.name === "string" ? entity.name : "",
      aliases: Array.isArray(entity.aliases) ? entity.aliases.filter((alias) => typeof alias === "string") as string[] : [],
      entity_type: typeof entity.entity_type === "string" ? entity.entity_type : "ORG",
      tags: Array.isArray(entity.tags) ? entity.tags.filter((tag) => typeof tag === "string") as string[] : [],
      context: typeof entity.context === "string" ? entity.context : "",
      flatname: typeof entity.flatname === "string" ? entity.flatname : normalizeLettersOnly(String(entity.name ?? "")),
    }))
    .filter((entity: EntityCandidate) => entity.id && entity.name);
}

async function getEntitiesByName(name: string) {
  const byName = await queryWeaviateEntities(`{
    Get {
      Entity(where: { path: ["name"], operator: Equal, valueString: ${JSON.stringify(name)} }) {
        uuid name aliases entity_type tags context flatname
      }
    }
  }`);
  if (byName[0]) return byName[0];

  const byFlatName = await queryWeaviateEntities(`{
    Get {
      Entity(where: { path: ["flatname"], operator: Equal, valueString: ${JSON.stringify(normalizeLettersOnly(name))} }) {
        uuid name aliases entity_type tags context flatname
      }
    }
  }`);
  return byFlatName[0] ?? null;
}

async function getEntitiesWithAlias(alias: string) {
  return await queryWeaviateEntities(`{
    Get {
      Entity(where: { path: ["aliases"], operator: ContainsAny, valueText: ${JSON.stringify([alias])} }) {
        uuid name aliases entity_type tags context flatname
      }
    }
  }`);
}

async function getEntitiesLike(pattern: string) {
  return await queryWeaviateEntities(`{
    Get {
      Entity(where: { path: ["name"], operator: Like, valueString: ${JSON.stringify(pattern)} }) {
        uuid name aliases entity_type tags context flatname
      }
    }
  }`);
}

async function getEntitiesNearText(text: string) {
  return await queryWeaviateEntities(`{
    Get {
      Entity(nearText: { concepts: [${JSON.stringify(text)}] }) {
        uuid name aliases entity_type tags context flatname
      }
    }
  }`);
}

function dedupeCandidates(candidates: EntityCandidate[]) {
  return [...new Map(candidates.map((entity) => [entity.id, entity])).values()];
}

async function selectMostLikelyEntity(company: CompanyInput, candidates: EntityCandidate[]) {
  if (candidates.length === 0) return null;
  const raw = await invokeGenericLlm(
    "You are a strict entity selection engine. Return only JSON.",
    `Select the best matching entity for QUERY using only the supplied data. Prefer false negatives over false positives. Return {"entities":[{"id":ID,"name":NAME,"confidence":0..1}]} or {"entities":[]}.\n\nQUERY:\n${JSON.stringify(company)}\n\nENTITIES:\n${JSON.stringify(candidates)}`,
  );
  const parsed = JSON.parse(raw);
  const ranked = Array.isArray(parsed.entities) ? parsed.entities : [];
  const top = ranked
    .filter((entity: Record<string, unknown>) => typeof entity.id === "string" && typeof entity.confidence === "number")
    .sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
      (Number(b.confidence) || 0) - (Number(a.confidence) || 0)
    )[0] as { id: string; confidence: number } | undefined;
  if (!top || top.confidence < 0.75) return null;
  return candidates.find((entity) => entity.id === top.id) ?? null;
}

async function resolveExistingEntity(company: CompanyInput) {
  const byName = await getEntitiesByName(company.name);
  if (byName) return byName;

  const aliases = await getEntitiesWithAlias(company.name);
  if (aliases.length === 1) return aliases[0];

  const like = await getEntitiesLike(company.name);
  if (like.length === 1) return like[0];

  const firstToken = company.name.split(/\s+/, 1)[0]?.slice(0, 8) ?? company.name;
  const candidates = dedupeCandidates([
    ...aliases,
    ...like,
    ...await getEntitiesLike(`*${company.name}*`),
    ...await getEntitiesLike(`${firstToken}*`),
    ...await getEntitiesNearText(`${company.name}\n${company.context}`.trim()),
  ]);

  return await selectMostLikelyEntity(company, candidates);
}

async function getAuthenticatedUser(req: Request, supabaseUrl: string, serviceRole: string) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data.user ?? null;
}

async function findExistingOwnershipTree(supabase: ReturnType<typeof createClient>, companyAId: string, companyBId: string) {
  const scanResponse = await supabase.from("ownership_trees").select("id, company_a, company_b");
  if (scanResponse.error || !scanResponse.data) {
    throw new Error(scanResponse.error?.message ?? "ownership tree lookup failed");
  }

  const matched = scanResponse.data.find((row: Record<string, unknown>) =>
    (row.company_a === companyAId && row.company_b === companyBId) ||
    (row.company_a === companyBId && row.company_b === companyAId)
  );
  if (!matched?.id) return null;

  const rowResponse = await supabase
    .from("ownership_trees")
    .select("id, company_a, company_b, ownership_tree, investigation_data, summary")
    .eq("id", matched.id)
    .maybeSingle();
  if (rowResponse.error) {
    throw new Error(rowResponse.error.message);
  }
  return rowResponse.data ?? null;
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return respond(origin, 405, { ok: false, error: "Method Not Allowed" });
  }

  let lookupReservationId: string | null = null;
  let supabaseForReservation: ReturnType<typeof createClient> | null = null;

  try {
    const body = await req.json();
    const companyAInput = normalizeCompany(body.company_a);
    const companyBInput = normalizeCompany(body.company_b);
    if (!companyAInput || !companyBInput) {
      return respond(origin, 400, { ok: false, error: "company_a.name and company_b.name are required" });
    }
    if (companyAInput.name.toLowerCase() === companyBInput.name.toLowerCase()) {
      return respond(origin, 400, { ok: false, error: "company_a.name and company_b.name must be different" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRole) {
      return respond(origin, 500, { ok: false, error: "Missing Supabase service configuration" });
    }

    const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
    supabaseForReservation = supabase;
    const settings = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["company_pair_search_requires_paid_lookup", "company_pair_lookup_cost_usd"]);
    if (settings.error) {
      return respond(origin, 500, { ok: false, error: settings.error.message });
    }
    const settingsByKey = new Map((settings.data ?? []).map((row) => [row.key, row.value]));
    const requiresAuth = parseBooleanSetting(settingsByKey.get("company_pair_search_requires_paid_lookup"), false);
    const lookupCostUsd = parseMoneySetting(settingsByKey.get("company_pair_lookup_cost_usd"), 0);
    const user = await getAuthenticatedUser(req, supabaseUrl, serviceRole);
    if (requiresAuth && !user) {
      return respond(origin, 401, { ok: false, error: "Sign in required for this search" });
    }

    const finish = async (status: number, body: Record<string, unknown>) => {
      if (lookupReservationId && status >= 200 && status < 300) {
        const settle = await supabase.rpc("settle_credit_reservation", {
          p_reservation_id: lookupReservationId,
          p_actual_amount_usd: lookupCostUsd,
          p_metadata: {
            request_type: "company_pair_lookup",
            company_a_name: companyAInput.name,
            company_b_name: companyBInput.name,
          },
        });
        if (settle.error) {
          await supabase.rpc("release_credit_reservation", {
            p_reservation_id: lookupReservationId,
            p_metadata: { reason: "lookup_settlement_failed" },
          });
          return respond(origin, 500, { ok: false, error: settle.error.message });
        }
      }

      return respond(origin, status, {
        ...body,
        lookup_cost_usd: lookupReservationId ? lookupCostUsd : 0,
      });
    };

    if (requiresAuth && lookupCostUsd > 0) {
      const reserve = await supabase.rpc("reserve_user_credits", {
        p_user_id: user!.id,
        p_amount_usd: lookupCostUsd,
        p_request_id: null,
        p_metadata: {
          request_type: "company_pair_lookup",
          company_a_name: companyAInput.name,
          company_b_name: companyBInput.name,
        },
      });
      if (reserve.error || !reserve.data) {
        return respond(origin, 402, {
          ok: false,
          error: "Not enough credits for this paid lookup",
          details: reserve.error?.message ?? null,
        });
      }
      lookupReservationId = reserve.data;
    }

    if (!getWeaviateConfig()) {
      if (lookupReservationId) {
        await supabase.rpc("release_credit_reservation", {
          p_reservation_id: lookupReservationId,
          p_metadata: { reason: "missing_weaviate_configuration" },
        });
      }
      return respond(origin, 500, { ok: false, error: "Missing Weaviate configuration" });
    }

    const [companyA, companyB] = await Promise.all([
      expandContext(companyAInput),
      expandContext(companyBInput),
    ]);
    const [entityA, entityB] = await Promise.all([
      resolveExistingEntity(companyA),
      resolveExistingEntity(companyB),
    ]);

    if (!entityA || !entityB) {
      return await finish(200, {
        ok: true,
        status: "research_required",
        reason: !entityA && !entityB ? "entities_missing" : "entity_missing",
        research_available: true,
        message: "This common-influence search has not been researched yet. Sign in and buy credits to request it.",
        company_a: companyA,
        company_b: companyB,
        company_a_entity: entityA,
        company_b_entity: entityB,
      });
    }

    const ownershipTreeRow = await findExistingOwnershipTree(supabase, entityA.id, entityB.id);
    if (!ownershipTreeRow) {
      return await finish(200, {
        ok: true,
        status: "research_required",
        reason: "ownership_tree_missing",
        research_available: true,
        message: "This common-influence search has not been researched yet. Sign in and buy credits to request it.",
        company_a: companyA,
        company_b: companyB,
        company_a_entity: entityA,
        company_b_entity: entityB,
      });
    }

    return await finish(200, {
      ok: true,
      status: "complete",
      research_available: false,
      company_a: companyAInput,
      company_b: companyBInput,
      company_a_entity: entityA,
      company_b_entity: entityB,
      ownership_tree_id: ownershipTreeRow.id,
      ownership_tree_row: ownershipTreeRow,
    });
  } catch (error) {
    if (lookupReservationId && supabaseForReservation) {
      try {
        await supabaseForReservation.rpc("release_credit_reservation", {
          p_reservation_id: lookupReservationId,
          p_metadata: { reason: "lookup_failed" },
        });
      } catch {
        // Best-effort cleanup; preserve the original lookup error response.
      }
    }
    return respond(origin, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
