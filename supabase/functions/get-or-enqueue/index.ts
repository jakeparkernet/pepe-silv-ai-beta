import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
// ==================== CORS CONFIG ====================
const ALLOWED_ORIGINS = new Set((Deno.env.get("ALLOWED_ORIGINS") ?? "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173,https://pepesilv.ai,https://www.pepesilv.ai").split(",").map((o)=>o.trim()).filter(Boolean));
// Add your Chrome extension ID here (or via env var)
const CHROME_EXTENSION_ID = Deno.env.get("CHROME_EXTENSION_ID") ?? ""; // e.g. "abc123def456..."
if (CHROME_EXTENSION_ID) {
  ALLOWED_ORIGINS.add(`chrome-extension://${CHROME_EXTENSION_ID}`);
}
function getCorsHeaders(requestOrigin) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-key",
    "Access-Control-Max-Age": "86400"
  };
  if (requestOrigin && ALLOWED_ORIGINS.has(requestOrigin)) {
    headers["Access-Control-Allow-Origin"] = requestOrigin;
    // Optional but recommended for security
    headers["Vary"] = "Origin";
  } else {
    // Not allowed → no CORS header (browser will block)
    return {};
  }
  return headers;
}
function makeRequestId() {
  return crypto.randomUUID().slice(0, 8);
}
function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null
    };
  }
  return {
    message: String(error)
  };
}
function logInfo(requestId, step, details = {}) {
  console.log(JSON.stringify({
    level: "info",
    request_id: requestId,
    step,
    ...details
  }));
}
function logError(requestId, step, details = {}) {
  console.error(JSON.stringify({
    level: "error",
    request_id: requestId,
    step,
    ...details
  }));
}
function jsonResponse(status, body, extraHeaders = {}, origin = null) {
  const corsHeaders = getCorsHeaders(origin);
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders
    }
  });
}
function normalizeInputUrl(raw) {
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
  } catch  {
    return null;
  }
}
function getSiteDomain(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const parts = host.split(".").filter((p)=>p.length > 0);
  if (parts.length <= 2) return host;
  const multiPartTlds = new Set([
    "co.uk",
    "org.uk",
    "ac.uk",
    "gov.uk",
    "com.au",
    "net.au",
    "org.au",
    "co.nz",
    "com.br",
    "com.mx",
    "co.jp"
  ]);
  const last2 = parts.slice(-2).join(".");
  if (multiPartTlds.has(last2) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}
function makeQueueUrlKey(rawUrl) {
  const u = new URL(rawUrl);
  const isDefaultPort = u.protocol === "https:" && (u.port === "" || u.port === "443") || u.protocol === "http:" && (u.port === "" || u.port === "80");
  const hostNoWww = u.hostname.toLowerCase().replace(/^www\./, "");
  const hostWithPort = isDefaultPort ? hostNoWww : `${hostNoWww}:${u.port}`;
  let path = u.pathname || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  return {
    hostname: hostWithPort,
    key: `${hostWithPort}${path}`
  };
}
async function safeFetchJson(url, init) {
  try {
    const res = await fetch(url, init);
    const bodyText = await res.text();
    let bodyJson = null;
    try {
      bodyJson = bodyText.length > 0 ? JSON.parse(bodyText) : null;
    } catch  {
      bodyJson = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      bodyText,
      bodyJson
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 0,
      bodyText: message,
      bodyJson: null
    };
  }
}
const SCRAPE_LAMBDA_ARN = Deno.env.get("SCRAPE_PAGE_ARN") || "scrape_page";
const LLM_LAMBDA_ARN = Deno.env.get("GET_LLM_RESPONSE_ARN") || "get_llm_response";
const SCRAPE_PAGE_URL = Deno.env.get("SCRAPE_PAGE_URL") || "";
const GET_LLM_RESPONSE_URL = Deno.env.get("GET_LLM_RESPONSE_URL") || "";
const PEPE_EDGE_KEY = Deno.env.get("PEPE_EDGE_KEY") || "";
const AWS_REGION = Deno.env.get("AWS_DEFAULT_REGION_LAMBDA") || "us-east-2";
// DEBUG ONLY:
// When enabled, fail fast if the edge prepass resolves an article subject but does
// not find an existing ownership tree. This is temporary instrumentation to catch
// entity-resolution mismatches between the edge prepass and the Python job.
// Remove after debugging.
const DEBUG_THROW_IF_OWNERSHIP_TREE_MISSING = false;
function getWeaviateConfig() {
  let url = (Deno.env.get("WEAVIATE_URL") ?? "").trim();
  const apiKey = Deno.env.get("WEAVIATE_API_KEY") ?? Deno.env.get("WEAVIATE_APIKEY") ?? "";
  if (url && !/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url)) {
    url = `https://${url}`;
  }
  if (url) {
    try {
      url = new URL(url).toString().replace(/\/+$/, "");
    } catch  {
      return null;
    }
  }
  if (!url || !apiKey) {
    return null;
  }
  return {
    url,
    apiKey
  };
}
async function invokeFunctionUrl(url, payload) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (PEPE_EDGE_KEY) {
    headers["x-pepe-edge-key"] = PEPE_EDGE_KEY;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Function URL call failed: ${response.status} - ${text}`);
  }
  let parsed = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch  {
    throw new Error(`Function URL returned non-JSON response: ${text}`);
  }
  if (parsed && typeof parsed === "object" && "body" in parsed && typeof parsed.body === "string") {
    const bodyText = parsed.body;
    return JSON.parse(bodyText);
  }
  return parsed;
}
function parseJsonText(text) {
  return JSON.parse(text);
}
function getFirstWord(text) {
  if (text == null) return null;
  return text.length > 0 ? text.split(/\s+/, 1)[0] : text;
}
function getSearchableNamePrefix(searchName, maxChars = 0) {
  const firstName = getFirstWord(searchName) ?? "";
  if (maxChars > 0) {
    return firstName.slice(0, maxChars);
  }
  return firstName;
}
async function invokeGenericLlm(systemMessage, userMessage) {
  const payload = {
    model: "x-ai/grok-4.1-fast",
    system_message: systemMessage,
    user_message: userMessage
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
  const authHeader = "Basic " + btoa(`${awsAccessKeyId}:${awsSecretAccessKey}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Generic LLM call failed: ${response.status} - ${errorText}`);
  }
  const parsed = await response.json();
  if (parsed.status_code !== 200 || typeof parsed.result !== "string") {
    throw new Error(`LLM call failed: ${JSON.stringify(parsed)}`);
  }
  return parsed.result;
}
async function compareEntitiesStrict(args) {
  const systemMessage = `
            You are a strict entity-resolution judge.

            Goal: Decide whether TARGET_ENTITY and SOURCE_ENTITY refer to the exact same real-world entity.

            Rules:
            - Use ONLY the information explicitly present in the two entities (name, tags, context, and any other provided fields).
            - Do NOT use outside knowledge or assumptions.
            - Prefer false negatives over false positives. If evidence is insufficient, uncertainty must reduce confidence.
            - Different subsidiaries/brands/people/locations are NOT the same entity unless the provided data explicitly proves identity.
            - Names can be similar; similarity alone is not proof.
            - If there is any plausible ambiguity, you must lower confidence.

            Output:
            - Return ONLY valid JSON.
            - JSON must have exactly these keys:
            - "same_entity": boolean
            - "confidence": number between 0 and 1 inclusive
            - "confidence" means P(same_entity is true) given ONLY the provided data.
            - No extra keys, no prose, no markdown, no trailing comments.
            `;
  const userMessage = `
            Task: Determine whether TARGET_ENTITY and SOURCE_ENTITY are the same entity.

            Interpretation constraints:
            - Treat all strings literally.
            - Consider "name" as weak evidence unless supported by tags/context/other fields.
            - If either entity lacks enough detail to prove identity, respond with same_entity=false and a low-to-moderate confidence.
            - Be absolutely sure to return same_entity=true only when the provided properties strongly and unambiguously match.

            Decision guidance (not exhaustive):
            - Strong positive evidence examples: identical unique identifiers, identical website/domain, identical address, identical parent org explicitly stated, identical ticker/registration ID, identical very specific tags/context that match.
            - Strong negative evidence examples: conflicting locations, different industry/type, different parent, different identifiers, incompatible descriptions.

            Return ONLY JSON:
            {"same_entity": <true|false>, "confidence": <0..1>}

            TARGET_ENTITY:
            ${JSON.stringify(args.targetEntity)}

            SOURCE_ENTITY:
            ${JSON.stringify(args.sourceEntity)}
            `;
  const raw = await invokeGenericLlm(systemMessage, userMessage);
  const parsed = parseJsonText(raw);
  return {
    same_entity: parsed.same_entity === true,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0
  };
}
async function selectMostLikelyEntity(args) {
  const systemMessage = `
            You are a strict entity selection engine.

            Goal:
            Select up to 3 entities from the provided Entities list that most likely refer to the same intended entity as QUERY_NAME, using only the provided data.

            Rules:
            - Use ONLY the information in this prompt and the Entities list. Do not use outside knowledge.
            - Prefer false negatives over false positives. If no entity is a strong match, return an empty entities array.
            - Similar names alone are not sufficient. Tags/context must not contradict.
            - If there is any plausible ambiguity (multiple candidates fit similarly, or evidence is weak), reduce confidence.

            Scoring:
            - confidence is a number from 0 to 1 representing P(this candidate is the intended match | provided data).
            - Only include candidates with confidence >= 0.55. If none meet this threshold, return {"entities": []}.
            - Rank candidates by confidence descending. Return at most 3.

            Output:
            Return ONLY valid JSON with exactly this shape:
            {"entities":[{"id":ID,"name":NAME,"confidence":CONFIDENCE}, ...]}
            No extra keys, no prose, no markdown.
            `;
  const userMessage = `
            Task:
            Given QUERY_NAME and QUERY_TAGS, choose the best matching entities from Entities list. The correct match may be absent.

            QUERY_NAME:
            ${args.entityName}

            QUERY_TAGS:
            ${JSON.stringify(args.tags ?? [])}

            Decision criteria (use all that apply):
            - Name match strength: exact match, prefix match, substring match, token overlap, common abbreviations (only if evidenced in context/tags).
            - Tag alignment: overlapping or compatible tags increase confidence; conflicting tags decrease confidence sharply.
            - Context alignment: if context strongly suggests a different domain/meaning, lower confidence.
            - Ambiguity: if multiple entities could match, lower confidence for all; do NOT guess.

            Return:
            Return ONLY JSON in this exact format:
            {"entities": [{"id": ID, "name": NAME, "confidence": YOUR_CONFIDENCE_SCORE},
                        {"id": ID, "name": NAME, "confidence": YOUR_CONFIDENCE_SCORE},
                        {"id": ID, "name": NAME, "confidence": YOUR_CONFIDENCE_SCORE}]}

            If no candidate is strong enough, return:
            {"entities": []}

            Entities list:
            ${JSON.stringify(args.entities)}
            `;
  const raw = await invokeGenericLlm(systemMessage, userMessage);
  const parsed = parseJsonText(raw);
  const resultEntities = Array.isArray(parsed.entities) ? parsed.entities : [];
  if (resultEntities.length === 0) {
    return null;
  }
  const sorted = resultEntities.filter((entity)=>typeof entity.id === "string" && typeof entity.confidence === "number").sort((a, b)=>(b.confidence ?? 0) - (a.confidence ?? 0));
  const top = sorted[0];
  if (!top || (top.confidence ?? 0) < args.minConfidence) {
    return null;
  }
  return args.entities.find((entity)=>entity.id === top.id) ?? null;
}
async function queryWeaviateEntities(query) {
  const weaviateConfig = getWeaviateConfig();
  if (!weaviateConfig) {
    return {
      entities: [],
      ok: false,
      status: null,
      errors: [
        {
          message: "Missing Weaviate configuration"
        }
      ]
    };
  }
  const response = await fetch(`${weaviateConfig.url}/v1/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${weaviateConfig.apiKey}`
    },
    body: JSON.stringify({
      query
    })
  });
  if (!response.ok) {
    return {
      entities: [],
      ok: false,
      status: response.status,
      errors: [
        {
          message: "Non-OK Weaviate response"
        }
      ]
    };
  }
  const json = await response.json();
  const entities = json?.data?.Get?.Entity || [];
  return {
    entities: entities.map((entity)=>({
        id: typeof entity.uuid === "string" ? entity.uuid : "",
        name: typeof entity.name === "string" ? entity.name : "",
        aliases: Array.isArray(entity.aliases) ? entity.aliases.filter((alias)=>typeof alias === "string") : [],
        entity_type: typeof entity.entity_type === "string" ? entity.entity_type : "ORG",
        tags: Array.isArray(entity.tags) ? entity.tags.filter((tag)=>typeof tag === "string") : [],
        context: typeof entity.context === "string" ? entity.context : "",
        flatname: typeof entity.flatname === "string" ? entity.flatname : normalizeLettersOnly(typeof entity.name === "string" ? entity.name : "")
      })).filter((entity)=>entity.id.length > 0 && entity.name.length > 0),
    ok: true,
    status: response.status,
    errors: Array.isArray(json?.errors) ? json.errors : null
  };
}
async function queryWeaviateJson(query) {
  const weaviateConfig = getWeaviateConfig();
  if (!weaviateConfig) {
    return {
      ok: false,
      status: null,
      data: null,
      errors: [
        {
          message: "Missing Weaviate configuration"
        }
      ]
    };
  }
  const response = await fetch(`${weaviateConfig.url}/v1/graphql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${weaviateConfig.apiKey}`
    },
    body: JSON.stringify({
      query
    })
  });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
      errors: [
        {
          message: "Non-OK Weaviate response"
        }
      ]
    };
  }
  const json = await response.json();
  return {
    ok: true,
    status: response.status,
    data: json?.data ?? null,
    errors: Array.isArray(json?.errors) ? json.errors : null
  };
}
async function resolveNewsSiteEntity(args) {
  const queries = [
    `{
      Get {
        NewsSite(where: {
          path: ["uuid"]
          operator: Equal
          valueString: ${JSON.stringify(args.newsSiteId)}
        }) {
          uuid
          domain
          entity {
            ... on Entity {
              uuid
              name
            }
          }
        }
      }
    }`,
    `{
      Get {
        NewsSite(where: {
          path: ["domain"]
          operator: Equal
          valueString: ${JSON.stringify(args.domain)}
        }) {
          uuid
          domain
          entity {
            ... on Entity {
              uuid
              name
            }
          }
        }
      }
    }`
  ];
  for (const [index, query] of queries.entries()){
    const result = await queryWeaviateJson(query);
    const rows = result.data?.Get?.NewsSite ?? [];
    if (args.requestId) {
      logInfo(args.requestId, "edge.pre_investigation.resolve_news_site_entity.query", {
        lookup: index === 0 ? "by_news_site_id" : "by_domain",
        requested_news_site_id: args.newsSiteId,
        requested_domain: args.domain,
        ok: result.ok,
        status: result.status,
        count: rows.length,
        errors: result.errors
      });
    }
    if (rows.length === 0) {
      continue;
    }
    const row = rows[0];
    const entityRefs = Array.isArray(row.entity) ? row.entity : [];
    const firstEntity = entityRefs[0];
    return {
      newsSiteId: typeof row.uuid === "string" ? row.uuid : null,
      newsSiteDomain: typeof row.domain === "string" ? row.domain : null,
      entityId: typeof firstEntity?.uuid === "string" ? firstEntity.uuid : null,
      entityName: typeof firstEntity?.name === "string" ? firstEntity.name : null
    };
  }
  return {
    newsSiteId: null,
    newsSiteDomain: null,
    entityId: null,
    entityName: null
  };
}
async function getEntitiesByNameWeaviate(name) {
  const queries = [
    `{
      Get {
        Entity(where: {
          path: ["name"]
          operator: Equal
          valueString: ${JSON.stringify(name)}
        }) {
          uuid
          name
          aliases
          entity_type
          tags
          context
          flatname
        }
      }
    }`,
    `{
      Get {
        Entity(where: {
          path: ["flatname"]
          operator: Equal
          valueString: ${JSON.stringify(normalizeLettersOnly(name))}
        }) {
          uuid
          name
          aliases
          entity_type
          tags
          context
          flatname
        }
      }
    }`
  ];
  for (const query of queries){
    const result = await queryWeaviateEntities(query);
    if (result.entities.length > 0) {
      return result.entities[0];
    }
  }
  return null;
}
async function getEntitiesWithAliasWeaviate(alias) {
  const query = `{
    Get {
      Entity(where: {
        path: ["aliases"]
        operator: ContainsAny
        valueText: ${JSON.stringify([
    alias
  ])}
      }) {
        uuid
        name
        aliases
        entity_type
        tags
        context
        flatname
      }
    }
  }`;
  return (await queryWeaviateEntities(query)).entities;
}
async function getEntitiesLikeWeaviate(name) {
  const query = `{
    Get {
      Entity(where: {
        path: ["name"]
        operator: Like
        valueString: ${JSON.stringify(name)}
      }) {
        uuid
        name
        aliases
        entity_type
        tags
        context
        flatname
      }
    }
  }`;
  return (await queryWeaviateEntities(query)).entities;
}
async function getEntitiesContainsWeaviate(name) {
  const query = `{
    Get {
      Entity(where: {
        path: ["name"]
        operator: Like
        valueString: ${JSON.stringify(`*${name}*`)}
      }) {
        uuid
        name
        aliases
        entity_type
        tags
        context
        flatname
      }
    }
  }`;
  return (await queryWeaviateEntities(query)).entities;
}
async function getEntitiesStartsWithWeaviate(prefix) {
  const query = `{
    Get {
      Entity(where: {
        path: ["name"]
        operator: Like
        valueString: ${JSON.stringify(`${prefix}*`)}
      }) {
        uuid
        name
        aliases
        entity_type
        tags
        context
        flatname
      }
    }
  }`;
  return (await queryWeaviateEntities(query)).entities;
}
async function getEntitiesNearTextWeaviate(text) {
  const query = `{
    Get {
      Entity(
        nearText: {
          concepts: [${JSON.stringify(text)}]
        }
      ) {
        uuid
        name
        aliases
        entity_type
        tags
        context
        flatname
      }
    }
  }`;
  return (await queryWeaviateEntities(query)).entities;
}
function dedupeEntityCandidates(entities) {
  const seen = new Map();
  for (const entity of entities){
    if (!seen.has(entity.id)) {
      seen.set(entity.id, entity);
    }
  }
  return [
    ...seen.values()
  ];
}
async function findOrCreateEntity(name, entityType = "ORG", options = {}) {
  const weaviateConfig = getWeaviateConfig();
  const weaviateUrl = weaviateConfig?.url ?? "";
  const weaviateApiKey = weaviateConfig?.apiKey ?? "";
  if (!name.trim()) {
    throw new Error("Cannot create entity with empty name");
  }
  const normalizedName = normalizeLettersOnly(name);
  const tags = options.tags ?? null;
  const nearText = options.nearText ?? null;
  const context = options.context ?? "";
  const minConfidence = options.minConfidence ?? 0.95;
  if (!weaviateConfig) {
    throw new Error("Missing Weaviate configuration");
  }
  console.log(JSON.stringify({
    level: "info",
    step: "entity_resolution.weaviate.start",
    entity_name: name,
    entity_type: entityType,
    weaviate_url: weaviateUrl,
    normalized_name: normalizedName
  }));
  const byName = await getEntitiesByNameWeaviate(name);
  console.log(JSON.stringify({
    level: "info",
    step: "entity_resolution.weaviate.by_name",
    entity_name: name,
    found: byName != null,
    matched_entity_id: byName?.id ?? null,
    matched_entity_name: byName?.name ?? null
  }));
  if (byName) {
    return {
      id: byName.id,
      name: byName.name,
      weaviate_uuid: byName.id
    };
  }
  const withAlias = await getEntitiesWithAliasWeaviate(name);
  console.log(JSON.stringify({
    level: "info",
    step: "entity_resolution.weaviate.alias",
    entity_name: name,
    count: withAlias.length,
    entity_ids: withAlias.slice(0, 5).map((entity)=>entity.id)
  }));
  if (withAlias.length >= 1) {
    const entity = withAlias[0];
    return {
      id: entity.id,
      name: entity.name,
      weaviate_uuid: entity.id
    };
  }
  const likeEntities = await getEntitiesLikeWeaviate(name);
  console.log(JSON.stringify({
    level: "info",
    step: "entity_resolution.weaviate.like",
    entity_name: name,
    count: likeEntities.length,
    entity_ids: likeEntities.slice(0, 5).map((entity)=>entity.id)
  }));
  if (likeEntities.length === 1) {
    const comparison = await compareEntitiesStrict({
      sourceEntity: {
        name,
        tags,
        context,
        entity_type: entityType
      },
      targetEntity: likeEntities[0]
    });
    console.log(JSON.stringify({
      level: "info",
      step: "entity_resolution.weaviate.like_compare",
      entity_name: name,
      candidate_entity_id: likeEntities[0].id,
      candidate_entity_name: likeEntities[0].name,
      same_entity: comparison.same_entity,
      confidence: comparison.confidence
    }));
    if (comparison.same_entity) {
      const entity = likeEntities[0];
      return {
        id: entity.id,
        name: entity.name,
        weaviate_uuid: entity.id
      };
    }
  }
  if (nearText != null) {
    await getEntitiesNearTextWeaviate(nearText);
  }
  const entitiesNearTextName = await getEntitiesNearTextWeaviate(name);
  const entitiesContains = await getEntitiesContainsWeaviate(name);
  const searchableName = getSearchableNamePrefix(name, 8);
  const entitiesStartsWith = await getEntitiesStartsWithWeaviate(searchableName);
  const deepSearchCandidates = dedupeEntityCandidates([
    ...entitiesNearTextName,
    ...entitiesNearTextName,
    ...entitiesContains,
    ...entitiesStartsWith
  ]);
  console.log(JSON.stringify({
    level: "info",
    step: "entity_resolution.weaviate.deep_search",
    entity_name: name,
    near_text_name_count: entitiesNearTextName.length,
    contains_count: entitiesContains.length,
    starts_with_count: entitiesStartsWith.length,
    deduped_count: deepSearchCandidates.length,
    entity_ids: deepSearchCandidates.slice(0, 10).map((entity)=>entity.id)
  }));
  if (deepSearchCandidates.length > 0) {
    const selected = await selectMostLikelyEntity({
      entities: deepSearchCandidates,
      entityName: name,
      tags,
      context,
      minConfidence
    });
    if (selected) {
      return {
        id: selected.id,
        name: selected.name,
        weaviate_uuid: selected.id
      };
    }
  }
  console.error(JSON.stringify({
    level: "error",
    step: "entity_resolution.create_new_entity",
    backend: "weaviate",
    entity_name: name,
    entity_type: entityType,
    normalized_name: normalizedName
  }));
  const entityId = crypto.randomUUID();
  try {
    const addQuery = `mutation AddEntity {
      addToCollection(
        collection: "Entity",
        data: {
          uuid: ${JSON.stringify(entityId)},
          name: ${JSON.stringify(name)},
          aliases: [],
          entity_type: ${JSON.stringify(entityType)},
          context: ${JSON.stringify(context)},
          tags: ${JSON.stringify(tags ?? [])},
          flatname: ${JSON.stringify(normalizedName)},
          top_dog: false,
        }
      ) {
        uuid
      }
    }`;
    const addRes = await fetch(`${weaviateUrl}/v1/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${weaviateApiKey}`
      },
      body: JSON.stringify({
        query: addQuery
      })
    });
    if (addRes.ok) {
      return {
        id: entityId,
        name,
        weaviate_uuid: entityId
      };
    }
  } catch  {
  // fall through
  }
  throw new Error(`Failed to create entity in Weaviate for ${name}`);
}
async function findExistingOwnershipTree(companyAId, companyBId, supabaseUrl, supabaseServiceKey) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const scanResponse = await supabase.from("ownership_trees").select("id, company_a, company_b");
  if (scanResponse.error || !scanResponse.data) {
    console.error(JSON.stringify({
      level: "error",
      step: "ownership_tree_lookup.query_error",
      company_a_id: companyAId,
      company_b_id: companyBId,
      error: scanResponse.error
    }));
    return null;
  }
  let matchedTreeId = null;
  for (const row of scanResponse.data){
    const a = row.company_a;
    const b = row.company_b;
    if (a === companyAId && b === companyBId || a === companyBId && b === companyAId) {
      matchedTreeId = row.id;
      break;
    }
  }
  if (!matchedTreeId) {
    return null;
  }
  const matchedResponse = await supabase.from("ownership_trees").select("id, company_a, company_b, ownership_tree, investigation_data, summary").eq("id", matchedTreeId).maybeSingle();
  if (matchedResponse.error || !matchedResponse.data) {
    console.error(JSON.stringify({
      level: "error",
      step: "ownership_tree_lookup.match_fetch_error",
      company_a_id: companyAId,
      company_b_id: companyBId,
      ownership_tree_id: matchedTreeId,
      error: matchedResponse.error
    }));
    return null;
  }
  return matchedResponse.data;
}
async function invokeScrapeLambda(url) {
  if (SCRAPE_PAGE_URL) {
    return await invokeFunctionUrl(SCRAPE_PAGE_URL, {
      url
    });
  }
  const awsAccessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID_LAMBDA");
  const awsSecretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY_LAMBDA");
  if (!awsAccessKeyId || !awsSecretAccessKey) {
    throw new Error("AWS credentials not configured");
  }
  const endpoint = `https://lambda.${AWS_REGION}.amazonaws.com/2015-03-31/functions/${SCRAPE_LAMBDA_ARN}/invocations`;
  const authHeader = "Basic " + btoa(`${awsAccessKeyId}:${awsSecretAccessKey}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader
    },
    body: JSON.stringify({
      url
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Scrape Lambda failed: ${response.status} - ${errorText}`);
  }
  return response.json();
}
async function invokeExtractEntityLambda(articleText, articleTitle) {
  const systemMessage = `You are a GROUNDED CORPORATE ENTITY EXTRACTOR.

YOUR ONLY JOB: Extract every company, corporation, or organization that is mentioned or clearly implicated in the article body. Do NOT assess relevance or applicability. Do NOT filter. Just extract.

Return ONLY valid JSON. No markdown, no commentary.

INPUT CONTEXT:
- The article text you receive is SCRAPED MARKDOWN from a web page.
- Scraped markdown often includes boilerplate such as navigation menus, header/footer links, newsletter prompts, related article links, commerce widgets, repeated site branding.
- You MUST mentally separate probable article content from surrounding boilerplate before extracting.
- Do NOT extract company names that appear ONLY in navigation/boilerplate/footer.
- The article title is a strong signal for the article's actual content.

WHAT COUNTS AS A COMPANY:
- Publicly or privately traded corporations
- Subsidiaries named in the article
- Organizations with commercial operations
- Government agencies ONLY if they are the subject of a financial action

WHAT DOES NOT COUNT:
- Individuals (people are not companies)
- Generic industry references ("tech companies", "automakers")
- Companies mentioned ONLY in boilerplate/nav/footer
- Non-commercial organizations UNLESS they are the article's primary subject

ERROR ASYMMETRY:
- False negatives are worse than false positives.
- If in doubt whether something is a company, INCLUDE it.

PROMINENCE DEFINITIONS:
- "primary": The article's headline or central narrative is about this company
- "secondary": Significant discussion (multiple paragraphs or a key role in the story)
- "mention": Named once or twice, peripheral to the main story

OUTPUT JSON schema:
{
  "companies": [
    {"name": "Exact company name", "prominence": "primary|secondary|mention", "context": "One sentence about role"}
  ]
}

RULES:
- Return ALL companies found in the article body, not just the primary one.
- If no companies are found, return {"companies": []}.
- Do NOT invent companies not present in the article.
- Order companies by prominence: primary first.`;
  const userMessage = `Extract all companies mentioned in this article.

Respond ONLY with JSON in the exact format specified in the system message.

Article Title:
${articleTitle || "No title provided"}

Article Text:
${articleText}`;
  const payload = {
    model: "x-ai/grok-4.1-fast",
    system_message: systemMessage,
    user_message: userMessage
  };
  if (GET_LLM_RESPONSE_URL) {
    return await invokeFunctionUrl(GET_LLM_RESPONSE_URL, payload);
  }
  const awsAccessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID_LAMBDA");
  const awsSecretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY_LAMBDA");
  if (!awsAccessKeyId || !awsSecretAccessKey) {
    throw new Error("AWS credentials not configured");
  }
  const endpoint = `https://lambda.${AWS_REGION}.amazonaws.com/2015-03-31/functions/${LLM_LAMBDA_ARN}/invocations`;
  const authHeader = "Basic " + btoa(`${awsAccessKeyId}:${awsSecretAccessKey}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Extract Lambda failed: ${response.status} - ${errorText}`);
  }
  return response.json();
}
async function invokeApplicabilityLambda(articleTitle, articleText) {
  const systemMessage = `You are an ARTICLE APPLICABILITY CLASSIFIER.

Your job is to decide whether a news article is applicable for company ownership investigation.

APPLICABLE:
- The article is about a specific company, corporation, organization, or branded product.
- The article clearly centers a real commercial or organizational entity.

NOT APPLICABLE:
- The article is about a person, abstract topic, policy, market trend, or generic industry trend without a clear target entity.
- The article does not identify a specific company or product that should be investigated.

Return ONLY valid JSON. No markdown, no commentary.

OUTPUT JSON schema (STRICT):
{
  "is_applicable": true,
  "reason": "Short explanation",
  "identified_company": "Specific company name if clearly identifiable, otherwise null",
  "identified_product": "Specific product name if clearly identifiable, otherwise null"
}`;
  const userMessage = `Determine whether this article is applicable for ownership investigation.

Respond ONLY with JSON in the exact format specified in the system message.

Article Title:
${articleTitle || "No title provided"}

Article Text:
${articleText}`;
  const payload = {
    model: "x-ai/grok-4.1-fast",
    system_message: systemMessage,
    user_message: userMessage
  };
  if (GET_LLM_RESPONSE_URL) {
    return await invokeFunctionUrl(GET_LLM_RESPONSE_URL, payload);
  }
  const awsAccessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID_LAMBDA");
  const awsSecretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY_LAMBDA");
  if (!awsAccessKeyId || !awsSecretAccessKey) {
    throw new Error("AWS credentials not configured");
  }
  const endpoint = `https://lambda.${AWS_REGION}.amazonaws.com/2015-03-31/functions/${LLM_LAMBDA_ARN}/invocations`;
  const authHeader = "Basic " + btoa(`${awsAccessKeyId}:${awsSecretAccessKey}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Applicability Lambda failed: ${response.status} - ${errorText}`);
  }
  return response.json();
}
async function invokeSelectPrimaryCompanyLambda(articleTitle, companies) {
  const systemMessage = `You are a DETERMINISTIC COMPANY SELECTOR.

YOUR ONLY JOB: Given a list of companies extracted from a news article, select the ONE company that is most central to the article's narrative. You are NOT judging whether the article is "about" a company — it is. You are choosing which one.

Return ONLY valid JSON. No markdown, no commentary.

SELECTION RULES (Apply in order):
1. HEADLINE RULE: If exactly one company appears in the article title, select it.
2. NARRATIVE CENTRALITY RULE: Select the company whose actions, decisions, or outcomes are the article's primary subject matter.
3. SPECIFICITY RULE: Prefer a subsidiary over its parent if the article is specifically about the subsidiary's actions.
4. TIE-BREAKER: If two companies are equally central, prefer the one listed with "primary" prominence. If still tied, prefer the one that appears first in the list.

FORCED SELECTION:
- You MUST select exactly one company. There is no "none" option.
- Even if the article covers multiple companies equally, pick one.
- Even if the article is about a deal between two companies, pick the one whose actions drive the story.

OUTPUT JSON schema (STRICT):
{
  "selected_company": "Company Name exactly as it appears in the input list",
  "reason": "Brief explanation referencing which selection rule applied"
}

RULES:
- The selected_company value MUST exactly match one of the "name" values from the input companies list.
- Do NOT invent a company name not in the input.
- Keep the reason under 50 words.`;
  const userMessage = `Select the primary company from this article.

Respond ONLY with JSON in the exact format specified in the system message.

Article Title:
${articleTitle || "No title provided"}

Companies extracted from article:
${JSON.stringify(companies, null, 2)}`;
  const payload = {
    model: "x-ai/grok-4.1-fast",
    system_message: systemMessage,
    user_message: userMessage
  };
  if (GET_LLM_RESPONSE_URL) {
    return await invokeFunctionUrl(GET_LLM_RESPONSE_URL, payload);
  }
  const awsAccessKeyId = Deno.env.get("AWS_ACCESS_KEY_ID_LAMBDA");
  const awsSecretAccessKey = Deno.env.get("AWS_SECRET_ACCESS_KEY_LAMBDA");
  if (!awsAccessKeyId || !awsSecretAccessKey) {
    throw new Error("AWS credentials not configured");
  }
  const endpoint = `https://lambda.${AWS_REGION}.amazonaws.com/2015-03-31/functions/${LLM_LAMBDA_ARN}/invocations`;
  const authHeader = "Basic " + btoa(`${awsAccessKeyId}:${awsSecretAccessKey}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authHeader
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Primary company selection failed: ${response.status} - ${errorText}`);
  }
  return response.json();
}
function normalizeLettersOnly(value) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}
function serializePrefetchedEntity(entity, options = {}) {
  return {
    id: entity.id,
    created_at: "None",
    metadata: {},
    notes: "",
    name: entity.name,
    aliases: [],
    entity_type: options.entityType ?? "ORG",
    tags: options.tags ?? [],
    context: options.context ?? "",
    evidence_ids: [],
    flatname: normalizeLettersOnly(entity.name),
    top_dog: false
  };
}
async function buildApplicabilityResult(articleText, articleTitle, options = {}) {
  try {
    const llmRaw = await invokeApplicabilityLambda(articleTitle, articleText);
    if (llmRaw.status_code === 200) {
      const content = typeof llmRaw.result === "string" ? llmRaw.result : null;
      if (content) {
        const parsed = JSON.parse(content);
        return {
          is_applicable: parsed.is_applicable === true,
          reason: typeof parsed.reason === "string" && parsed.reason.trim().length > 0 ? parsed.reason.trim() : parsed.is_applicable === true ? "Article is applicable for ownership investigation." : "Article is not applicable for ownership investigation.",
          identified_company: typeof parsed.identified_company === "string" && parsed.identified_company.trim().length > 0 ? parsed.identified_company.trim() : null,
          identified_product: typeof parsed.identified_product === "string" && parsed.identified_product.trim().length > 0 ? parsed.identified_product.trim() : null
        };
      }
    }
    if (options.requestId) {
      logError(options.requestId, "edge.pre_investigation.applicability.invalid_response", {
        llm_status_code: llmRaw?.status_code ?? null,
        llm_result: llmRaw?.result ?? null
      });
    }
  } catch (error) {
    if (options.requestId) {
      logError(options.requestId, "edge.pre_investigation.applicability.error", {
        error: serializeError(error)
      });
    }
  }
  return {
    is_applicable: false,
    reason: "Applicability check failed before company extraction.",
    identified_company: null,
    identified_product: null
  };
}
async function selectPrimaryCompanyResult(articleTitle, companies) {
  if (companies.length === 0) {
    return {
      is_applicable: false,
      reason: "No companies found in article",
      identified_company: null,
      identified_product: null
    };
  }
  if (companies.length === 1) {
    return {
      is_applicable: true,
      reason: companies[0].context ? `Single company identified: ${companies[0].context}` : "Single company identified in article",
      identified_company: companies[0].name,
      identified_product: null
    };
  }
  try {
    const llmRaw = await invokeSelectPrimaryCompanyLambda(articleTitle, companies);
    if (llmRaw.status_code === 200) {
      const content = typeof llmRaw.result === "string" ? llmRaw.result : null;
      if (content) {
        const parsed = JSON.parse(content);
        const selectedCompany = typeof parsed.selected_company === "string" ? parsed.selected_company : null;
        const matchingCompany = selectedCompany ? companies.find((company)=>company.name === selectedCompany) : null;
        if (matchingCompany) {
          return {
            is_applicable: true,
            reason: typeof parsed.reason === "string" && parsed.reason.length > 0 ? parsed.reason : "Selected as primary company from multiple candidates",
            identified_company: matchingCompany.name,
            identified_product: null
          };
        }
      }
    }
  } catch  {
  // fall through
  }
  return {
    is_applicable: true,
    reason: "Fallback: selection failed, used most prominent extracted company",
    identified_company: companies[0].name,
    identified_product: null
  };
}
async function runEdgePreInvestigation(args) {
  const { url, site, requestId, supabase, queueId, supabaseUrl, supabaseServiceRole } = args;
  const startedAt = Date.now();
  const setPrepassStatus = async (status)=>{
    const statusStartedAt = Date.now();
    logInfo(requestId, "db.queue_prepass_status.start", {
      queue_id: queueId,
      status
    });
    const updateRes = await supabase.from("article_queue").update({
      status
    }).eq("id", queueId);
    if (updateRes.error) {
      logError(requestId, "db.queue_prepass_status.error", {
        queue_id: queueId,
        status,
        error: updateRes.error
      });
    } else {
      logInfo(requestId, "db.queue_prepass_status.done", {
        queue_id: queueId,
        status,
        duration_ms: Date.now() - statusStartedAt
      });
    }
  };
  try {
    logInfo(requestId, "edge.pre_investigation.run.start", {
      queue_id: queueId,
      url,
      site_id: site.id,
      site_domain: site.domain,
      site_news_site: site.news_site
    });
    // DEBUG / SAFETY:
    // The edge prepass must use the same Weaviate-backed entity resolution path as
    // the Python investigation job. If these vars are missing, falling back will
    // create divergent entities and hide the real issue, so fail fast instead.
    // Remove or relax this once debugging is complete.
    if (!getWeaviateConfig()) {
      logError(requestId, "edge.pre_investigation.weaviate_config_missing", {
        queue_id: queueId,
        has_weaviate_url: Boolean(Deno.env.get("WEAVIATE_URL")),
        has_weaviate_api_key: Boolean(Deno.env.get("WEAVIATE_API_KEY")),
        has_weaviate_apikey: Boolean(Deno.env.get("WEAVIATE_APIKEY"))
      });
      throw new Error("Missing Weaviate configuration for edge pre-investigation.");
    }
    await setPrepassStatus("prepass: scraping article");
    const scrapeStartedAt = Date.now();
    logInfo(requestId, "edge.pre_investigation.scrape.start", {
      queue_id: queueId,
      url
    });
    const scrapeRaw = await invokeScrapeLambda(url);
    logInfo(requestId, "edge.pre_investigation.scrape.done", {
      queue_id: queueId,
      url,
      duration_ms: Date.now() - scrapeStartedAt,
      scrape_status_code: scrapeRaw?.status_code ?? null,
      article_text_length: scrapeRaw?.result?.result?.length ?? 0,
      raw_html_length: scrapeRaw?.result?.raw_html?.length ?? 0
    });
    if (scrapeRaw.status_code !== 200) {
      throw new Error(`Scraping failed: ${JSON.stringify(scrapeRaw.result)}`);
    }
    const scrapeOutput = scrapeRaw.result;
    const articleText = scrapeOutput.result || "";
    const titleMatch = articleText.match(/^#\s+(.+?)(?:\n|$)/);
    const articleTitle = titleMatch ? titleMatch[1].trim() : "";
    logInfo(requestId, "edge.pre_investigation.scrape.parsed", {
      queue_id: queueId,
      article_title: articleTitle,
      article_title_length: articleTitle.length,
      article_text_length: articleText.length
    });
    await setPrepassStatus("prepass: checking applicability");
    const applicabilityStartedAt = Date.now();
    logInfo(requestId, "edge.pre_investigation.applicability.start", {
      queue_id: queueId,
      article_title: articleTitle,
      article_text_length: articleText.length
    });
    const applicabilityResult = await buildApplicabilityResult(articleText, articleTitle, {
      requestId
    });
    const resolvedNewsSite = await resolveNewsSiteEntity({
      newsSiteId: site.id,
      domain: site.domain,
      requestId
    });
    const newsSiteEntityId = resolvedNewsSite.entityId;
    logInfo(requestId, "edge.pre_investigation.resolve_news_site_entity.done", {
      queue_id: queueId,
      requested_news_site_id: site.id,
      requested_domain: site.domain,
      stored_site_news_site: site.news_site,
      resolved_news_site_id: resolvedNewsSite.newsSiteId,
      resolved_news_site_domain: resolvedNewsSite.newsSiteDomain,
      resolved_news_site_entity_id: resolvedNewsSite.entityId,
      resolved_news_site_entity_name: resolvedNewsSite.entityName
    });
    logInfo(requestId, "edge.pre_investigation.applicability.done", {
      queue_id: queueId,
      duration_ms: Date.now() - applicabilityStartedAt,
      is_applicable: applicabilityResult.is_applicable,
      reason: applicabilityResult.reason,
      identified_company: applicabilityResult.identified_company,
      identified_product: applicabilityResult.identified_product
    });
    if (!applicabilityResult.is_applicable) {
      logInfo(requestId, "edge.pre_investigation.early_out.not_applicable", {
        queue_id: queueId,
        total_duration_ms: Date.now() - startedAt,
        reason: applicabilityResult.reason
      });
      return {
        ok: true,
        skip_fly: true,
        not_applicable: true,
        domain: site.domain,
        site_id: site.id,
        site_entity_id: newsSiteEntityId,
        site_news_site: resolvedNewsSite.newsSiteId,
        scrape_result: scrapeOutput,
        extracted_companies: [],
        applicability_result: applicabilityResult
      };
    }
    await setPrepassStatus("prepass: extracting companies");
    const extractStartedAt = Date.now();
    logInfo(requestId, "edge.pre_investigation.extract_companies.start", {
      queue_id: queueId,
      article_title: articleTitle,
      article_text_length: articleText.length
    });
    const llmRaw = await invokeExtractEntityLambda(articleText, articleTitle);
    logInfo(requestId, "edge.pre_investigation.extract_companies.done", {
      queue_id: queueId,
      duration_ms: Date.now() - extractStartedAt,
      extract_status_code: llmRaw?.status_code ?? null,
      has_content: typeof llmRaw?.result === "string" && llmRaw.result.length > 0
    });
    if (llmRaw.status_code !== 200) {
      throw new Error(`Entity extraction failed: ${JSON.stringify(llmRaw.result)}`);
    }
    const content = typeof llmRaw.result === "string" ? llmRaw.result : null;
    let companies = [];
    if (content) {
      const parsed = JSON.parse(content);
      companies = parsed.companies || [];
    }
    logInfo(requestId, "edge.pre_investigation.extract_companies.parsed", {
      queue_id: queueId,
      companies_count: companies.length,
      company_names: companies.slice(0, 10).map((company)=>company.name)
    });
    const subjectSelectionStartedAt = Date.now();
    logInfo(requestId, "edge.pre_investigation.select_subject.start", {
      queue_id: queueId,
      companies_count: companies.length,
      applicability_identified_company: applicabilityResult.identified_company
    });
    const subjectSelectionResult = await selectPrimaryCompanyResult(articleTitle, companies);
    const resolvedCompany = applicabilityResult.identified_company && applicabilityResult.identified_company.length > 0 ? applicabilityResult.identified_company : subjectSelectionResult.identified_company;
    logInfo(requestId, "edge.pre_investigation.select_subject.done", {
      queue_id: queueId,
      duration_ms: Date.now() - subjectSelectionStartedAt,
      selected_company: subjectSelectionResult.identified_company,
      selection_reason: subjectSelectionResult.reason,
      resolved_company: resolvedCompany
    });
    if (!resolvedCompany) {
      logInfo(requestId, "edge.pre_investigation.early_out.unresolved_company", {
        queue_id: queueId,
        total_duration_ms: Date.now() - startedAt,
        companies_count: companies.length
      });
      return {
        ok: true,
        skip_fly: true,
        not_applicable: true,
        domain: site.domain,
        site_id: site.id,
        site_entity_id: newsSiteEntityId,
        site_news_site: resolvedNewsSite.newsSiteId,
        scrape_result: scrapeOutput,
        extracted_companies: companies,
        applicability_result: {
          is_applicable: false,
          reason: "Article may be applicable, but no company could be resolved after extraction.",
          identified_company: null,
          identified_product: applicabilityResult.identified_product
        }
      };
    }
    await setPrepassStatus("prepass: resolving article subject");
    const resolveSubjectStartedAt = Date.now();
    logInfo(requestId, "edge.pre_investigation.resolve_subject.start", {
      queue_id: queueId,
      resolved_company: resolvedCompany
    });
    const articleSubject = await findOrCreateEntity(resolvedCompany, "ORG", {
      tags: [
        "article_subject"
      ],
      context: "",
      minConfidence: 0.95
    });
    logInfo(requestId, "edge.pre_investigation.resolve_subject.done", {
      queue_id: queueId,
      duration_ms: Date.now() - resolveSubjectStartedAt,
      article_subject_id: articleSubject.id,
      article_subject_name: articleSubject.name
    });
    const articleSubjectEntity = serializePrefetchedEntity(articleSubject, {
      entityType: "ORG",
      tags: [
        "article_subject"
      ],
      context: companies.find((company)=>company.name === articleSubject.name)?.context ?? ""
    });
    const resolvedApplicabilityResult = {
      ...applicabilityResult,
      identified_company: articleSubject.name
    };
    if (newsSiteEntityId) {
      await setPrepassStatus("prepass: checking ownership tree");
      const ownershipLookupStartedAt = Date.now();
      logInfo(requestId, "edge.pre_investigation.ownership_tree_lookup.start", {
        queue_id: queueId,
        news_site_entity_id: newsSiteEntityId,
        article_subject_id: articleSubject.id
      });
      const existingOwnershipTree = await findExistingOwnershipTree(newsSiteEntityId, articleSubject.id, supabaseUrl, supabaseServiceRole);
      logInfo(requestId, "edge.pre_investigation.ownership_tree_lookup.done", {
        queue_id: queueId,
        duration_ms: Date.now() - ownershipLookupStartedAt,
        found_existing_tree: existingOwnershipTree != null,
        ownership_tree_id: existingOwnershipTree?.id ?? null
      });
      if (existingOwnershipTree) {
        logInfo(requestId, "edge.pre_investigation.early_out.existing_tree", {
          queue_id: queueId,
          ownership_tree_id: existingOwnershipTree.id,
          total_duration_ms: Date.now() - startedAt
        });
        const investigationPrepassResults = {
          domain: site.domain,
          site_data: {
            site_id: site.id,
            site_entity_id: newsSiteEntityId,
            news_site: resolvedNewsSite.newsSiteId
          },
          scrape_result: scrapeOutput,
          extracted_companies: companies,
          applicability_result: resolvedApplicabilityResult,
          article_subject_entity: articleSubjectEntity,
          ownership_tree_id: existingOwnershipTree.id
        };
        await supabase.from("article_queue").update({
          investigation_prepass_results: JSON.stringify(investigationPrepassResults)
        }).eq("id", queueId);
        return {
          ok: true,
          skip_fly: true,
          domain: site.domain,
          site_id: site.id,
          site_entity_id: newsSiteEntityId,
          site_news_site: resolvedNewsSite.newsSiteId,
          scrape_result: scrapeOutput,
          extracted_companies: companies,
          applicability_result: resolvedApplicabilityResult,
          article_subject_entity: articleSubjectEntity,
          ownership_tree_id: existingOwnershipTree.id,
          final_output_obj: {
            article_url: url,
            news_site: {
              id: newsSiteEntityId,
              name: site.domain,
              entity_type: "ORG",
              metadata: {}
            },
            article_subject: {
              id: articleSubject.id,
              name: articleSubject.name,
              entity_type: "ORG",
              metadata: {}
            },
            common_owner_results: existingOwnershipTree.ownership_tree || {},
            final_ranking: {
              entities: {},
              ranking: []
            },
            top_owner: null
          }
        };
      }
      // DEBUG ONLY:
      // If the Python job would later early-out here but the edge prepass does not,
      // fail immediately so we can inspect the resolved entity ids in logs instead of
      // silently queueing and masking the mismatch.
      // Remove after debugging.
      if (DEBUG_THROW_IF_OWNERSHIP_TREE_MISSING) {
        throw new Error(`DEBUG ownership tree miss after subject resolution: news_site_entity_id=${newsSiteEntityId}, article_subject_id=${articleSubject.id}, article_subject_name=${articleSubject.name}`);
      }
    }
    await setPrepassStatus("queued");
    logInfo(requestId, "edge.pre_investigation.run.done", {
      queue_id: queueId,
      total_duration_ms: Date.now() - startedAt,
      outcome: "queued_for_investigation",
      article_subject_id: articleSubject.id,
      article_subject_name: articleSubject.name,
      companies_count: companies.length
    });
    return {
      ok: true,
      skip_fly: false,
      domain: site.domain,
      site_id: site.id,
      site_entity_id: newsSiteEntityId,
      site_news_site: resolvedNewsSite.newsSiteId,
      scrape_result: scrapeOutput,
      extracted_companies: companies,
      applicability_result: resolvedApplicabilityResult,
      article_subject_entity: articleSubjectEntity
    };
  } catch (error) {
    await setPrepassStatus("failed");
    logError(requestId, "edge.pre_investigation.run.error", {
      queue_id: queueId,
      total_duration_ms: Date.now() - startedAt,
      error: serializeError(error)
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
async function callInvestigationStartEdge(args) {
  const { rawUrl, queueId, prefetched, supabaseUrl, supabaseServiceRole, internalEdgeApiKey } = args;
  const investigationStartUrl = `${supabaseUrl}/functions/v1/investigation_start`;
  const res = await safeFetchJson(investigationStartUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${supabaseServiceRole}`,
      "x-internal-key": internalEdgeApiKey
    },
    body: JSON.stringify({
      queue_id: queueId
    })
  });
  if (!res.ok) {
    return {
      ok: false,
      error: `Investigation start failed: ${res.status} - ${res.bodyText}`
    };
  }
  const body = res.bodyJson;
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      error: "Invalid response from investigation_start"
    };
  }
  if ("error" in body) {
    return {
      ok: false,
      error: String(body.error)
    };
  }
  return {
    ok: true,
    did_call_remote: body.did_call_remote === true,
    fly_scale: typeof body.fly_scale === "number" ? body.fly_scale : undefined,
    dispatch_result: typeof body.dispatch_result === "object" ? body.dispatch_result : null,
    queue: typeof body.queue === "object" ? body.queue : null
  };
}
serve(async (req)=>{
  const requestId = makeRequestId();
  const origin = req.headers.get("Origin");
  const respond = (status, body, extraHeaders = {})=>jsonResponse(status, body, extraHeaders, origin);
  // Quick early reject for non-allowed origins (extra layer)
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    logInfo(requestId, "security.cors_blocked", {
      origin
    });
    return new Response("CORS not allowed", {
      status: 403
    });
  }
  try {
    logInfo(requestId, "request.received", {
      method: req.method,
      origin,
      url: req.url
    });
    // Handle preflight OPTIONS
    if (req.method === "OPTIONS") {
      const corsHeaders = getCorsHeaders(origin);
      logInfo(requestId, "request.options", {
        allowed: !!corsHeaders["Access-Control-Allow-Origin"]
      });
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }
    if (req.method !== "POST") {
      logInfo(requestId, "request.invalid_method", {
        method: req.method
      });
      return respond(405, {
        error: "Method Not Allowed. Use POST.",
        request_id: requestId
      });
    }
    let body = null;
    try {
      body = await req.json();
      logInfo(requestId, "request.body_parsed", {
        has_body: body !== null
      });
    } catch (error) {
      logError(requestId, "request.body_parse_failed", {
        error: serializeError(error)
      });
      return respond(400, {
        error: "Invalid JSON body.",
        request_id: requestId
      });
    }
    const url = body?.url;
    const useEdgePreInvestigation = body?.use_edge_pre_investigation_check === true;
    const deferred = body?.defer_investigation === true;
    if (typeof url !== "string" || url.trim().length === 0) {
      logInfo(requestId, "request.missing_url", {
        received_type: typeof url
      });
      return respond(400, {
        error: "Missing required field: url",
        request_id: requestId
      });
    }
    if (url.length > 2000) {
      logInfo(requestId, "request.invalid_url_length", {
        url_length: url.length
      });
      return respond(400, {
        error: "Invalid URL length.",
        request_id: requestId
      });
    }
    const normalizedUrl = normalizeInputUrl(url);
    if (!normalizedUrl) {
      logInfo(requestId, "request.invalid_url", {
        url
      });
      return respond(400, {
        error: "Invalid URL. Must be http(s) or a bare domain/path.",
        request_id: requestId
      });
    }
    const rawUrl = normalizedUrl;
    const { hostname, key: queueUrlKey } = makeQueueUrlKey(rawUrl);
    const siteDomain = getSiteDomain(new URL(rawUrl).hostname);
    logInfo(requestId, "request.normalized", {
      raw_url: rawUrl,
      hostname,
      queue_url_key: queueUrlKey,
      site_domain: siteDomain
    });
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const internalEdgeApiKey = Deno.env.get("INTERNAL_EDGE_API_KEY") ?? "";
    const missingSecrets = [];
    if (!supabaseUrl) missingSecrets.push("SUPABASE_URL");
    if (!supabaseServiceRole) missingSecrets.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!internalEdgeApiKey) missingSecrets.push("INTERNAL_EDGE_API_KEY");
    if (missingSecrets.length > 0) {
      logError(requestId, "env.missing_secrets", {
        missing_secrets: missingSecrets
      });
      return respond(500, {
        error: "Missing required secrets.",
        missing_secrets: missingSecrets,
        request_id: requestId
      });
    }
    logInfo(requestId, "env.validated", {
      has_supabase_url: true,
      has_supabase_service_role: true,
      has_internal_edge_api_key: true
    });
    const supabase = createClient(supabaseUrl, supabaseServiceRole, {
      auth: {
        persistSession: false
      }
    });
    logInfo(requestId, "db.site_lookup.start", {
      site_domain: siteDomain
    });
    const siteLookup = await supabase.from("sites").select("id, domain, news_site").eq("domain", siteDomain).maybeSingle();
    if (siteLookup.error) {
      logError(requestId, "db.site_lookup.error", {
        error: siteLookup.error,
        site_domain: siteDomain
      });
      return respond(500, {
        error: "Database error looking up site.",
        details: siteLookup.error.message,
        request_id: requestId
      });
    }
    logInfo(requestId, "db.site_lookup.done", {
      found: !!siteLookup.data,
      site_id: siteLookup.data?.id ?? null
    });
    if (!siteLookup.data) {
      return respond(200, {
        site_valid: false,
        hostname,
        site_domain: siteDomain,
        queue_url_key: queueUrlKey,
        message: "Unsupported domain.",
        request_id: requestId,
        use_edge_pre_investigation_check_received: useEdgePreInvestigation
      });
    }
    const siteId = siteLookup.data.id;
    logInfo(requestId, "db.queue_insert.start", {
      queue_url_key: queueUrlKey,
      site_id: siteId
    });
    const initialQueueStatus = useEdgePreInvestigation ? "prepass: scraping article" : "queued";
    const insertRes = await supabase.from("article_queue").insert({
      url: queueUrlKey,
      site_id: siteId,
      status: initialQueueStatus
    }).select("*").single();
    let queueRow = null;
    let wasInserted = false;
    if (insertRes.error) {
      logError(requestId, "db.queue_insert.error", {
        error: insertRes.error
      });
      const lowerMessage = insertRes.error.message.toLowerCase();
      const isDuplicate = insertRes.error.code === "23505" || lowerMessage.includes("duplicate") || lowerMessage.includes("unique");
      if (!isDuplicate) {
        return respond(500, {
          error: "Database error inserting queue row.",
          details: insertRes.error.message,
          request_id: requestId
        });
      }
      logInfo(requestId, "db.queue_insert.duplicate_loading_existing", {
        queue_url_key: queueUrlKey
      });
      const existingQueueRes = await supabase.from("article_queue").select("*").eq("url", queueUrlKey).maybeSingle();
      if (existingQueueRes.error) {
        logError(requestId, "db.queue_existing.error", {
          error: existingQueueRes.error
        });
        return respond(500, {
          error: "Database error loading existing queue row.",
          details: existingQueueRes.error.message,
          request_id: requestId
        });
      }
      queueRow = existingQueueRes.data;
    } else {
      queueRow = insertRes.data;
      wasInserted = true;
      logInfo(requestId, "db.queue_insert.done", {
        queue_id: queueRow?.id ?? null
      });
    }
    const queueId = queueRow && typeof queueRow.id === "string" && queueRow.id.length > 0 ? queueRow.id : null;
    if (queueId == null) {
      return respond(500, {
        error: "Queue row missing id.",
        request_id: requestId
      });
    }
    const queueStatus = queueRow && typeof queueRow.status === "string" ? queueRow.status : null;
    const alreadyRequested = queueRow !== null && queueRow.remote_requested_at !== null;
    if (!wasInserted) {
      logInfo(requestId, "queue.duplicate_existing", {
        queue_id: queueId,
        queue_status: queueStatus,
        already_requested: alreadyRequested
      });
      return respond(200, {
        site_valid: true,
        hostname,
        site_domain: siteDomain,
        queue_url_key: queueUrlKey,
        did_call_remote: false,
        queue: queueRow,
        was_inserted: false,
        request_id: requestId,
        message: "URL already exists in article_queue",
        skip_fly: true
      });
    }
    logInfo(requestId, "queue.state", {
      queue_id: queueId,
      queue_status: queueStatus,
      already_requested: alreadyRequested,
      was_inserted: wasInserted
    });
    let did_call_remote = false;
    let edge_pre_result = null;
    let investigation_start_result = null;
    let prefetched = undefined;
    if (useEdgePreInvestigation) {
      logInfo(requestId, "edge.pre_investigation.start", {
        url: rawUrl,
        site_id: siteId
      });
      const edgeRes = await runEdgePreInvestigation({
        url: rawUrl,
        site: {
          id: String(siteLookup.data.id),
          domain: String(siteLookup.data.domain),
          news_site: typeof siteLookup.data.news_site === "string" ? siteLookup.data.news_site : null
        },
        requestId,
        supabase,
        queueId,
        supabaseUrl,
        supabaseServiceRole
      });
      edge_pre_result = edgeRes;
      logInfo(requestId, "edge.pre_investigation.done", {
        ok: edgeRes.ok,
        error: edgeRes.error,
        has_domain: !!edgeRes.domain,
        has_scrape: !!edgeRes.scrape_result,
        companies_count: edgeRes.extracted_companies?.length ?? 0
      });
      if (!edgeRes.ok) {
        await supabase.from("article_queue").update({
          status: "failed"
        }).eq("id", queueId);
        const failedQueueRes = await supabase.from("article_queue").select("*").eq("url", queueUrlKey).maybeSingle();
        return respond(200, {
          site_valid: true,
          hostname,
          site_domain: siteDomain,
          queue_url_key: queueUrlKey,
          did_call_remote: false,
          edge_pre_result: edgeRes,
          queue: failedQueueRes.data ?? queueRow,
          was_inserted: wasInserted,
          request_id: requestId,
          message: edgeRes.error ?? "Edge pre-investigation failed.",
          failed: true,
          skip_fly: true
        });
      }
      if (edgeRes.ok && edgeRes.domain && edgeRes.site_id) {
        if (edgeRes.skip_fly && edgeRes.final_output_obj) {
          logInfo(requestId, "edge.pre_investigation.skip_fly", {
            has_final_output: true
          });
          await supabase.from("article_queue").update({
            status: "complete",
            ownership_tree_id: edgeRes.ownership_tree_id ?? null
          }).eq("id", queueId);
          const completedQueueRes = await supabase.from("article_queue").select("*").eq("url", queueUrlKey).maybeSingle();
          return respond(200, {
            site_valid: true,
            hostname,
            site_domain: siteDomain,
            queue_url_key: queueUrlKey,
            did_call_remote: false,
            edge_pre_result: edgeRes,
            skip_fly: true,
            final_output_obj: edgeRes.final_output_obj,
            queue: completedQueueRes.data ?? queueRow,
            was_inserted: wasInserted,
            request_id: requestId,
            message: "Existing ownership tree found, skipping Fly machine"
          });
        }
        prefetched = {
          domain: edgeRes.domain,
          site_id: edgeRes.site_id,
          site_entity_id: edgeRes.site_entity_id ?? null,
          site_news_site: edgeRes.site_news_site ?? null,
          scrape_result: edgeRes.scrape_result ?? {
            raw_html: "",
            result: ""
          },
          extracted_companies: edgeRes.extracted_companies ?? [],
          applicability_result: edgeRes.applicability_result,
          article_subject_entity: edgeRes.article_subject_entity ?? null
        };
        const investigationPrepassResults = {
          domain: prefetched.domain,
          site_data: {
            site_id: prefetched.site_id,
            site_entity_id: prefetched.site_entity_id,
            news_site: prefetched.site_news_site
          },
          scrape_result: prefetched.scrape_result,
          extracted_companies: prefetched.extracted_companies,
          applicability_result: prefetched.applicability_result,
          article_subject_entity: prefetched.article_subject_entity
        };
        const prepassSaveRes = await supabase.from("article_queue").update({
          investigation_prepass_results: JSON.stringify(investigationPrepassResults),
          article_subject_id: prefetched.article_subject_entity?.id ?? null
        }).eq("id", queueId);
        if (prepassSaveRes.error) {
          logError(requestId, "db.prepass_results.save.error", {
            queue_id: queueId,
            error: prepassSaveRes.error
          });
        } else {
          logInfo(requestId, "db.prepass_results.saved", {
            queue_id: queueId
          });
        }
        if (edgeRes.not_applicable && edgeRes.applicability_result) {
          const investigationPrepassResults = {
            domain: prefetched.domain,
            site_data: {
              site_id: prefetched.site_id,
              site_entity_id: prefetched.site_entity_id,
              news_site: prefetched.site_news_site
            },
            scrape_result: prefetched.scrape_result,
            extracted_companies: prefetched.extracted_companies,
            applicability_result: edgeRes.applicability_result
          };
          await supabase.from("article_queue").update({
            status: "not applicable",
            applicability_result: JSON.stringify(edgeRes.applicability_result),
            investigation_prepass_results: JSON.stringify(investigationPrepassResults)
          }).eq("id", queueId);
          const notApplicableQueueRes = await supabase.from("article_queue").select("*").eq("url", queueUrlKey).maybeSingle();
          return respond(200, {
            site_valid: true,
            hostname,
            site_domain: siteDomain,
            queue_url_key: queueUrlKey,
            did_call_remote: false,
            edge_pre_result: edgeRes,
            prefetched: {
              domain: prefetched.domain,
              site_id: prefetched.site_id,
              companies_count: prefetched.extracted_companies.length
            },
            queue: notApplicableQueueRes.data ?? queueRow,
            was_inserted: wasInserted,
            request_id: requestId,
            message: edgeRes.applicability_result.reason,
            not_applicable: true,
            skip_fly: true
          });
        }
        if (deferred && prefetched.extracted_companies.length > 0) {
          const articleSubjectName = prefetched.applicability_result?.identified_company ?? prefetched.extracted_companies[0].name;
          const articleSubjectId = prefetched.article_subject_entity?.id ?? null;
          const investigationPrepassResults = {
            domain: prefetched.domain,
            site_data: {
              site_id: prefetched.site_id,
              site_entity_id: prefetched.site_entity_id,
              news_site: prefetched.site_news_site
            },
            scrape_result: prefetched.scrape_result,
            extracted_companies: prefetched.extracted_companies,
            applicability_result: prefetched.applicability_result,
            article_subject_entity: prefetched.article_subject_entity
          };
          await supabase.from("article_queue").update({
            status: "deferred",
            article_subject_id: articleSubjectId,
            investigation_prepass_results: JSON.stringify(investigationPrepassResults)
          }).eq("id", queueId);
          const deferredQueueRes = await supabase.from("article_queue").select("*").eq("url", queueUrlKey).maybeSingle();
          logInfo(requestId, "queue.deferred", {
            article_subject_id: articleSubjectId,
            article_subject_name: articleSubjectName
          });
          return respond(200, {
            site_valid: true,
            hostname,
            site_domain: siteDomain,
            queue_url_key: queueUrlKey,
            did_call_remote: false,
            edge_pre_result: edgeRes,
            prefetched: {
              domain: prefetched.domain,
              site_id: prefetched.site_id,
              companies_count: prefetched.extracted_companies.length
            },
            queue: deferredQueueRes.data ?? queueRow,
            was_inserted: wasInserted,
            request_id: requestId,
            message: "Investigation deferred with pre-pass results",
            defer_investigation: true,
            skip_fly: true
          });
        }
      }
    }
    let currentQueueStatus = queueStatus;
    let currentAlreadyRequested = alreadyRequested;
    if (queueId !== null) {
      const currentQueueRes = await supabase.from("article_queue").select("status, remote_requested_at").eq("id", queueId).maybeSingle();
      if (!currentQueueRes.error && currentQueueRes.data) {
        currentQueueStatus = typeof currentQueueRes.data.status === "string" ? currentQueueRes.data.status : currentQueueStatus;
        currentAlreadyRequested = currentQueueRes.data.remote_requested_at !== null;
      }
      logInfo(requestId, "queue.state.before_dispatch", {
        queue_id: queueId,
        original_queue_status: queueStatus,
        current_queue_status: currentQueueStatus,
        original_already_requested: alreadyRequested,
        current_already_requested: currentAlreadyRequested
      });
    }
    if (queueId !== null && currentQueueStatus === "queued" && !currentAlreadyRequested) {
      const startRes = await callInvestigationStartEdge({
        rawUrl,
        queueId,
        prefetched,
        supabaseUrl,
        supabaseServiceRole,
        internalEdgeApiKey
      });
      if (!startRes.ok) {
        return respond(500, {
          error: "Failed to start investigation.",
          details: startRes.error,
          request_id: requestId
        });
      }
      did_call_remote = startRes.did_call_remote === true;
      investigation_start_result = {
        fly_scale: startRes.fly_scale ?? null,
        dispatch_result: startRes.dispatch_result ?? null
      };
    }
    logInfo(requestId, "db.final_queue_lookup.start", {
      queue_url_key: queueUrlKey
    });
    const finalQueueRes = await supabase.from("article_queue").select("*").eq("url", queueUrlKey).maybeSingle();
    if (finalQueueRes.error) {
      logError(requestId, "db.final_queue_lookup.error", {
        error: finalQueueRes.error
      });
      return respond(500, {
        error: "Database error loading final queue row.",
        details: finalQueueRes.error.message,
        request_id: requestId
      });
    }
    logInfo(requestId, "request.success", {
      did_call_remote,
      queue_id: finalQueueRes.data?.id ?? null
    });
    return respond(200, {
      site_valid: true,
      hostname,
      site_domain: siteDomain,
      queue_url_key: queueUrlKey,
      did_call_remote,
      investigation_start_result,
      edge_pre_result,
      prefetched: prefetched ? {
        domain: prefetched.domain,
        site_id: prefetched.site_id,
        companies_count: prefetched.extracted_companies.length
      } : null,
      skip_fly: false,
      queue: finalQueueRes.data,
      was_inserted: wasInserted,
      request_id: requestId
    });
  } catch (error) {
    logError(requestId, "request.unhandled_exception", {
      error: serializeError(error)
    });
    return respond(500, {
      error: "Unhandled edge function error.",
      request_id: requestId
    });
  }
});
