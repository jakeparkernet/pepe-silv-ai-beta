import sqlite3
import time
import asyncio
import json
from typing import Optional, Tuple

from fastapi.responses import JSONResponse, Response


class SQLiteIdempotency:
    """
    Cross-process idempotency using a SQLite file (WAL mode).

    Stores either:
      - INFLIGHT (claimed but not finished)
      - DONE with a cached response payload

    NOTE:
      This implementation correctly detects whether the current caller claimed the key
      by checking the INSERT rowcount (instead of using a time-based heuristic).
    """

    def __init__(self, db_path: str, ttl_seconds: int = 600):
        self.db_path = db_path
        self.ttl = int(ttl_seconds)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self.db_path, timeout=5, check_same_thread=False)
        con.execute("PRAGMA journal_mode=WAL;")
        con.execute("PRAGMA synchronous=NORMAL;")
        con.execute("PRAGMA busy_timeout=5000;")
        return con

    def _init_db(self) -> None:
        con = self._connect()
        try:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS idempotency (
                    k TEXT PRIMARY KEY,
                    state TEXT NOT NULL,           -- 'INFLIGHT' | 'DONE'
                    status_code INTEGER,
                    body_json TEXT,
                    created_at REAL NOT NULL
                )
                """
            )
            con.execute("CREATE INDEX IF NOT EXISTS idx_idemp_created_at ON idempotency(created_at)")
            con.commit()
        finally:
            con.close()

    def _claim_or_get(self, key: str) -> Tuple[str, Optional[int], Optional[str]]:
        """
        Returns (state, status_code, body_json)

        state in:
          - 'NEW' (caller owns processing)
          - 'INFLIGHT' (someone else owns processing)
          - 'DONE' (replay cached response)
        """
        now = time.time()
        con = self._connect()
        try:
            # Best-effort TTL cleanup (keeps table bounded).
            con.execute("DELETE FROM idempotency WHERE created_at < ?", (now - self.ttl,))
            con.commit()

            # Try to claim.
            cur = con.execute(
                "INSERT OR IGNORE INTO idempotency (k, state, created_at) VALUES (?, 'INFLIGHT', ?)",
                (key, now),
            )
            inserted = (cur.rowcount == 1)
            con.commit()

            if inserted:
                return ("NEW", None, None)

            row = con.execute(
                "SELECT state, status_code, body_json FROM idempotency WHERE k=?",
                (key,),
            ).fetchone()

            if not row:
                # Extremely unlikely; treat as inflight.
                return ("INFLIGHT", None, None)

            state, status_code, body_json = row

            if state == "DONE":
                return ("DONE", int(status_code or 200), body_json)

            return ("INFLIGHT", None, None)
        finally:
            con.close()

    def _store_done(self, key: str, status_code: int, body_json: str) -> None:
        con = self._connect()
        try:
            con.execute(
                "UPDATE idempotency SET state='DONE', status_code=?, body_json=? WHERE k=?",
                (int(status_code), body_json, key),
            )
            con.commit()
        finally:
            con.close()

    async def claim_or_replay(self, key: str) -> Response | None:
        state, status_code, body_json = await asyncio.to_thread(self._claim_or_get, key)

        if state == "DONE":
            try:
                body = json.loads(body_json or "{}")
            except Exception:
                body = {"status": "error", "reason": "bad_cached_json"}
            return JSONResponse(status_code=int(status_code or 200), content=body)

        if state == "INFLIGHT":
            return JSONResponse(status_code=202, content={"status": "inflight"})

        return None  # NEW => proceed

    async def store_done(self, key: str, status_code: int, body: dict) -> None:
        await asyncio.to_thread(self._store_done, key, int(status_code), json.dumps(body))
