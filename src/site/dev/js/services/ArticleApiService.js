import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// import { ARTICLE_API_CONFIG } from "./articleApiConfig.js";
// 
const appModules = window[`apps_${performance.timeOrigin}`].modules;
const { ARTICLE_API_CONFIG } = appModules.services.articleApiConfig;

class ArticleApiService {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl ?? ARTICLE_API_CONFIG.defaultBaseUrl;
        this.supabaseUrl = options.supabaseUrl ?? ARTICLE_API_CONFIG.supabaseUrl;
        this.supabaseKey = options.supabaseKey ?? ARTICLE_API_CONFIG.supabasePublishableKey;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.logger = options.logger ?? console;
        this.supportedSitesText = options.supportedSitesText ?? "";
        this.maxQueuePollAttempts = options.maxQueuePollAttempts ?? ARTICLE_API_CONFIG.maxQueuePollAttempts;
        this.queuePollDelayMs = options.queuePollDelayMs ?? ARTICLE_API_CONFIG.queuePollDelayMs;
        this.createSupabaseClient = options.createSupabaseClient ?? ((url, key) => createClient(url, key));
        this.supabaseClient = options.supabaseClient ?? null;
    }

    setSupportedSitesText(text) {
        this.supportedSitesText = text ?? "";
    }

    getSupabaseClient() {
        if (this.supabaseClient != null) {
            return this.supabaseClient;
        }

        this.supabaseClient = this.createSupabaseClient(this.supabaseUrl, this.supabaseKey);
        return this.supabaseClient;
    }

    async healthCheck() {
        const url = new URL(`${this.baseUrl}/api/health`);

        try {
            const res = await this.fetchImpl(url.toString(), { method: "GET" });

            if (!res.ok) {
                const error = new Error(`healthCheck failed: ${res.status} ${res.statusText}`);
                error.status = res.status;
                error.statusText = res.statusText;
                throw error;
            }

            return await res.json();
        } catch (exception) {
            this.logger?.log?.(exception);
            throw exception;
        }
    }

    normalizeHost(hostname) {
        const h = String(hostname).trim().toLowerCase();
        return h.startsWith("www.") ? h.slice(4) : h;
    }

    normalizePathname(pathname) {
        let p = pathname || "/";
        p = p.replace(/\/{2,}/g, "/");
        if (p.length > 1) {
            p = p.replace(/\/+$/g, "");
        }
        return p;
    }

    normalizeUserUrl(raw) {
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

            const hostname = u.hostname;
            const isIpv4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(hostname);
            const isLocalhost = hostname === "localhost";
            const hasValidDomainShape =
                hostname.includes(".") &&
                !hostname.startsWith(".") &&
                !hostname.endsWith(".") &&
                !hostname.split(".").some((part) => part.length === 0) &&
                /^[a-z0-9.-]+$/i.test(hostname);

            if (!isIpv4 && !isLocalhost && !hasValidDomainShape) {
                return null;
            }

            return u.toString();
        } catch (_err) {
            return null;
        }
    }

    makeQueueUrlKey(rawUrl) {
        const normalized = this.normalizeUserUrl(rawUrl);

        if (normalized === null) {
            throw new Error("Invalid URL");
        }

        const u = new URL(normalized);
        const host = this.normalizeHost(u.hostname);

        const port = u.port;
        const isDefaultPort =
            port === "" ||
            (u.protocol === "https:" && port === "443") ||
            (u.protocol === "http:" && port === "80");
        const hostWithPort = isDefaultPort ? host : `${host}:${port}`;

        const path = this.normalizePathname(u.pathname);

        return `${hostWithPort}${path}`;
    }

    getSupportedSiteDomains(supportedSitesText = this.supportedSitesText) {
        const text = String(supportedSitesText ?? "").trim();

        if (text.length === 0) {
            return new Set();
        }

        const listText = text.replace(ARTICLE_API_CONFIG.supportedSitesPrefix, "");
        const domains = listText
            .split(/\s+/)
            .map((value) => this.normalizeHost(value))
            .filter((value) => value.length > 0);

        return new Set(domains);
    }

    isSupportedSiteUrl(rawUrl) {
        const normalizedUrl = this.normalizeUserUrl(rawUrl);

        if (normalizedUrl == null) {
            return false;
        }

        const hostname = this.normalizeHost(new URL(normalizedUrl).hostname);
        return this.getSupportedSiteDomains().has(hostname);
    }

    parseJsonRecursively(value) {
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
                    const parsed = JSON.parse(s);
                    return walk(parsed);
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

    async getArticleQueueRowByUrl(targetUrl, supabase = this.getSupabaseClient()) {
        const normalizedTargetUrl = this.normalizeUserUrl(targetUrl);

        if (normalizedTargetUrl === null) {
            return { data: null, error: new Error("Invalid URL") };
        }

        let urlKey = null;

        try {
            urlKey = this.makeQueueUrlKey(normalizedTargetUrl);
        } catch (error) {
            return { data: null, error };
        }

        return await supabase
            .from("article_queue")
            .select("*")
            .eq("url", urlKey)
            .maybeSingle();
    }

    async getOrEnqueueArticleQueueRow(targetUrl, supabase = this.getSupabaseClient()) {
        const normalizedTargetUrl = this.normalizeUserUrl(targetUrl);

        if (normalizedTargetUrl === null) {
            return { data: null, error: new Error("Invalid URL") };
        }

        let urlKey = null;

        try {
            urlKey = this.makeQueueUrlKey(normalizedTargetUrl);
        } catch (error) {
            return { data: null, error };
        }

        const { data: existingRow, error: readErr } = await supabase
            .from("article_queue")
            .select("*")
            .eq("url", urlKey)
            .maybeSingle();

        if (readErr) return { data: null, error: readErr };
        if (existingRow) return { data: existingRow, error: null };

        this.logger?.log?.("[submit-flow] getOrEnqueueArticleQueueRow invoke start", {
            targetUrl: normalizedTargetUrl,
            urlKey
        });

        const invokePromise = supabase.functions
            .invoke("get-or-enqueue", {
                body: {
                    url: normalizedTargetUrl,
                    use_edge_pre_investigation_check: true
                }
            })
            .then(({ data, error }) => ({ data, error }))
            .catch((error) => ({ data: null, error }));

        for (let attempt = 0; attempt < this.maxQueuePollAttempts; attempt += 1) {
            const queueResult = await this.getArticleQueueRowByUrl(normalizedTargetUrl, supabase);

            if (queueResult.error == null && queueResult.data != null) {
                this.logger?.log?.("[submit-flow] getOrEnqueueArticleQueueRow queue observed", {
                    targetUrl: normalizedTargetUrl,
                    urlKey,
                    attempt,
                    status: queueResult.data.status ?? null,
                    ownership_tree_id: queueResult.data.ownership_tree_id ?? null
                });
                return queueResult;
            }

            if (queueResult.error != null) {
                this.logger?.log?.("[submit-flow] getOrEnqueueArticleQueueRow queue read error", {
                    targetUrl: normalizedTargetUrl,
                    urlKey,
                    attempt,
                    error: queueResult.error?.message ?? String(queueResult.error)
                });
            }

            const invokeRace = await Promise.race([
                invokePromise.then((result) => ({
                    type: "invoke",
                    result
                })),
                this.wait(this.queuePollDelayMs).then(() => ({
                    type: "wait"
                }))
            ]);

            if (invokeRace.type === "invoke") {
                const { data: fnData, error: fnErr } = invokeRace.result;
                this.logger?.log?.("[submit-flow] getOrEnqueueArticleQueueRow invoke resolved", {
                    targetUrl: normalizedTargetUrl,
                    urlKey,
                    attempt,
                    hasFnData: fnData != null,
                    error: fnErr?.message ?? null,
                    site_valid: fnData?.site_valid ?? null,
                    status: fnData?.queue?.status ?? null,
                    ownership_tree_id: fnData?.queue?.ownership_tree_id ?? null
                });

                if (fnErr) {
                    return { data: fnData, error: fnErr };
                }

                if (!fnData || fnData.site_valid !== true) {
                    return { data: null, error: null };
                }

                const finalQueueRead = await this.getArticleQueueRowByUrl(normalizedTargetUrl, supabase);
                if (finalQueueRead.error == null && finalQueueRead.data != null) {
                    return finalQueueRead;
                }

                return { data: fnData.queue ?? null, error: null };
            }
        }

        const { data: fnData, error: fnErr } = await invokePromise;
        this.logger?.log?.("[submit-flow] getOrEnqueueArticleQueueRow invoke fallback", {
            targetUrl: normalizedTargetUrl,
            urlKey,
            hasFnData: fnData != null,
            error: fnErr?.message ?? null,
            site_valid: fnData?.site_valid ?? null,
            status: fnData?.queue?.status ?? null,
            ownership_tree_id: fnData?.queue?.ownership_tree_id ?? null
        });

        if (fnErr) {
            return { data: fnData, error: fnErr };
        }

        if (!fnData || fnData.site_valid !== true) {
            return { data: null, error: null };
        }

        const finalQueueRead = await this.getArticleQueueRowByUrl(normalizedTargetUrl, supabase);
        if (finalQueueRead.error == null && finalQueueRead.data != null) {
            return finalQueueRead;
        }

        return { data: fnData.queue ?? null, error: null };
    }

    async fetchOwnershipTreeById(ownershipTreeId, supabase = this.getSupabaseClient()) {
        const ownershipTreeResult = await supabase
            .from("ownership_trees")
            .select("*")
            .eq("id", ownershipTreeId)
            .single();

        if (ownershipTreeResult.error !== null) {
            this.logger?.error?.("Fetch error:", ownershipTreeResult.error.message);
            return null;
        }

        return this.parseJsonRecursively(ownershipTreeResult.data);
    }

    buildCompanyPairArticleObject(rawLookupData) {
        const data = this.parseJsonRecursively(rawLookupData ?? {});
        const ownershipTreeObj = data.ownership_tree_row ?? data.ownershipTreeObj ?? data.ownership_tree_obj ?? null;

        if (ownershipTreeObj == null) {
            return null;
        }

        const companyAName =
            data.company_a_entity?.name ??
            data.company_a?.name ??
            ownershipTreeObj.investigation_data?.article_subject?.name ??
            "Company A";
        const companyBName =
            data.company_b_entity?.name ??
            data.company_b?.name ??
            ownershipTreeObj.investigation_data?.news_site?.name ??
            "Company B";
        const pairLabel = `${companyAName} / ${companyBName}`;

        return {
            mode: "company_pair",
            article: {
                id: data.company_pair_request_id ?? ownershipTreeObj.id,
                url: pairLabel,
                status: "complete",
                mode: "company_pair",
                ownership_tree_id: ownershipTreeObj.id
            },
            ownershipTreeObj,
            ownership_tree: ownershipTreeObj.ownership_tree ?? null,
            investigation_prepass_results: data.prepass ?? null,
            company_pair: {
                company_a: data.company_a ?? null,
                company_b: data.company_b ?? null,
                company_a_entity: data.company_a_entity ?? null,
                company_b_entity: data.company_b_entity ?? null
            }
        };
    }

    async lookupCompanyPair(payload, supabase = this.getSupabaseClient()) {
        const { data, error } = await supabase.functions.invoke("company-pair-lookup", {
            body: payload
        });

        if (error) {
            return { data: null, error, articleObject: null };
        }

        const parsedData = this.parseJsonRecursively(data);
        return {
            data: parsedData,
            error: null,
            articleObject: this.buildCompanyPairArticleObject(parsedData)
        };
    }

    async startCompanyPairResearch(payload, supabase = this.getSupabaseClient()) {
        const { data, error } = await supabase.functions.invoke("company-pair-research-start", {
            body: payload
        });

        return {
            data: this.parseJsonRecursively(data),
            error
        };
    }

    async createCheckoutSession({ amountUsd = 10 } = {}, supabase = this.getSupabaseClient()) {
        const { data, error } = await supabase.functions.invoke("create-checkout-session", {
            body: {
                amount_usd: amountUsd
            }
        });

        return {
            data: this.parseJsonRecursively(data),
            error
        };
    }

    async getSession(supabase = this.getSupabaseClient()) {
        return await supabase.auth.getSession();
    }

    async getCurrentUser(supabase = this.getSupabaseClient()) {
        return await supabase.auth.getUser();
    }

    async signInWithPassword({ email, password }, supabase = this.getSupabaseClient()) {
        return await supabase.auth.signInWithPassword({ email, password });
    }

    async signUpWithPassword({ email, password }, supabase = this.getSupabaseClient()) {
        return await supabase.auth.signUp({ email, password });
    }

    async signOut(supabase = this.getSupabaseClient()) {
        return await supabase.auth.signOut();
    }

    async getArticleByUrl(targetUrl, supabase = this.getSupabaseClient()) {
        this.logger?.log?.("[submit-flow] getArticleByUrl start", {
            targetUrl
        });

        const articleResult = await this.getOrEnqueueArticleQueueRow(targetUrl, supabase);

        this.logger?.log?.("[submit-flow] getOrEnqueueArticleQueueRow result", {
            targetUrl,
            hasData: articleResult?.data != null,
            error: articleResult?.error?.message ?? null,
            status: articleResult?.data?.status ?? null,
            ownership_tree_id: articleResult?.data?.ownership_tree_id ?? null
        });

        if (articleResult.error !== null) {
            this.logger?.error?.("Fetch error:", articleResult.error.message);
            return null;
        }

        if (articleResult.data === null) {
            return null;
        }

        const article = this.parseJsonRecursively(articleResult.data);
        const ownership_tree_id = article?.ownership_tree_id ?? null;
        let ownershipTreeObj = null;

        if (ownership_tree_id != null) {
            ownershipTreeObj = await this.fetchOwnershipTreeById(ownership_tree_id, supabase);
        }

        return {
            article,
            ownershipTreeObj,
            ownership_tree: ownershipTreeObj?.ownership_tree ?? null,
            investigation_prepass_results: article?.investigation_prepass_results ?? null
        };
    }

    async collectEvidence(ids, supabase = this.getSupabaseClient()) {
        const requestedIds = Array.from(new Set(Array.isArray(ids) ? ids : Array.from(ids ?? [])));

        const { data, error } = await supabase.functions.invoke("get-evidence-batch", {
            body: { ids: requestedIds }
        });

        if (error) {
            const status = error.context?.status ?? null;
            let text = null;

            try {
                text = await error.context?.text?.();
            } catch (_err) {
                text = null;
            }

            this.logger?.warn?.("[evidence] get-evidence-batch failed", {
                status,
                message: error.message,
                requestedCount: requestedIds.length,
                body: text
            });

            try {
                if (text) {
                    this.logger?.warn?.("[evidence] parsed error body", JSON.parse(text));
                }
            } catch (_err) {
                // Best-effort logging only.
            }

            return { data: null, error };
        }

        const evidenceMap = {};
        const evidence = Array.isArray(data?.evidence) ? data.evidence : [];

        for (let i = 0; i < evidence.length; i += 1) {
            const evidenceData = evidence[i];

            evidenceMap[evidenceData.uuid] = {
                id: evidenceData.uuid,
                date: evidenceData.date
                    ? evidenceData.date
                    : evidenceData._additional
                        ? new Date(Number(evidenceData._additional.creationTimeUnix))
                        : null,
                source: evidenceData.source,
                excerpt: evidenceData.excerpt,
                raw: evidenceData
            };
        }

        return { data: evidenceMap, error: null };
    }

    wait(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }
}

export { ArticleApiService };
