from __future__ import annotations

import asyncio
import logging
import json
import os
import time
import hashlib
from uuid import uuid4
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Set, Tuple

import uvicorn
from fastapi import Body, FastAPI, HTTPException, Request, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.util.hmac_utils import validate_hmac

class CoordinatorServer:
    async def start(
        self,
        host: str = "0.0.0.0",
        port: int = 8080,
        base_path: str = "/api",
        allowed_origins: List[str] | None = None,
    ):

        @asynccontextmanager
        async def lifespan(app: FastAPI):
            yield
            
        self.app = FastAPI(title="My Coordinator", lifespan=lifespan, timeout=30)

        self.app.add_middleware(
            CORSMiddleware,
            allow_origins=allowed_origins or ["*"],
            allow_credentials=False,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["*"],
        )

        # --- health ---
        @self.app.get(f"{base_path}/health")
        async def health():
            return {"ok": True}

        @self.app.post(f"{base_path}/job/response")
        async def on_job_response(
            request: Request,
            idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
        ):
            """
            Receives a job callback. Enforces:
              1) HMAC authenticity/integrity
              2) cross-worker idempotency via SQLite

            IMPORTANT: validate HMAC before idempotency, to prevent untrusted callers
            from polluting idempotency storage.
            """
            raw = await request.body()

            print(raw)

            # Validate HMAC first (prevents INFLIGHT poison-pill rows from bad callers)
            ok, err = validate_hmac(
                method="POST",
                path="/api/job/response",
                query=request.url.query,
                body_bytes=raw,
                headers={k: v for k, v in request.headers.items()},
                skew_seconds=300,
            )

            # Parse payload after reading raw bytes (but before idempotency, so we can return good errors)
            try:
                payload = await request.json()
            except Exception:
                payload = None

            if not ok:
                # Do not claim/store idempotency for unauthenticated requests
                raise HTTPException(status_code=401, detail={"status": "error", "reason": err})

            if not isinstance(payload, dict):
                raise HTTPException(status_code=400, detail={"status": "error", "reason": "bad_json"})

            job_id = payload.get("job_id")
            if not job_id:
                raise HTTPException(status_code=400, detail={"status": "error", "reason": "missing job_id"})
            
            body = {"status": "ok", "job_id": job_id}
            return body

        config = uvicorn.Config(self.app, host=host, port=port, log_level="info", workers=1)
        self._server = uvicorn.Server(config)
        self._serve_task = asyncio.create_task(self._server.serve())
        while not self._server.started:
            await asyncio.sleep(0.05)

        logging.info(f"Coordinator server started on http://{host}:{port}")

        from app.edge.edge_runner_factory import get_edge_runner

        for i in range(50):
            get_edge_runner().echo_callback(
                str(uuid4()),
                "echo test new " + str(i)
            )