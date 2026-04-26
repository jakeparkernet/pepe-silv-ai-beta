from __future__ import annotations
import json
from pathlib import Path
from typing import Any

from .schema import LocalCapabilitiesConfig, EdgeCapabilitiesConfig

# Resolve paths relative to the **source tree** (src/app)
APP_ROOT = Path(__file__).resolve().parents[2]
CONFIG_ROOT = APP_ROOT / "configs"

def _resolve(path: str | Path, base: Path) -> Path:
    p = Path(path)
    return p if p.is_absolute() else (base / p)

def _load_json(path: str | Path, *, base: Path) -> Any:
    p = _resolve(path, base)
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)

def _load_text(path: str | Path, *, base: Path) -> str:
    p = _resolve(path, base)
    return p.read_text(encoding="utf-8")

# ---- Public API --------------------------------------------------------------

def load_edge_capabilities_config (path: str | Path = "edge_capabilities.json") -> EdgeCapabilitiesConfig:
    return EdgeCapabilitiesConfig(**_load_json(path, base=CONFIG_ROOT))

def load_local_capabilities_config (path: str | Path = "local_capabilities.json") -> LocalCapabilitiesConfig:
    return LocalCapabilitiesConfig(**_load_json(path, base=CONFIG_ROOT))

def load_phase_config(path: str | Path) -> PhaseConfig:
    # phase paths (e.g., "phases/company_from_url/models.json") are resolved from src/app
    return PhaseConfig(**_load_json(path, base=APP_ROOT))

def load_app_text(path: str | Path) -> str:
    # load prompts, etc., resolved from src/app
    return _load_text(path, base=APP_ROOT)
