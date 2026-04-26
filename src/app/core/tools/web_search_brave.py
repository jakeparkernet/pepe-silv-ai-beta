from __future__ import annotations
from typing import Dict, Any

# POC stub — returns empty results. Real impl would call Brave API.

def search(query: str, count: int = 6) -> Dict[str, Any]:
    return {"query": query, "count": count, "results": []}