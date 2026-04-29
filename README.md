# Pepe Silv.AI

Pepe Silv.AI is a website and Chrome extension for surfacing financial conflicts of interest in news coverage.

Given a news article URL, Pepe tries to answer a simple question:

> Does the company being covered and the news outlet covering it share meaningful ownership or financial control?

To do that, the system:

1. Validates that the URL belongs to a supported news site.
2. Scrapes and analyzes the article.
3. Identifies the primary company or product featured in the story.
4. Identifies the publisher behind the news site.
5. Recursively traces ownership upward on both sides.
6. Looks for common owners, ranks them, and stores the result.
7. Renders the investigation as an interactive visualization on the website and in the Chrome extension.

## What This Repo Contains

This repository contains the full stack for the product:

- `src/site/dev`
  - The public website.
  - Vanilla HTML/CSS/ES modules.
  - Uses Three.js and D3 to render investigation results.
- `src/extension/banner`
  - The Chrome extension.
  - Adds a Pepe Silv.AI summary banner to supported pages and talks directly to Supabase.
- `src/app`
  - The Python backend and job system.
  - Contains the coordinator server, runtime, investigation jobs, database abstractions, and AWS/Fly integration.
- `src/app/supabase_edge`
  - Supabase Edge Functions.
  - Handles URL intake, pre-investigation checks, dispatch to Fly machines, queued article processing, and evidence batch fetching.

## Product Overview

Pepe Silv.AI is built around an investigation pipeline.

- The website or extension submits a URL.
- Supabase checks whether the article has already been processed.
- If not, Supabase runs a pre-investigation pass and, when necessary, dispatches work to the Python backend running on Fly.io.
- The Python backend enqueues an `investigation` job.
- That job coordinates scraping, article applicability checks, entity resolution, ownership tracing, common-owner detection, ranking, and final persistence.
- Results are written back to Supabase and then rendered by the website or extension.

The current architecture is intentionally pragmatic:

- Supabase stores queue state, finalized ownership trees, and related metadata.
- Fly.io runs ephemeral Python workers.
- AWS-backed callback infrastructure is used for scraping and LLM execution.
- Weaviate is still present for entities, relationships, and evidence, though it may be removed in the future.

## Supported Sites

The currently supported-site list is reflected in the website UI. At the time of writing, the list shown in `src/site/dev/index.html` is:

- `nbcnews.com`
- `nypost.com`
- `theverge.com`
- `cnn.com`
- `washingtonpost.com`
- `nytimes.com`
- `foxnews.com`
- `abcnew.com`

`cnn.com` is currently hit or miss because of anti-scraping measures.

## Architecture

### Website and extension

The website and Chrome extension are both core product surfaces.

- The website is the main interactive visualization layer.
- The extension brings the same investigation flow directly onto supported articles.
- Both use Supabase as their primary integration point.

### Python backend

The Python backend is a job-driven investigation system.

Key pieces:

- `src/app/main.py`
  - Application entrypoint.
  - Starts the FastAPI coordinator and the job runner.
- `src/app/core/runtime/coordinator_server.py`
  - Exposes enqueue, status, batch, and callback endpoints.
- `src/app/core/runtime/job_runner.py`
  - Pulls queued jobs and executes them.
- `src/app/core/jobs/jobs/investigation_job.py`
  - Main investigation orchestrator.
- `src/app/core/db/database_service.py`
  - Actor-style wrapper around the database adapter layer.

### Supabase Edge Functions

The Edge Functions provide the bridge between the client and backend runtime.

- `get-or-enqueue.ts`
  - URL normalization, supported-site checks, pre-investigation, queue insertion, and dispatch orchestration.
- `investigation_start.ts`
  - Claims a Fly machine, waits for the Python coordinator to be healthy, and enqueues the investigation job.
- `process-queued-articles.ts`
  - Internal batch trigger for queued or deferred work.
- `get_evidence_batch.ts`
  - Fetches evidence objects by ID for client rendering.

## Full-Stack Setup

This section documents the current production-oriented stack as it exists in this repo.

### 1. Python backend requirements

Use Python 3.11+.

Install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Run the backend:

```bash
python3 run_dev.py
```

This starts the Python coordinator / job runtime defined in `src/app/main.py`.

### 2. Website

The website is static.

Serve `src/site/dev` with any local static server. For example:

```bash
cd src/site/dev
python3 -m http.server 3000
```

Then open:

```text
http://localhost:3000
```

The website talks directly to your Supabase project and reads / writes investigation state from there.

### 3. Chrome extension

To load the extension locally:

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `src/extension/banner`

The extension currently requests access to:

- Supabase project endpoints
- browser tabs
- all-page content script injection

### 4. Supabase Edge Functions

This repo includes Supabase Edge Functions under `src/app/supabase_edge`.

You will need a Supabase project with:

- the relevant tables such as `article_queue`, `ownership_trees`, `sites`, and `settings`
- the edge functions deployed
- service-role access available to the functions

The functions in this repo are written for Deno / Supabase Edge Runtime.

### 5. Fly.io worker runtime

The system expects Fly.io machines to be available for dispatched investigations.

`investigation_start.ts`:

- reads the configured Fly scale limit from Supabase `settings`
- leases an available stopped machine
- starts it
- waits for the Python coordinator health check
- enqueues the `investigation` job remotely

### 6. Weaviate

Weaviate is still part of the current stack.

It is used for:

- entities
- relationships
- evidence

The current codebase suggests this dependency may be removed later, but the full stack still assumes it exists today.

## Environment Variables

The repo uses a fairly large environment surface. The list below focuses on variables referenced directly in the current codebase.

### Python backend

- `PEPE_API_KEY`
- `PORT`
- `BASE_URL`
- `CALLBACK_URL`
- `CALLBACK_BASE_URL`
- `FLY_APP_NAME`
- `FLY_MACHINE_ID`
- `STARTUP_JOB`
- `JOB_SECONDS`
- `STARTUP_DELAY_SECONDS`
- `IDEMPOTENCY_DB_PATH`
- `JOBRUNNER_DEBUG_INLINE`

### Python backend to Supabase

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SYNC`
- `LOG_TO_SUPABASE`
- `LOG_FORWARDER_BACKEND`
- `SYNC_BACKEND`

### Python backend to Weaviate

- `WEAVIATE_URL`
- `WEAVIATE_APIKEY`
- `OPENAI_APIKEY`

### Python backend to AWS / callback infrastructure

- `AWS_ACCESS_KEY_ID_LAMBDA`
- `AWS_SECRET_ACCESS_KEY_LAMBDA`
- `AWS_DEFAULT_REGION_LAMBDA`
- `LAMBDA_ARN`
- `TEST_MESSAGE`
- `PEPE_EDGE_KEY`
- `SCRAPER_API`
- `BRAVE_API_KEY`

### S3 sync / log forwarding

- `S3_BUCKET_SYNC`
- `S3_LOGS_PREFIX`
- `S3_JOBS_PREFIX`
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID_SYNC`
- `AWS_SECRET_ACCESS_KEY_SYNC`
- `AWS_DEFAULT_REGION_SYNC`

### Supabase Edge Functions

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `INTERNAL_EDGE_API_KEY`
- `ALLOWED_ORIGINS`
- `CHROME_EXTENSION_ID`
- `SCRAPE_PAGE_ARN`
- `GET_LLM_RESPONSE_ARN`
- `SCRAPE_PAGE_URL`
- `GET_LLM_RESPONSE_URL`
- `PEPE_EDGE_KEY`
- `AWS_ACCESS_KEY_ID_LAMBDA`
- `AWS_SECRET_ACCESS_KEY_LAMBDA`
- `AWS_DEFAULT_REGION_LAMBDA`
- `WEAVIATE_URL`
- `WEAVIATE_API_KEY`
- `WEAVIATE_APIKEY`
- `FLY_API_TOKEN`
- `FLY_APP_NAME`
- `FLY_API_HOSTNAME`
- `COORDINATOR_BASE_URL`
- `PEPE_API_KEY`
- `COORDINATOR_HEALTH_PATH`
- `COORDINATOR_ENQUEUE_PATH`
- `COORDINATOR_HEALTH_TIMEOUT_MS`
- `COORDINATOR_HEALTH_INTERVAL_MS`

## Important Runtime Notes

- The website and extension both assume a live Supabase project.
- The backend assumes callback-based scraping and LLM execution infrastructure.
- The worker orchestration assumes Fly.io machines are available to lease and start.
- The job system is designed around asynchronous child-job orchestration, not a single synchronous request-response flow.

## Key Investigation Flow

The main investigation path starts in:

- `src/app/core/jobs/jobs/investigation_job.py`

At a high level it:

1. normalizes and tracks the article URL
2. scrapes the article
3. identifies the news site
4. checks whether the article is applicable
5. resolves the article subject entity
6. recursively finds owners on both sides
7. checks for common owners
8. ranks common owners
9. persists the final ownership tree and investigation data

## Development Notes

This is the author's first large open source project, so expect parts of the repo to reflect active iteration rather than polished framework conventions.

In practice, that means:

- architecture is real and functional, but evolving
- some dependencies are transitional
- some paths are production-oriented before they are local-dev-friendly

## Repo Layout

```text
.
├── config/
├── run_dev.py
├── src/
│   ├── app/
│   │   ├── core/
│   │   ├── edge/
│   │   ├── functions/
│   │   ├── supabase_edge/
│   │   └── main.py
│   ├── extension/
│   │   └── banner/
│   └── site/
│       └── dev/
└── requirements.txt
```

## Contributing

If you want to contribute, the best place to start is by understanding:

- the client submission flow in `src/site/dev/js/app.js`
- the Supabase intake flow in `src/app/supabase_edge/get-or-enqueue.ts`
- the Fly dispatch flow in `src/app/supabase_edge/investigation_start.ts`
- the Python investigation orchestrator in `src/app/core/jobs/jobs/investigation_job.py`

## Status

Pepe Silv.AI is a working transparency product built around a custom investigation pipeline, not a demo landing page or toy crawler. The repo contains the real website, real extension, and real backend orchestration used to produce conflict-of-interest investigations.
