# Pepe Silv.AI Backend

This directory contains the Python investigation runtime plus source copies for the main Supabase Edge Functions.

## Runtime Shape

- `main.py` starts the FastAPI coordinator, warms the database adapter, starts event posting, and manages Fly-machine shutdown behavior.
- `core/runtime/coordinator_server.py` exposes the REST/SSE API under `/api`, including enqueue, status, callback, health, and batch endpoints.
- `core/jobs/jobs/investigation_job.py` orchestrates article investigations: scrape, identify site and subject, trace ownership, find common owners, rank, and persist results.
- `core/jobs/jobs/company_pair_investigation.py` handles paid two-company research using the same ownership-tree and common-owner machinery.
- `edge/aws` and `functions` contain callback-style AWS/Lambda helpers for scraping, Brave search, and OpenRouter LLM calls.
- `supabase_edge` contains source copies of the main Supabase Edge Functions; the deployable copies live at repo root under `supabase/functions`.

## Local Backend

From the repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 run_dev.py
```

`run_dev.py` adds `src` to `sys.path` and runs `app.main.run()`. By default the coordinator listens on `PORT` or `8080` and serves API routes under `/api`.

The default config is `config/app.toml`; override it with `APP_CONFIG=/path/to/app.toml`.

## Required Services

A useful local or production run expects the surrounding product stack:

- Supabase tables, migrations, service-role key, and Edge Functions.
- Weaviate for entities, relationships, and evidence.
- AWS/Lambda or compatible callback endpoints for scrape and LLM execution.
- OpenRouter credentials through `OPEN_ROUTER`.
- Fly.io machine metadata when running as an ephemeral worker.

The root `README.md` has the broader stack overview and environment variable inventory.

## Job Persistence

The configured job database adapter is read from `config/app.toml`. The current default is `jsonl`; sync/log forwarding can be routed through Supabase or S3 using the environment variables documented in the root README.
