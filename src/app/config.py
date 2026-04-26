from dataclasses import dataclass, field
import subprocess, re, threading, sys
from typing import List
import os
import sys
from urllib.parse import urlparse
import subprocess, re, sys, time

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib

@dataclass
class DatabaseSettings:
    """Database configuration settings"""
    adapter: str = "weaviate"
    connection_params: dict = field(default_factory=dict)

@dataclass
class JobDatabaseSettings:
    """Database configuration settings"""
    adapter: str = "jsonl"
    connection_params: dict = field(default_factory=dict)

@dataclass
class AppSettings:
    env: str = "dev"
    log_level: str = "INFO"

@dataclass
class EdgeSettings:
    adapter: "aws"

@dataclass
class Settings:
    app: AppSettings = field(default_factory=AppSettings)
    database: DatabaseSettings = field(default_factory=DatabaseSettings)
    job_database: JobDatabaseSettings = field(default_factory=JobDatabaseSettings)
    edge: EdgeSettings = field(default_factory=EdgeSettings)

    @staticmethod
    def from_toml(path: str) -> "Settings":
        with open(path, "rb") as f:
            data = tomllib.load(f)
        app = AppSettings(**data.get("app", {}))
        database = DatabaseSettings(**data.get("database", {}))
        job_database = JobDatabaseSettings(**data.get("job_database", {}))
        edge = EdgeSettings(**data.get("edge", {}))
        return Settings(app=app, database=database, job_database=job_database, edge=edge)

    @staticmethod
    def load(default_path: str = "config/app.toml") -> "Settings":
        cfg_path = os.environ.get("APP_CONFIG", default_path)
        if not os.path.exists(cfg_path):
            print(f"Config not found at {cfg_path}", file=sys.stderr)
            raise SystemExit(2)
        return Settings.from_toml(cfg_path)

@dataclass
class NetConfig:
    _url: str = None
    _thread: threading.Thread = None

    @staticmethod
    def _normalize_base_url(url: str, *, strip_api_suffix: bool = False) -> str:
        normalized = url.strip().rstrip("/")
        if strip_api_suffix and normalized.endswith("/api"):
            normalized = normalized[:-4]
        return normalized

    @classmethod
    def _launch_tunnel(cls):
        cmd = ["cloudflared", "tunnel", "--url", "http://0.0.0.0:8080"]
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
        )

        pat = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.I)
        for line in proc.stdout:
            sys.stdout.write(line)
            m = pat.search(line)
            if m:
                cls._url = m.group(0)
                break
        # Keep the process running silently after URL found
        for _ in proc.stdout:
            pass

    @classmethod
    def start_tunnel(cls):
        if cls._thread is None or not cls._thread.is_alive():
            cls._thread = threading.Thread(target=cls._launch_tunnel, daemon=True)
            cls._thread.start()

    @classmethod
    def get_listen_port(cls) -> int:
        raw_port = os.getenv("PORT", "8080")
        try:
            return int(raw_port)
        except ValueError:
            print("Invalid PORT=%s, defaulting to 8080", raw_port)
            return 8080

    @classmethod
    def get_callback_url(cls):
        callback_url = os.getenv("CALLBACK_URL") or os.getenv("CALLBACK_BASE_URL")
        if callback_url:
            return cls._normalize_base_url(callback_url, strip_api_suffix=True)

        base_url = os.getenv("BASE_URL")
        if base_url:
            return cls._normalize_base_url(base_url, strip_api_suffix=True)

        fly_app_name = os.getenv("FLY_APP_NAME")
        if fly_app_name:
            return f"https://{fly_app_name}.fly.dev"

        raise KeyError(
            "Missing callback base URL. Set CALLBACK_URL, CALLBACK_BASE_URL, BASE_URL, "
            "or FLY_APP_NAME."
        )

    @classmethod
    def get_base_url(cls) -> str:
        port = cls.get_listen_port()

        fly_machine_id = os.getenv("FLY_MACHINE_ID")

        if fly_machine_id:
            return f"http://127.0.0.1:{port}/api"

        base_url = cls._normalize_base_url(os.environ["BASE_URL"])
        parsed = urlparse(base_url)

        if parsed.port is not None:
            return f"{base_url}/api"

        return f"{base_url}:{port}/api"