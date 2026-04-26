from __future__ import annotations
from typing import Dict, Any

# POC stub — returns canned values.

def fetch(url: str) -> Dict[str, Any]:
    return {
        "ok": True,
        "url": url,
        "title": "Demo Title",
        "og_site_name": "Demo Site",
        "meta_description": "Demo description.",
        "org_names": ["Demo Org"],
        "text_sentences": ["This is a demo sentence."]
    }