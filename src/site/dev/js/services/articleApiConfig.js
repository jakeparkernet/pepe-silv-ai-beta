export const ARTICLE_API_CONFIG = Object.freeze({
    supabaseUrl: window.PEPE_SUPABASE_URL ?? "https://ukxcjdimupajklqdxbvr.supabase.co",
    supabasePublishableKey: window.PEPE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_8DfgTxdV87vYWW-fBkxTng_Whoii-zo",
    clerkPublishableKey: window.PEPE_CLERK_PUBLISHABLE_KEY ?? "",
    clerkFrontendApiUrl: window.PEPE_CLERK_FRONTEND_API_URL ?? "",
    authMode: window.PEPE_AUTH_MODE ?? "real",
    paymentsMode: window.PEPE_PAYMENTS_MODE ?? "real",
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
