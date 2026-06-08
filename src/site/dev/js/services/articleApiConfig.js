function nonEmptyString(value, fallback = "") {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : fallback;
}

function clerkFrontendApiUrlFromPublishableKey(publishableKey) {
    const normalized = nonEmptyString(publishableKey);
    if (!normalized) {
        return "";
    }

    const parts = normalized.split("_");
    if (parts.length < 3) {
        return "";
    }

    try {
        const decoded = atob(parts[2]).replace(/\$$/, "");
        return decoded ? `https://${decoded}` : "";
    } catch (error) {
        console.warn("[auth] Unable to derive Clerk frontend URL from publishable key.", error);
        return "";
    }
}

const clerkPublishableKey = nonEmptyString(
    window.PEPE_CLERK_PUBLISHABLE_KEY,
    nonEmptyString(window.CLERK_PUBLISHABLE_KEY, nonEmptyString(window.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY))
);
const clerkFrontendApiUrl = nonEmptyString(
    window.PEPE_CLERK_FRONTEND_API_URL,
    clerkFrontendApiUrlFromPublishableKey(clerkPublishableKey)
);

export const ARTICLE_API_CONFIG = Object.freeze({
    supabaseUrl: nonEmptyString(window.PEPE_SUPABASE_URL, "https://ukxcjdimupajklqdxbvr.supabase.co"),
    supabasePublishableKey: nonEmptyString(window.PEPE_SUPABASE_PUBLISHABLE_KEY, "sb_publishable_8DfgTxdV87vYWW-fBkxTng_Whoii-zo"),
    clerkPublishableKey,
    clerkFrontendApiUrl,
    authMode: nonEmptyString(window.PEPE_AUTH_MODE, "real"),
    paymentsMode: nonEmptyString(window.PEPE_PAYMENTS_MODE, "real"),
    allowedTesterEmails: String(window.PEPE_ALLOWED_TESTER_EMAILS ?? "actorjakeparker@gmail.com")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0),
    creditPackId: "credits_10",
    creditPackAmountUsd: 10,
    defaultBaseUrl: window.PEPE_DEFAULT_BASE_URL ?? "https://callback.pepesilv.ai",
    supportedSitesPrefix: /^Supported sites:\s*/i,
    maxQueuePollAttempts: 20,
    queuePollDelayMs: 150
});
