from __future__ import annotations

import os
import sys
import time
import threading
from typing import Optional

from app.util.sync_config import get_log_forwarder_backend, get_machine_id


class SupabaseLogForwarder:
    """
    Wraps sys.stdout so every line written also gets pushed to a Supabase
    ``logs`` table.  The target row is keyed by ``machine_id``
    (``FLY_MACHINE_ID`` env-var, falls back to ``"local"``).  The column
    ``logs`` is a text[] that accumulates lines.

    A background daemon thread flushes buffered lines every *flush_interval*
    seconds.  All Supabase errors are silently swallowed so that logging
    never disrupts the application.
    """

    def __init__(self, flush_interval: float = 0.01) -> None:
        self._original_stdout = sys.stdout
        self._buffer: list[str] = []
        self._lock = threading.Lock()
        self._flush_interval = flush_interval
        self._running = False
        self._enabled = False
        self._client: Optional[object] = None
        self._thread: Optional[threading.Thread] = None
        self._machine_id: str = get_machine_id()

        if get_log_forwarder_backend() != "supabase":
            return

        self._client = self._create_client()
        if self._client is None:
            return

        self._ensure_row()

        # Replace stdout — keep original for passthrough
        sys.stdout = self  # type: ignore[assignment]
        self._running = True

        self._thread = threading.Thread(
            target=self._flush_loop, daemon=True, name="supabase-log-flusher"
        )
        self._thread.start()
        self._enabled = True

    # ------------------------------------------------------------------
    # Stream interface (makes this a drop-in replacement for sys.stdout)
    # ------------------------------------------------------------------

    def write(self, text: str) -> int:
        self._original_stdout.write(text)
        stripped = text.strip()
        if stripped:
            with self._lock:
                self._buffer.append(stripped)
        return len(text)

    def flush(self) -> None:
        self._original_stdout.flush()

    def fileno(self) -> int:
        return self._original_stdout.fileno()

    def isatty(self) -> bool:
        return self._original_stdout.isatty()

    def writable(self) -> bool:
        return True

    @property
    def encoding(self) -> str:
        return self._original_stdout.encoding

    @property
    def errors(self) -> Optional[str]:
        return self._original_stdout.errors

    # ------------------------------------------------------------------
    # Supabase helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _create_client():  # noqa: ANN205 – avoid hard dep on supabase types
        try:
            from supabase import create_client

            url = os.getenv("SUPABASE_URL")
            key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            if not url or not key:
                return None
            return create_client(url, key)
        except Exception as e:
            raise e

    def _ensure_row(self) -> None:
        """Insert the machine_id row with an empty logs array if it doesn't exist."""
        try:
            self._client.table("logs").upsert(  # type: ignore[union-attr]
                {"machine_id": self._machine_id, "logs": []},
                on_conflict="machine_id",
                ignore_duplicates=True,
            ).execute()
        except Exception as e:
            raise e

    def _flush_loop(self) -> None:
        while self._running:
            time.sleep(self._flush_interval)
            self._flush_to_supabase()

    def _flush_to_supabase(self) -> None:
        with self._lock:
            if not self._buffer:
                return
            lines = self._buffer[:]
            self._buffer.clear()

        try:
            result = (
                self._client.table("logs")  # type: ignore[union-attr]
                .select("logs")
                .eq("machine_id", self._machine_id)
                .execute()
            )
            current: list[str] = result.data[0]["logs"] if result.data else []
            current.extend(lines)
            self._client.table("logs").upsert(  # type: ignore[union-attr]
                {"machine_id": self._machine_id, "logs": current},
                on_conflict="machine_id",
            ).execute()
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def stop(self) -> None:
        """Flush remaining buffer and restore original stdout."""
        if not self._enabled:
            return
        self._running = False
        if self._client is not None:
            self._flush_to_supabase()
        sys.stdout = self._original_stdout

    @property
    def enabled(self) -> bool:
        return self._enabled
