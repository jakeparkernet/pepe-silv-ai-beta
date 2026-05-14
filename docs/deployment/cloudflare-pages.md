# Cloudflare Pages Deployment

This site should run on Cloudflare Pages as a static frontend only. Supabase remains the API layer, and the existing Supabase Edge Functions continue to call Fly, AWS/Lambda, Weaviate, and Stripe.

## Cloudflare Pages

- Project name: `pepe-silv-ai-beta`
- Production branch: `main`
- Framework preset: `None`
- Build command: `exit 0`
- Build output directory: `src/site/dev`
- Production custom domain: `https://pepesilv.ai`

`wrangler.toml` also sets `pages_build_output_dir = "src/site/dev"` so CLI and Git-based Pages deploys use the same static output directory.

Before moving DNS, preserve every existing record for `callback.pepesilv.ai`, Supabase verification, Stripe, email, and any Fly/AWS callbacks. Cloudflare Pages should not host or proxy those runtime endpoints in this deployment.

## Supabase Edge Functions

The browser calls these functions directly through Supabase:

- `get-or-enqueue`
- `get-evidence-batch`
- `company-pair-lookup`
- `company-pair-research-start`
- `create-checkout-session`

Internal function-to-function calls also require:

- `investigation_start`
- `process-queued-articles`
- `stripe-webhook`

Existing maintenance or diagnostic functions are separate from the website path:

- `check-rss-feed` is called by `check-rss-feeds` with `x-internal-key`, so it needs `verify_jwt = false`.
- `check-rss-feeds` currently has no request-level `x-internal-key` check; keep Supabase JWT verification on unless that handler is hardened.
- `safe-remove-old-articles` uses `x-internal-key`, so it needs `verify_jwt = false` if triggered outside Supabase JWT auth.
- `fly-test` is diagnostic and should stay JWT-protected unless intentionally exposed.
- `quick-processor` is currently an empty `index.ts` in this checkout and should not be treated as a production endpoint until implemented.

Keep `supabase/functions` in sync with `src/app/supabase_edge` before deploying. If the local checkout has `supabase/functions` owned by `nobody:nogroup`, fix ownership first:

```bash
sudo chown -R "$USER":"$USER" supabase/functions
```

Then sync the deployable function tree:

```bash
mkdir -p supabase/functions/company-pair-lookup
mkdir -p supabase/functions/company-pair-research-start
mkdir -p supabase/functions/create-checkout-session
mkdir -p supabase/functions/stripe-webhook
cp src/app/supabase_edge/get-or-enqueue.ts supabase/functions/get-or-enqueue/index.ts
cp src/app/supabase_edge/get_evidence_batch.ts supabase/functions/get-evidence-batch/index.ts
cp src/app/supabase_edge/investigation_start.ts supabase/functions/investigation_start/index.ts
cp src/app/supabase_edge/process-queued-articles.ts supabase/functions/process-queued-articles/index.ts
cp src/app/supabase_edge/company-pair-lookup.ts supabase/functions/company-pair-lookup/index.ts
cp src/app/supabase_edge/company-pair-research-start.ts supabase/functions/company-pair-research-start/index.ts
cp src/app/supabase_edge/create-checkout-session.ts supabase/functions/create-checkout-session/index.ts
cp src/app/supabase_edge/stripe-webhook.ts supabase/functions/stripe-webhook/index.ts
```

Deploy with JWT verification disabled for the browser-callable and internal-key handlers. `supabase/config.toml` records that setting, and the handler code still enforces user auth or `x-internal-key` where required.

```bash
supabase functions deploy get-or-enqueue
supabase functions deploy get-evidence-batch
supabase functions deploy check-rss-feed
supabase functions deploy investigation_start
supabase functions deploy process-queued-articles
supabase functions deploy company-pair-lookup
supabase functions deploy company-pair-research-start
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
supabase functions deploy safe-remove-old-articles
```

Deploy `check-rss-feeds`, `fly-test`, or `quick-processor` only if those existing endpoints are intentionally used in the target environment.

## Production Settings

Set these Supabase Edge Function secrets for production:

```bash
supabase secrets set ALLOWED_ORIGINS="https://pepesilv.ai,https://www.pepesilv.ai"
supabase secrets set SITE_URL="https://pepesilv.ai"
supabase secrets set PUBLIC_SITE_URL="https://pepesilv.ai"
```

Keep the existing production values for:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INTERNAL_EDGE_API_KEY`
- `PEPE_EDGE_KEY`
- `FLY_API_TOKEN`
- `FLY_APP_NAME`
- `COORDINATOR_BASE_URL`
- `PEPE_API_KEY`
- `AWS_ACCESS_KEY_ID_LAMBDA`
- `AWS_SECRET_ACCESS_KEY_LAMBDA`
- `AWS_DEFAULT_REGION_LAMBDA`
- `SCRAPE_PAGE_ARN` or `SCRAPE_PAGE_URL`
- `GET_LLM_RESPONSE_ARN` or `GET_LLM_RESPONSE_URL`
- `WEAVIATE_URL`
- `WEAVIATE_APIKEY` or `WEAVIATE_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Supabase Auth should use `https://pepesilv.ai` as the site URL and allow redirects for both `https://pepesilv.ai` and `https://www.pepesilv.ai`.

Stripe webhook endpoint:

```text
https://ukxcjdimupajklqdxbvr.supabase.co/functions/v1/stripe-webhook
```

## Verification

After DNS and deploy:

1. Open `https://pepesilv.ai` and confirm all static assets under `/resources`, `/js`, `main.css`, and `favicon.png` load without 404s.
2. Submit a supported article URL and confirm `get-or-enqueue` creates or reads `article_queue`.
3. Confirm `investigation_start` dispatches Fly work and writes an `ownership_trees` row.
4. Load an already-complete article and confirm `get-evidence-batch` returns evidence.
5. Sign in, create a Stripe checkout session, complete payment, and confirm `credit_ledger` receives the purchase from `stripe-webhook`.
6. Test company-pair lookup and research dispatch with a signed-in user.
