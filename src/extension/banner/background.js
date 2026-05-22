const SUPABASE_URL = "https://ukxcjdimupajklqdxbvr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_8DfgTxdV87vYWW-fBkxTng_Whoii-zo";

function getAuthHeaders() {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
  };
}

function normalizeHost(hostname) {
  const h = String(hostname).trim().toLowerCase();
  return h.startsWith("www.") ? h.slice(4) : h;
}

function normalizePathname(pathname) {
  let p = pathname || "/";
  p = p.replace(/\/{2,}/g, "/");
  if (p.length > 1) {
    p = p.replace(/\/+$/g, "");
  }
  return p;
}

function normalizeUserUrl(raw) {
  let value = String(raw).trim();

  if (value.length === 0) {
    return null;
  }

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
  } catch (_err) {
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
  const isDefaultPort =
    port === "" ||
    (u.protocol === "https:" && port === "443") ||
    (u.protocol === "http:" && port === "80");

  const hostWithPort = isDefaultPort ? host : `${host}:${port}`;
  const path = normalizePathname(u.pathname);

  return `${hostWithPort}${path}`;
}

function parseJsonRecursively(value) {
  const seen = new WeakMap();

  const walk = (v) => {
    if (v === null) return null;

    const t = typeof v;

    if (t === "string") {
      const s = v.trim();
      if (s.length === 0) return v;

      const first = s[0];
      const looksJsony =
        first === "{" ||
        first === "[" ||
        first === "\"" ||
        first === "t" ||
        first === "f" ||
        first === "n" ||
        first === "-" ||
        (first >= "0" && first <= "9");

      if (!looksJsony) return v;

      try {
        return walk(JSON.parse(s));
      } catch (_err) {
        return v;
      }
    }

    if (t !== "object") return v;

    if (seen.has(v)) {
      return seen.get(v);
    }

    if (Array.isArray(v)) {
      const copy = [];
      seen.set(v, copy);

      for (let i = 0; i < v.length; i += 1) {
        copy[i] = walk(v[i]);
      }

      return copy;
    }

    const proto = Object.getPrototypeOf(v);
    const isPlain = proto === Object.prototype || proto === null;

    if (!isPlain) {
      return v;
    }

    const copy = {};
    seen.set(v, copy);

    for (const key of Object.keys(v)) {
      copy[key] = walk(v[key]);
    }

    return copy;
  };

  return walk(value);
}

async function supabaseFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase error ${res.status}: ${body}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }

  return res.text();
}

async function getExistingQueueRow(urlKey) {
  const encoded = encodeURIComponent(urlKey);

  const rows = await supabaseFetch(
    `/rest/v1/article_queue?select=*&url=eq.${encoded}`,
    {
      method: "GET",
      headers: {
        Prefer: "count=exact",
      },
    }
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
}

async function invokeGetOrEnqueue(normalizedTargetUrl) {
  return supabaseFetch(`/functions/v1/get-or-enqueue`, {
    method: "POST",
    body: JSON.stringify({ url: normalizedTargetUrl }),
  });
}

async function getOwnershipTreeById(id) {
  const encoded = encodeURIComponent(id);

  const rows = await supabaseFetch(
    `/rest/v1/ownership_trees?select=*&id=eq.${encoded}&limit=1`,
    {
      method: "GET",
    }
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    return null;
  }

  return rows[0];
}

async function fetchArticleLikeWebsite(targetUrl) {
  const normalizedTargetUrl = normalizeUserUrl(targetUrl);

  if (normalizedTargetUrl === null) {
    throw new Error("Invalid URL");
  }

  const urlKey = makeQueueUrlKey(normalizedTargetUrl);

  let queueRow = await getExistingQueueRow(urlKey);

  if (queueRow === null) {
    const fnData = await invokeGetOrEnqueue(normalizedTargetUrl);

    if (!fnData || fnData.site_valid !== true) {
      return { status: "unsupported" };
    }

    queueRow = fnData.queue || null;
  }

  if (queueRow === null) {
    return { status: "unsupported" };
  }

  if (queueRow.status === "no-op") {
    return { status: "no-op" };
  }

  const ownershipTreeId = queueRow.ownership_tree_id;

  if (ownershipTreeId == null) {
    return { status: "pending" };
  }

  const ownershipTreeRow = await getOwnershipTreeById(ownershipTreeId);

  if (ownershipTreeRow === null) {
    return null;
  }

  return parseJsonRecursively(ownershipTreeRow);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "GET_RESULT_FOR_URL") {
    (async () => {
      try {
        const url = typeof msg.url === "string" ? msg.url : null;

        if (url === null) {
          sendResponse({ ok: false, error: "Missing msg.url (string)" });
          return;
        }

        const result = await fetchArticleLikeWebsite(url);
        sendResponse({ ok: true, result });
      } catch (err) {
        sendResponse({
          ok: false,
          error: String(err && err.message ? err.message : err),
        });
      }
    })();

    return true;
  }

  if (msg && msg.type === "OPEN_PEPE_SILV") {
    (async () => {
      try {
        const url = typeof msg.url === "string" ? msg.url : null;
        const targetUrl = url || "https://pepesilv.ai";

        await chrome.tabs.create({
          url: `https://pepesilv.ai?url=${encodeURIComponent(targetUrl)}`,
          active: true
        });

        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({
          ok: false,
          error: String(err && err.message ? err.message : err),
        });
      }
    })();

    return true;
  }

  if (msg && msg.type === "OPEN_POPUP") {
    (async () => {
      try {
        await chrome.action.openPopup();
        sendResponse({ ok: true });
      } catch (err) {
        // Fallback: open as tab
        await chrome.tabs.create({
          url: chrome.runtime.getURL("popup.html")
        });

        sendResponse({ ok: true, fallback: true });
      }
    })();

    return true;
  }

  return false;
});
