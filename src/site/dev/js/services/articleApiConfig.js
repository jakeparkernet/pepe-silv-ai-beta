export const ARTICLE_API_CONFIG = Object.freeze({
    supabaseUrl: "https://ukxcjdimupajklqdxbvr.supabase.co",
    supabasePublishableKey: "sb_publishable_8DfgTxdV87vYWW-fBkxTng_Whoii-zo",
    clerkPublishableKey: window.PEPE_CLERK_PUBLISHABLE_KEY ?? "",
    clerkFrontendApiUrl: window.PEPE_CLERK_FRONTEND_API_URL ?? "",
    creditPackId: "credits_10",
    creditPackAmountUsd: 10,
    defaultBaseUrl: "https://callback.pepesilv.ai",
    supportedSitesPrefix: /^Supported sites:\s*/i,
    maxQueuePollAttempts: 20,
    queuePollDelayMs: 150
});
