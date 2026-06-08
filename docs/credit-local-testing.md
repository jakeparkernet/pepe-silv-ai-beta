# Credit Funding Local Testing

This workflow keeps production untouched. Use Stripe test keys, a Clerk dev
instance, and the local Supabase stack.

## Required Local Configuration

Create a local Edge Function env file outside committed secrets, for example
`supabase/.env.local`:

```bash
SUPABASE_URL=http://127.0.0.1:55421
SUPABASE_SERVICE_ROLE_KEY=<local service_role key from supabase start>
INTERNAL_EDGE_API_KEY=local-internal-key
CLERK_JWT_KEY=<clerk jwt key>
CLERK_SECRET_KEY=<clerk secret key>
CLERK_AUTHORIZED_PARTIES=http://127.0.0.1:3000,http://localhost:3000
STRIPE_SECRET_KEY=<stripe test secret key>
STRIPE_WEBHOOK_SECRET=<stripe cli webhook secret>
PEPE_AUTH_MODE=real
PEPE_PAYMENTS_MODE=real
PEPE_ALLOWED_TESTER_EMAILS=actorjakeparker@gmail.com
SITE_URL=http://127.0.0.1:3000
PUBLIC_SITE_URL=http://127.0.0.1:3000
ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
RESEND_API_KEY=
FUNDING_NOTICE_FROM_EMAIL=Pepe Silv.AI <notifications@example.test>
```

The notice sender marks rows `skipped` when Clerk or Resend credentials are not
configured, which gives a local no-email path for testing the queue.

The browser account and funding actions go through Edge Functions that verify
Clerk tokens themselves, so local Supabase Auth does not need Clerk third-party
auth enabled for credit-flow testing. If you intentionally want direct Supabase
RLS testing with Clerk JWTs, enable `[auth.third_party.clerk]` in
`supabase/config.toml` and set the Clerk domain from the Clerk Supabase setup
page before `supabase start`.

## Browser Runtime Config

For local testing, set `src/site/dev/runtime-config.js` to point at the local
Supabase stack and Clerk dev app:

```js
window.PEPE_SUPABASE_URL = "http://127.0.0.1:55421";
window.PEPE_SUPABASE_PUBLISHABLE_KEY = "<local anon key from supabase start>";
window.PEPE_DEFAULT_BASE_URL = "http://127.0.0.1:55421/functions/v1";
window.PEPE_CLERK_PUBLISHABLE_KEY = "<clerk publishable key>";
window.PEPE_CLERK_FRONTEND_API_URL = ""; // optional; derived from the publishable key
window.PEPE_ALLOWED_TESTER_EMAILS = "actorjakeparker@gmail.com";
window.PEPE_BUILD_COMMIT_HASH = "";
window.PEPE_COMPANY_PAIR_URL_INPUT_ENABLED = false;
```

Open `http://127.0.0.1:3000/?tester=true` to reveal the hidden sign-in link.
`?signup=true` is kept as a temporary alias for the same tester gate.

Do not commit real keys.

## Fully Local Mock Auth And Checkout

For a no-Clerk/no-Stripe browser loop, keep the local Supabase stack running and
set the local Edge Function env to:

```bash
PEPE_AUTH_MODE=mock
PEPE_PAYMENTS_MODE=mock
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Then set the browser runtime config to:

```js
window.PEPE_AUTH_MODE = "mock";
window.PEPE_PAYMENTS_MODE = "mock";
window.PEPE_ALLOWED_TESTER_EMAILS = "actorjakeparker@gmail.com";
```

In this mode, the static page stores a local mock user id in `localStorage`, the
checkout function creates a `cs_mock_...` session, and credits are granted through
the real Supabase `credit_accounts`, `credit_ledger`, and
`stripe_checkout_sessions` tables. The funding and account preference buttons use
the `credit-account` Edge Function so the same database RPCs are exercised
without a Clerk JWT.

## Run Locally

```bash
supabase start
supabase db reset --local
supabase functions serve --env-file supabase/.env.local
```

In another shell, serve the site:

```bash
cd src/site/dev
../../../.venv/bin/python -m http.server 3000
```

If the relative venv path is not available from that directory, run from the repo
root instead:

```bash
.venv/bin/python -m http.server 3000 --directory src/site/dev
```

Enable the gated credit flow in local Supabase Studio or SQL:

```sql
update public.site_feature_flags
set enabled = true, updated_at = now()
where key = 'investigation_credits';
```

Seed local test credits for your Clerk user id:

```sql
insert into public.credit_accounts(user_id)
values ('user_xxx')
on conflict (user_id) do update set updated_at = now();

insert into public.credit_ledger(user_id, amount_usd, entry_type, metadata)
values ('user_xxx', 10, 'adjustment', '{"reason":"local_test"}'::jsonb);
```

## Stripe Test Webhook

Use the Stripe CLI in test mode:

```bash
stripe listen --forward-to http://127.0.0.1:55421/functions/v1/stripe-webhook
```

Copy the printed webhook signing secret into `STRIPE_WEBHOOK_SECRET`, restart
`supabase functions serve`, then sign in locally and use `Buy $10 credits`.

## Checks

Run the local verification suite before deploying:

```bash
.venv/bin/python -m unittest tests/test_credit_funding.py tests/test_credit_source_contracts.py
node --check src/site/dev/js/app.js
node --check src/site/dev/js/services/ArticleApiService.js
node --check src/site/dev/js/controllers/ArticleSubmissionController.js
supabase db lint --local --fail-on error
git diff --check
```

The full investigation path still depends on the existing callback worker,
OpenRouter, and Fly.io runtime configuration. The credit-specific local checks
are: sign-in links appear only when the feature flag is enabled, checkout creates
a Stripe test session only while enabled, credit balance updates after webhook
completion, a new URL start debits the flat `$0.05`, running costs are shown
while queued/in progress, and insufficient credits move the row to
`paused/needs_funding`.
