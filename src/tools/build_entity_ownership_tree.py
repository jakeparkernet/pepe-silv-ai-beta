#!/usr/bin/env python3
"""
Thin wrapper around the enqueueable `build_entity_ownership_tree` job.

Examples:
    python3 build_entity_ownership_tree.py <entity_id> --spawn-local-server
    python3 build_entity_ownership_tree.py <entity_id> --base-url http://127.0.0.1:8080/api
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import pathlib
import subprocess
import sys
import time
import uuid
from typing import Any, Dict, Optional, Tuple

import requests

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None

from app.config import NetConfig

LOGGER = logging.getLogger("build_entity_ownership_tree")


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )


def _load_env() -> None:
    if load_dotenv is not None:
        load_dotenv()


def _normalize_api_base_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if not base.endswith("/api"):
        base = f"{base}/api"
    return base


def _get_auth_headers() -> Dict[str, str]:
    api_key = os.getenv("PEPE_API_KEY")
    if not api_key:
        raise RuntimeError("PEPE_API_KEY must be set to enqueue jobs")
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }


def _wait_for_health(base_url: str, timeout_seconds: float) -> None:
    deadline = time.time() + timeout_seconds
    health_url = f"{base_url}/health"
    last_error: Optional[Exception] = None

    while time.time() < deadline:
        try:
            response = requests.get(health_url, timeout=3)
            response.raise_for_status()
            payload = response.json()
            if payload.get("ok") is True:
                return
        except Exception as exc:  # pragma: no cover
            last_error = exc
            time.sleep(0.25)

    raise RuntimeError(f"Timed out waiting for coordinator health at {health_url}: {last_error}")


def _enqueue_job(base_url: str, session_id: str, job_spec: Dict[str, Any]) -> Tuple[str, str]:
    response = requests.post(
        f"{base_url}/enqueue",
        json={
            "session_id": session_id,
            "job_spec": job_spec,
            "close_on_terminal": True,
        },
        headers=_get_auth_headers(),
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()

    job = payload.get("job") or {}
    job_id = job.get("id")
    actual_session_id = job.get("session_id") or session_id
    if not job_id:
        raise RuntimeError(f"enqueue returned no job id: {payload}")
    return job_id, actual_session_id


def _wait_for_job_completion(
    base_url: str,
    *,
    session_id: str,
    job_id: str,
    timeout_seconds: float,
    poll_interval_seconds: float,
) -> Dict[str, Any]:
    deadline = time.time() + timeout_seconds
    since_seq = 0

    while time.time() < deadline:
        response = requests.get(
            f"{base_url}/jobs/events",
            params={
                "session_id": session_id,
                "job_id": job_id,
                "since_seq": since_seq,
                "limit": 1000,
            },
            timeout=30,
        )
        response.raise_for_status()
        events = response.json().get("events", []) or []

        for event in events:
            seq = event.get("seq")
            if isinstance(seq, int) and seq > since_seq:
                since_seq = seq

            if event.get("event_type") != "ON_COMPLETE":
                continue

            job = (event.get("payload") or {}).get("job") or {}
            status = str(job.get("status", "")).lower()
            if status == "failed":
                raise RuntimeError(f"Job {job_id} failed: {job.get('output') or job}")
            return job

        time.sleep(poll_interval_seconds)

    raise TimeoutError(f"Timed out waiting for job {job_id}")


class LocalServerHandle:
    def __init__(self, process: subprocess.Popen[Any], base_url: str):
        self.process = process
        self.base_url = base_url

    def close(self) -> None:
        if self.process.poll() is not None:
            return

        self.process.terminate()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:  # pragma: no cover
            self.process.kill()
            self.process.wait(timeout=5)


def _spawn_local_server(port: int) -> LocalServerHandle:
    env = os.environ.copy()
    env["PORT"] = str(port)
    process = subprocess.Popen(
        [sys.executable, str(ROOT / "run_dev.py")],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base_url = f"http://127.0.0.1:{port}/api"
    _wait_for_health(base_url, timeout_seconds=60)
    return LocalServerHandle(process=process, base_url=base_url)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Enqueue the build_entity_ownership_tree job.")
    parser.add_argument("entity_id", help="Weaviate entity id to traverse from")
    parser.add_argument("--base-url", default=None, help="Coordinator API base URL")
    parser.add_argument("--spawn-local-server", action="store_true", help="Start run_dev.py locally")
    parser.add_argument("--port", type=int, default=8080, help="Port for --spawn-local-server")
    parser.add_argument("--timeout-seconds", type=float, default=1800.0, help="Job timeout while waiting")
    parser.add_argument("--poll-interval-seconds", type=float, default=0.5, help="Event polling interval")
    parser.add_argument("--json-out", default=None, help="Optional path to write the final JSON payload")
    parser.add_argument("--session-id", default=None, help="Optional coordinator session id")
    parser.add_argument("--verbose", action="store_true", help="Enable debug logging")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    _load_env()
    _configure_logging(args.verbose)

    server_handle: Optional[LocalServerHandle] = None
    try:
        if args.spawn_local_server:
            LOGGER.info("Spawning local coordinator on port %s", args.port)
            server_handle = _spawn_local_server(args.port)
            base_url = server_handle.base_url
        else:
            base_url = _normalize_api_base_url(args.base_url or NetConfig.get_base_url())
            _wait_for_health(base_url, timeout_seconds=15)

        session_id = args.session_id or f"ownership-tree-{uuid.uuid4()}"
        job_spec = {
            "type": "build_entity_ownership_tree",
            "params": {
                "input": {
                    "entity_id": args.entity_id,
                }
            },
        }

        job_id, actual_session_id = _enqueue_job(base_url, session_id, job_spec)
        job = _wait_for_job_completion(
            base_url,
            session_id=actual_session_id,
            job_id=job_id,
            timeout_seconds=args.timeout_seconds,
            poll_interval_seconds=args.poll_interval_seconds,
        )

        output = job.get("output") or {}
        rendered = json.dumps(output, indent=2, sort_keys=True, ensure_ascii=False)
        print(rendered)

        if args.json_out:
            out_path = pathlib.Path(args.json_out)
            out_path.write_text(rendered + "\n", encoding="utf-8")
            LOGGER.info("Wrote output to %s", out_path)

        return 0
    finally:
        if server_handle is not None:
            server_handle.close()


if __name__ == "__main__":
    raise SystemExit(main())
