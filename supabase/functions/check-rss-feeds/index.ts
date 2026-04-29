import { createClient } from "npm:@supabase/supabase-js@2";
function log(scope, message, data = null) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    scope,
    message,
    data
  }));
}
Deno.serve(async (req)=>{
  const runId = crypto.randomUUID();
  try {
    log("handler", "check-rss-feeds invocation started", {
      runId,
      method: req.method,
      url: req.url
    });
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const internalKey = Deno.env.get("INTERNAL_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }
    if (!internalKey) {
      throw new Error("Missing INTERNAL_KEY");
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    log("handler", "Loading sites", {
      runId
    });
    const { data: sites, error: sitesError } = await supabase.from("sites").select("id, rss");
    if (sitesError) {
      throw sitesError;
    }
    const usableSites = (sites ?? []).filter((site)=>Array.isArray(site.rss) && site.rss.some((feed)=>typeof feed === "string" && feed.trim().length > 0));
    log("handler", "Sites filtered", {
      runId,
      totalSites: (sites ?? []).length,
      sitesWithRss: usableSites.length
    });
    const summary = [];
    for (const site of usableSites){
      const feedUrls = Array.isArray(site.rss) ? site.rss : [];
      for (const rssValue of feedUrls){
        const feedUrl = String(rssValue).trim();
        if (feedUrl.length === 0) {
          continue;
        }
        log("invoke", "Calling check-rss-feed", {
          runId,
          siteId: site.id,
          feedUrl
        });
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/check-rss-feed`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-internal-key": internalKey
            },
            body: JSON.stringify({
              feed_url: feedUrl
            })
          });
          let body = null;
          try {
            body = await res.json();
          } catch  {
            body = await res.text().catch(()=>null);
          }
          summary.push({
            site_id: site.id,
            rss: feedUrl,
            ok: res.ok,
            status: res.status,
            body,
            error: res.ok ? null : `check-rss-feed failed with status ${res.status}`
          });
        } catch (err) {
          summary.push({
            site_id: site.id,
            rss: feedUrl,
            ok: false,
            status: null,
            body: null,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }
    const responseBody = {
      runId,
      sites_total: (sites ?? []).length,
      sites_with_rss: usableSites.length,
      results: summary
    };
    log("handler", "check-rss-feeds invocation complete", responseBody);
    return new Response(JSON.stringify(responseBody), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (error) {
    const responseBody = {
      error: error instanceof Error ? error.message : String(error)
    };
    log("handler", "check-rss-feeds invocation failed", {
      runId,
      responseBody
    });
    return new Response(JSON.stringify(responseBody), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
