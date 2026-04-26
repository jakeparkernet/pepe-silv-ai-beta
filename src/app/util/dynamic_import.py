"""
Utility for importing a class from a string like "pkg.mod:Class".
"""
import importlib
from typing import Any


def load_class(path: str) -> Any:
    if ":" not in path:
        raise ValueError(f"Invalid class path '{path}'. Expected 'module:Class'.")
    module_path, class_name = path.split(":", 1)
    module = importlib.import_module(module_path)
    try:
        return getattr(module, class_name)
    except AttributeError as e:
        raise ImportError(f"Class '{class_name}' not found in module '{module_path}'.") from e