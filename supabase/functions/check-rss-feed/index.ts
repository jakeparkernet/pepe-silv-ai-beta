import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { XMLParser } from "npm:fast-xml-parser@4.5.0";
const MAX_ITEM_AGE_MS = 48 * 60 * 60 * 1000;
function log(step, data = null) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    step,
    data
  }));
}
function normalizeHost(hostname) {
  const h = String(hostname).trim().toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}
function normalizePathname(pathname) {
  let p = pathname || "/";
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1) p = p.replace(/\/+$/g, "");
  return p;
}
function normalizeUserUrl(raw) {
  let value = String(raw).trim();
  if (value.length === 0) return null;
  value = value.replace(/\s+/g, "");
  if (!/^[a-zA-Z]+:\/\//.test(value)) {
    value = `https://${value}`;
  }
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") {
      return null;
    }
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch  {
    return null;
  }
}
function makeQueueUrlKey(rawUrl) {
  const normalized = normalizeUserUrl(rawUrl);
  if (normalized === null) {
    throw new Error("Invalid URL");
  }
  const u = new URL(normalized);
  const host = normalizeHost(u.hostname);
  const port = u.port;
  const isDefaultPort = port === "" || u.protocol === "https:" && port === "443" || u.protocol === "http:" && port === "80";
  const hostWithPort = isDefaultPort ? host : `${host}:${port}`;
  const path = normalizePathname(u.pathname);
  return `${hostWithPort}${path}`;
}
function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [
    value
  ];
}
function textOrNull(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}
function parseDateString(value) {
  if (value === null) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
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
function resolvePublishedAtMs(item) {
  const formalDateMs = parseDateString(item.publishedAt);
  if (formalDateMs !== null) return formalDateMs;
  if (item.link) {
    return extractTimestampFromUrl(item.link);
  }
  return null;
}
function isWithinLast48Hours(item, nowMs) {
  const publishedAtMs = resolvePublishedAtMs(item);
  if (publishedAtMs === null) {
    // Keep undated items rather than accidentally dropping valid content.
    return true;
  }
  const ageMs = nowMs - publishedAtMs;
  // Ignore obviously bad future-dated items.
  if (ageMs < -6 * 60 * 60 * 1000) {
    return false;
  }
  return ageMs <= MAX_ITEM_AGE_MS;
}
function parseRssItems(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    parseTagValue: true
  });
  const parsed = parser.parse(xml);
  const rssItems = asArray(parsed?.rss?.channel?.item).map((item)=>({
      title: textOrNull(item?.title),
      link: textOrNull(item?.link),
      publishedAt: textOrNull(item?.pubDate) ?? textOrNull(item?.published) ?? textOrNull(item?.updated) ?? textOrNull(item?.["dc:date"])
    }));
  if (rssItems.length > 0) {
    return rssItems;
  }
  const atomItems = asArray(parsed?.feed?.entry).map((entry)=>{
    let href = null;
    const linkNode = entry?.link;
    if (Array.isArray(linkNode)) {
      const alternate = linkNode.find((node)=>node?.["@_href"] && (!node?.["@_rel"] || node?.["@_rel"] === "alternate"));
      href = textOrNull(alternate?.["@_href"]);
    } else if (linkNode && typeof linkNode === "object") {
      href = textOrNull(linkNode?.["@_href"]);
    }
    return {
      title: textOrNull(entry?.title),
      link: href,
      publishedAt: textOrNull(entry?.published) ?? textOrNull(entry?.updated) ?? textOrNull(entry?.pubDate) ?? textOrNull(entry?.["dc:date"])
    };
  });
  return atomItems;
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
    const body = await req.json();
    log("parsed-body", {
      requestId,
      body
    });
    const { feed_url } = body;
    if (!feed_url || typeof feed_url !== "string") {
      log("invalid-input", {
        requestId,
        reason: "feed_url missing or not a string",
        receivedFeedUrlType: typeof feed_url
      });
      return new Response(JSON.stringify({
        error: "feed_url is required"
      }), {
        status: 400,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    log("env-check", {
      requestId,
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
      feed_url
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
    log("rss-fetch-start", {
      requestId,
      feed_url
    });
    const rssRes = await fetch(feed_url, {
      method: "GET",
      headers: {
        "User-Agent": "rss-checker/1.0",
        "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
      }
    });
    log("rss-fetch-finished", {
      requestId,
      status: rssRes.status,
      ok: rssRes.ok,
      contentType: rssRes.headers.get("content-type")
    });
    if (!rssRes.ok) {
      log("rss-fetch-failed", {
        requestId,
        status: rssRes.status,
        statusText: rssRes.statusText,
        feed_url
      });
      throw new Error(`RSS fetch failed: ${rssRes.status} ${rssRes.statusText}`);
    }
    const xml = await rssRes.text();
    log("rss-body", {
      requestId,
      xmlLength: xml.length,
      preview: xml.slice(0, 300)
    });
    const items = parseRssItems(xml);
    log("rss-parsed", {
      requestId,
      itemCount: items.length,
      sample: items.slice(0, 5)
    });
    const nowMs = Date.now();
    const recentItems = items.filter((item)=>{
      const keep = isWithinLast48Hours(item, nowMs);
      if (!keep) {
        log("rss-item-skipped-old", {
          requestId,
          title: item.title,
          link: item.link,
          publishedAt: item.publishedAt,
          resolvedPublishedAtMs: resolvePublishedAtMs(item)
        });
      }
      return keep;
    });
    log("rss-items-filtered-by-age", {
      requestId,
      originalItemCount: items.length,
      recentItemCount: recentItems.length,
      cutoffHours: 48,
      sample: recentItems.slice(0, 5)
    });
    const candidateLinks = recentItems.map((item)=>item.link).filter((link)=>typeof link === "string" && link.length > 0);
    log("candidate-links-built", {
      requestId,
      candidateLinkCount: candidateLinks.length,
      sample: candidateLinks.slice(0, 10)
    });
    const normalizedPairs = candidateLinks.flatMap((rawUrl)=>{
      const normalizedUrl = normalizeUserUrl(rawUrl);
      if (normalizedUrl === null) {
        log("candidate-link-skipped", {
          requestId,
          rawUrl,
          reason: "normalizeUserUrl returned null"
        });
        return [];
      }
      try {
        const urlKey = makeQueueUrlKey(normalizedUrl);
        return [
          {
            rawUrl,
            normalizedUrl,
            urlKey
          }
        ];
      } catch (error) {
        log("candidate-link-skipped", {
          requestId,
          rawUrl,
          normalizedUrl,
          reason: "makeQueueUrlKey failed",
          error: error instanceof Error ? error.message : String(error)
        });
        return [];
      }
    });
    log("normalized-pairs-built", {
      requestId,
      normalizedPairCount: normalizedPairs.length,
      sample: normalizedPairs.slice(0, 10)
    });
    const uniqueByKey = new Map();
    for (const item of normalizedPairs){
      if (!uniqueByKey.has(item.urlKey)) {
        uniqueByKey.set(item.urlKey, item);
      } else {
        log("duplicate-urlkey-skipped", {
          requestId,
          urlKey: item.urlKey,
          normalizedUrl: item.normalizedUrl
        });
      }
    }
    const urlKeys = [
      ...uniqueByKey.keys()
    ];
    log("urlkeys-ready", {
      requestId,
      urlKeyCount: urlKeys.length,
      sample: urlKeys.slice(0, 20)
    });
    if (urlKeys.length === 0) {
      log("early-return-no-urlkeys", {
        requestId
      });
      return new Response(JSON.stringify({
        checked: 0,
        existing: 0,
        invoked: 0,
        enqueued: []
      }), {
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    log("checking-existing-rows", {
      requestId,
      urlKeyCount: urlKeys.length
    });
    const { data: existingRows, error: existingError } = await supabase.from("article_queue").select("url").in("url", urlKeys);
    if (existingError) {
      log("existing-rows-query-failed", {
        requestId,
        error: existingError.message
      });
      throw existingError;
    }
    const existingSet = new Set((existingRows ?? []).map((row)=>row.url));
    const newItems = [
      ...uniqueByKey.values()
    ].filter((item)=>!existingSet.has(item.urlKey));
    log("queue-diff-computed", {
      requestId,
      checked: urlKeys.length,
      existing: existingSet.size,
      newItems: newItems.length,
      existingSample: [
        ...existingSet
      ].slice(0, 10),
      newItemSample: newItems.slice(0, 10)
    });
    const invokeResults = [];
    if (newItems.length === 0) {
      log("early-return-no-new-items", {
        requestId
      });
    }
    for (const item of newItems){
      const invokeUrl = `${supabaseUrl}/functions/v1/get-or-enqueue`;
      log("downstream-call-start", {
        requestId,
        targetFunction: "get-or-enqueue",
        invokeUrl,
        payload: {
          url: item.normalizedUrl
        },
        urlKey: item.urlKey
      });
      let res;
      try {
        res = await fetch(invokeUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            url: item.normalizedUrl
          })
        });
      } catch (error) {
        log("downstream-call-network-error", {
          requestId,
          targetFunction: "get-or-enqueue",
          url: item.normalizedUrl,
          urlKey: item.urlKey,
          error: error instanceof Error ? error.message : String(error)
        });
        invokeResults.push({
          url: item.normalizedUrl,
          ok: false,
          status: null,
          body: {
            error: error instanceof Error ? error.message : String(error)
          }
        });
        continue;
      }
      let responseBody = null;
      try {
        const rawText = await res.text();
        try {
          responseBody = rawText.length > 0 ? JSON.parse(rawText) : null;
        } catch  {
          responseBody = rawText;
        }
      } catch (error) {
        responseBody = {
          error: "Failed reading downstream response body",
          detail: error instanceof Error ? error.message : String(error)
        };
      }
      log("downstream-call-finished", {
        requestId,
        targetFunction: "get-or-enqueue",
        url: item.normalizedUrl,
        urlKey: item.urlKey,
        ok: res.ok,
        status: res.status,
        responseBody
      });
      if (res.ok) {
        log("downstream-call-succeeded", {
          requestId,
          targetFunction: "get-or-enqueue",
          url: item.normalizedUrl,
          status: res.status
        });
      } else {
        log("downstream-call-failed", {
          requestId,
          targetFunction: "get-or-enqueue",
          url: item.normalizedUrl,
          status: res.status,
          responseBody
        });
      }
      invokeResults.push({
        url: item.normalizedUrl,
        ok: res.ok,
        status: res.status,
        body: responseBody
      });
    }
    log("request-complete", {
      requestId,
      checked: urlKeys.length,
      existing: existingSet.size,
      invoked: newItems.length,
      successCount: invokeResults.filter((r)=>r.ok).length,
      failureCount: invokeResults.filter((r)=>!r.ok).length
    });
    return new Response(JSON.stringify({
      checked: urlKeys.length,
      existing: existingSet.size,
      invoked: newItems.length,
      enqueued: invokeResults
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
