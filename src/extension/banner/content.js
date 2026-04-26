(() => {
  // =========================
  // Config (tweak these)
  // =========================
  const CFG = {
    // Stagger between word *starts* (controls overlap)
    baseDelayMs: 80,
    perWordStartOffsetMs: 400, // next word starts this much later than previous

    // Phase timings for each word
    fadeInMs: 500,
    holdMs: 300,
    settleMs: 520,

    // Opacity levels (subtle)
    initialOpacity: 0.78, // after fade-in completes, before settle
    settledOpacity: 0.92, // final opacity

    // Easing
    fadeInEasing: "ease-in",
    settleEasing: "cubic-bezier(0.2, 0.8, 0.2, 1)",

    // Visual vibe
    bannerTextColor: "rgba(235, 235, 235, 0.86)",
    bannerFontWeight: "700",
    bannerLetterSpacing: "0.2px",

    // Banner content fallback strings
    loadingText: "Loading…",
    notReadyText: "Article not ready yet, but check back soon.",
    failedText: "Failed to reach Pepe.",

    // Retry interval
    retryIntervalMs: 60000,
  };

  const BANNER_ID = "__dt_top_banner__";
  const SPACER_ID = "__dt_top_banner_spacer__";
  const STYLE_ID = "__dt_banner_wordfade_style__";

  if (document.getElementById(BANNER_ID)) return;

  if (!window.location.pathname || window.location.pathname === "/") return;

  // ---------- Banner ----------
  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.textContent = CFG.loadingText;

  banner.style.position = "fixed";
  banner.style.top = "0";
  banner.style.left = "0";
  banner.style.right = "0";
  banner.style.zIndex = "2147483647";
  banner.style.boxSizing = "border-box";
  banner.style.padding = "10px 14px";
  banner.style.fontFamily =
    "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
  banner.style.fontSize = "14px";
  banner.style.lineHeight = "1.3";
  banner.style.background = "rgba(20, 20, 20, 0.92)";
  banner.style.color = CFG.bannerTextColor;
  banner.style.fontWeight = CFG.bannerFontWeight;
  banner.style.letterSpacing = CFG.bannerLetterSpacing;
  banner.style.backdropFilter = "blur(6px)";
  banner.style.borderBottom = "1px solid rgba(255,255,255,0.15)";
  banner.style.pointerEvents = "auto";
  banner.style.cursor = "pointer";

  banner.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_PEPE_SILV", url: window.location.href });
  });

  // ---------- Spacer ----------
  const spacer = document.createElement("div");
  spacer.id = SPACER_ID;
  spacer.style.width = "100%";
  spacer.style.height = "0px";
  spacer.style.margin = "0";
  spacer.style.padding = "0";
  spacer.style.border = "0";
  spacer.style.display = "block";
  spacer.style.boxSizing = "border-box";
  spacer.style.pointerEvents = "none";
  spacer.setAttribute("aria-hidden", "true");

  // ---------- Layout helpers ----------
  const safeAreaTopPx = () => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    el.style.top = "0";
    el.style.left = "0";
    el.style.height = "env(safe-area-inset-top)";
    el.style.width = "0";
    el.style.pointerEvents = "none";
    document.documentElement.appendChild(el);
    const px = Math.ceil(el.getBoundingClientRect().height);
    el.remove();
    return Number.isFinite(px) ? px : 0;
  };

  const getBannerHeight = () => Math.ceil(banner.getBoundingClientRect().height);

  const detectScrollContainer = () => {
    const docEl = document.documentElement;
    const body = document.body;
    if (body) return body;
    return docEl;
  };

  const insertAtTop = (container, node) => {
    if (!container) return false;
    if (node.parentNode === container) return true;
    if (node.parentNode) node.parentNode.removeChild(node);
    node.style.flex = "0 0 auto";
    if (container.firstChild) container.insertBefore(node, container.firstChild);
    else container.appendChild(node);
    return true;
  };

  let container = null;
  let lastAppliedHeight = -1;
  let safeArea = 0;

  const applyLayout = () => {
    if (!banner.isConnected) return;

    if (!container || !container.isConnected) {
      container = detectScrollContainer();
      if (container) insertAtTop(container, spacer);
    } else if (!document.getElementById(SPACER_ID)) {
      insertAtTop(container, spacer);
    }

    const h = getBannerHeight() + safeArea;
    if (h !== lastAppliedHeight) {
      lastAppliedHeight = h;
      spacer.style.height = `${h}px`;
    }
  };

  // =========================
  // Word fade-in renderer
  // =========================
  const ensureWordFadeStyles = () => {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      @keyframes __dt_word_fade_in {
        from { opacity: 0; transform: translateY(1px); filter: blur(0.25px); }
        to   { opacity: ${CFG.initialOpacity}; transform: translateY(0); filter: blur(0); }
      }

      @keyframes __dt_word_settle {
        from { opacity: ${CFG.initialOpacity}; }
        to   { opacity: ${CFG.settledOpacity}; }
      }

      #${BANNER_ID} .__dt_word {
        opacity: 0;
        display: inline-block;
        white-space: pre;
        will-change: opacity, transform, filter;

        animation-name: __dt_word_fade_in, __dt_word_settle;
        animation-duration: ${CFG.fadeInMs}ms, ${CFG.settleMs}ms;
        animation-timing-function: ${CFG.fadeInEasing}, ${CFG.settleEasing};
        animation-fill-mode: forwards, forwards;
      }
    `;
    (document.documentElement || document).appendChild(style);
  };

  // Keeps most punctuation attached to neighboring words,
  // but the final period is rendered separately later.
  const tokenizeWithPunctuationAttachment = (rawText) => {
    const s = typeof rawText === "string" ? rawText.trim() : "";
    if (s.length === 0) return [];

    const tokens = s.split(/\s+/);
    const out = [];

    const isPunctOnly = (t) => /^[,;:!?%)\]\}]+$/.test(t);
    const isLeadingPunct = (t) => /^[([{\u201C\u2018"']+$/.test(t);

    for (let i = 0; i < tokens.length; i += 1) {
      const t = tokens[i];

      if (out.length > 0 && isPunctOnly(t)) {
        out[out.length - 1] = out[out.length - 1] + t;
        continue;
      }

      if (isLeadingPunct(t) && i + 1 < tokens.length) {
        const next = tokens[i + 1];
        out.push(t + next);
        i += 1;
        continue;
      }

      out.push(t);
    }

    return out;
  };

  // Your current behavior:
  // - append a period if one does not exist
  // Additional behavior requested:
  // - render the final period as its own fading token
  const buildRenderTokens = (rawText) => {
    const s = typeof rawText === "string" ? rawText.trim() : "";
    if (s.length === 0) return [];

    const sentenceText = s.endsWith(".") ? s : `${s}.`;
    const bodyText = sentenceText.slice(0, -1).trimEnd();

    const words = tokenizeWithPunctuationAttachment(bodyText);
    const tokens = [];

    for (let i = 0; i < words.length; i += 1) {
      const isLastWord = i === words.length - 1;
      tokens.push({
        text: words[i] + (isLastWord ? "" : " ")
      });
    }

    tokens.push({ text: "." });

    return tokens;
  };

  const renderBannerWordSequence = (text) => {
    ensureWordFadeStyles();

    while (banner.firstChild) banner.removeChild(banner.firstChild);

    const tokens = buildRenderTokens(text);

    for (let i = 0; i < tokens.length; i += 1) {
      const span = document.createElement("span");
      span.className = "__dt_word";
      span.textContent = tokens[i].text;

      const startDelay = CFG.baseDelayMs + i * CFG.perWordStartOffsetMs;
      const settleDelay = startDelay + CFG.fadeInMs + CFG.holdMs;

      span.style.animationDelay = `${startDelay}ms, ${settleDelay}ms`;
      banner.appendChild(span);
    }

    if (tokens.length === 0) {
      banner.textContent = "";
    }
  };

  // =========================
  // Messaging / data helpers
  // =========================
  const normalizeHost = (hostname) => {
    const h = String(hostname).trim().toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  };

  const sendMessageAsync = (message) => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;

        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        resolve(response);
      });
    });
  };

  const getBannerSummary = (result) => {
    const summary = result && typeof result.summary === "string"
      ? result.summary.trim()
      : "";

    return summary.length > 0 ? summary : null;
  };

  const showBanner = (bannerText) => {
    (document.documentElement || document).appendChild(banner);

    safeArea = safeAreaTopPx();
    container = detectScrollContainer();
    insertAtTop(container, spacer);

    const ro = new ResizeObserver(() => applyLayout());
    ro.observe(banner);

    window.addEventListener("resize", () => applyLayout(), { passive: true });

    const guard = new MutationObserver(() => {
      if (!document.getElementById(SPACER_ID) && container) {
        insertAtTop(container, spacer);
      }

      if (document.body && container !== document.body) {
        container = document.body;
        insertAtTop(container, spacer);
      }
    });

    guard.observe(document.documentElement, { childList: true, subtree: true });

    if (bannerText) {
      renderBannerWordSequence(bannerText);
    }
    applyLayout();
    requestAnimationFrame(() => applyLayout());
  };

  const loadBannerData = async () => {
    const domain = normalizeHost(window.location.hostname);

    const whitelistResp = await sendMessageAsync({
      type: "IS_DOMAIN_WHITELISTED",
      domain
    });

    if (!whitelistResp || whitelistResp.ok !== true) {
      return;
    }

    if (whitelistResp.isWhitelisted !== true) {
      return;
    }

    const tryGetResult = async () => {
      const resultResp = await sendMessageAsync({
        type: "GET_RESULT_FOR_URL",
        url: window.location.href
      });

      if (!resultResp || resultResp.ok !== true) {
        return { failed: true };
      }

      if (resultResp.result === null) {
        return { ready: false };
      }

      if (resultResp.result.status == "no-op") {
        return;
      }

      const bannerText = getBannerSummary(resultResp.result);

      if (bannerText === null) {
        return { ready: false };
      }

      return { ready: true, bannerText };
    };

    const checkAndShow = async () => {
      const result = await tryGetResult();

      if (!result) {
        return;
      }

      if (result.failed) {
        showBanner(CFG.failedText);
        return;
      }

      if (!result.ready) {
        showBanner(CFG.notReadyText);
        setTimeout(checkAndShow, CFG.retryIntervalMs);
        return;
      }

      showBanner(result.bannerText);
    };

    checkAndShow();
  };

  if (document.documentElement) loadBannerData();
  else {
    const t = setInterval(() => {
      if (document.documentElement) {
        clearInterval(t);
        loadBannerData();
      }
    }, 10);
  }
})();