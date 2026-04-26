````md
# Pepe Silv.AI — POC

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .
UVICORN_CMD="uvicorn src.core.runtime.coordinator:app --reload --port 8910"; eval $UVICORN_CMD
````

Then, in another terminal:

```bash
python scripts/demo_local.py
```

You should see a created **Investigation**, a queued **Job**, and an immediate **completed** result coming back from the mock LLM provider.

```
```