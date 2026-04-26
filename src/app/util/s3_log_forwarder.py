from __future__ import annotations

import logging
import os
import sys
import time
import threading
from datetime import datetime, timezone
from typing import Optional


class S3LogHandler(logging.Handler):
    def __init__(self, forwarder: "S3LogForwarder") -> None:
        super().__init__()
        self._forwarder = forwarder

    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            self._forwarder._buffer_log(msg)
        except Exception:
            pass


class S3LogForwarder:
    """
    Wraps sys.stdout so every line written also gets pushed to S3 as a JSON file.
    The target object is keyed by ``machine_id`` (``FLY_MACHINE_ID`` env-var,
    falls back to ``"local"``).  Each line is stored as a JSON object in a
    ``lines`` array.

    A background daemon thread flushes buffered lines every *flush_interval*
    seconds.  All S3 errors are silently swallowed so that logging never
    disrupts the application.
    """

    _instance: Optional["S3LogForwarder"] = None

    @classmethod
    def get_instance(cls, flush_interval: float = 0.01) -> "S3LogForwarder":
        if cls._instance is None:
            cls._instance = cls(flush_interval)
        return cls._instance

    def __init__(self, flush_interval: float = 0.01) -> None:
        import json

        if S3LogForwarder._instance is not None:
            return

        S3LogForwarder._instance = self

        self._original_stdout = sys.stdout
        self._buffer: list[str] = []
        self._lock = threading.Lock()
        self._flush_interval = flush_interval
        self._running = False
        self._enabled = False
        self._client: Optional[object] = None
        self._thread: Optional[threading.Thread] = None
        from app.util.sync_config import get_machine_id
        self._machine_id: str = get_machine_id()
        self._bucket: str = os.getenv("S3_BUCKET_SYNC", "")
        self._region: str = os.getenv("AWS_REGION", "us-east-2")
        self._logs_prefix: str = os.getenv("S3_LOGS_PREFIX", "logs")
        self._json = json
        self._s3_key = f"{self._logs_prefix}/{self._machine_id}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')}.json"

        from app.util.sync_config import get_log_forwarder_backend
        if get_log_forwarder_backend() != "s3":
            return

        if not self._bucket:
            return

        self._client = self._create_client()
        if self._client is None:
            return

        sys.stdout = self  # type: ignore[assignment]
        self._running = True

        root_logger = logging.getLogger()
        root_logger.addHandler(S3LogHandler(self))

        self._thread = threading.Thread(
            target=self._flush_loop, daemon=True, name="s3-log-flusher"
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
            if isinstance(stripped, bytes):
                stripped = stripped.decode("utf-8")
            elif not isinstance(stripped, str):
                stripped = str(stripped)
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
    # Buffer interface (for logging handler)
    # ------------------------------------------------------------------

    def forward(self, text: str) -> None:
        """Manually forward a string to S3."""
        self._buffer_log(text)

    def _buffer_log(self, text: str) -> None:
        stripped = text.strip()
        if stripped:
            if isinstance(stripped, bytes):
                stripped = stripped.decode("utf-8")
            elif not isinstance(stripped, str):
                stripped = str(stripped)
            with self._lock:
                self._buffer.append(stripped)

    # ------------------------------------------------------------------
    # S3 helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _create_client():  # noqa: ANN205 – avoid hard dep on boto3 types
        try:
            import boto3

            access_key = os.getenv("AWS_ACCESS_KEY_ID_SYNC")
            secret_key = os.getenv("AWS_SECRET_ACCESS_KEY_SYNC")
            if not access_key or not secret_key:
                return None
            return boto3.client(
                "s3",
                aws_access_key_id=access_key,
                aws_secret_access_key=secret_key,
                region_name=os.getenv("AWS_DEFAULT_REGION_SYNC", "us-east-2"),
            )
        except Exception as e:
            raise e

    

    def _flush_loop(self) -> None:
        while self._running:
            time.sleep(self._flush_interval)
            self._flush_to_s3()

    def _load_existing(self) -> list[str]:
        try:
            response = self._client.get_object(  # type: ignore[union-attr]
                Bucket=self._bucket,
                Key=self._s3_key,
            )
            body = response["Body"].read()
            if isinstance(body, bytes):
                body = body.decode("utf-8")
            data = self._json.loads(body)
            return [line.decode("utf-8") if isinstance(line, bytes) else line for line in data.get("lines", [])]
        except self._client.exceptions.NoSuchKey:  # type: ignore[union-attr]
            return []
        except Exception as e:
            return []

    def _flush_to_s3(self) -> None:
        with self._lock:
            if not self._buffer:
                return
            lines = self._buffer[:]
            self._buffer.clear()

        try:
            existing = self._load_existing()
            existing.extend(lines)
            payload = self._json.dumps({"lines": existing})
            self._client.put_object(  # type: ignore[union-attr]
                Bucket=self._bucket,
                Key=self._s3_key,
                Body=payload.encode("utf-8"),
                ContentType="application/json",
            )
        except Exception as e:
            raise e

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def stop(self) -> None:
        """Flush remaining buffer and restore original stdout."""
        if not self._enabled:
            return
        self._running = False
        if self._client is not None:
            self._flush_to_s3()
        sys.stdout = self._original_stdout
        root_logger = logging.getLogger()
        for handler in root_logger.handlers[:]:
            if isinstance(handler, S3LogHandler):
                root_logger.removeHandler(handler)

    @property
    def enabled(self) -> bool:
        return self._enabled