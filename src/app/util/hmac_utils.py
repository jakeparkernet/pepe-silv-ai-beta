import os
import hmac
import time
import json
import hashlib
import secrets
import urllib.parse
from typing import Any, Mapping, Tuple, Union, Optional, List

_UNRESERVED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

def _percent_encode(s: str) -> str:
    """Percent-encode a Unicode string using UTF-8; spaces => %20; unreserved left as-is."""
    return urllib.parse.quote(s, safe=_UNRESERVED)

def _to_kvlist_from_query_string(qs: str) -> List[Tuple[str, str]]:
    """
    Parse a raw query string into a list of (key, value) pairs.
    - Accepts a leading '?' and strips it.
    - Keeps blank values (so '?a' and '?a=' both become ('a','')).
    - Decodes '+' as space (standard); we'll re-encode as %20.
    """
    if qs.startswith("?"):
        qs = qs[1:]
    return urllib.parse.parse_qsl(qs, keep_blank_values=True, strict_parsing=False, encoding="utf-8", errors="strict")

def _to_kvlist_from_mapping(mp: Mapping[str, Any]) -> List[Tuple[str, str]]:
    """
    Convert a mapping into a list of (key, value) pairs, supporting multi-valued keys.
    Values may be scalars or iterables (list/tuple). Everything is coerced to str.
    """
    out: List[Tuple[str, str]] = []
    for k, v in mp.items():
        if isinstance(v, (list, tuple)):
            for item in v:
                out.append((str(k), "" if item is None else str(item)))
        else:
            out.append((str(k), "" if v is None else str(v)))
    return out

def _canonical_query(q: Union[str, Mapping[str, Any], None]) -> str:
    """
    Deterministically render the query portion (NO leading '?'):

    1) Parse into list of (key, value) pairs (multi-valued keys allowed).
    2) Sort by key lexicographically, then by value lexicographically.
    3) Percent-encode keys and values (UTF-8; space -> %20; unreserved left as-is).
    4) Join as 'key=value' pairs with '&'. Empty values render as 'key='.
    5) If no params, return "" (empty string).
    """
    if q is None:
        pairs: List[Tuple[str, str]] = []
    elif isinstance(q, str):
        pairs = _to_kvlist_from_query_string(q)
    else:
        pairs = _to_kvlist_from_mapping(q)

    pairs.sort(key=lambda kv: (kv[0], kv[1]))

    encoded = []
    for k, v in pairs:
        ek = _percent_encode(k)
        ev = _percent_encode(v)
        encoded.append(f"{ek}={ev}")
    return "&".join(encoded)

def _sha256_hex(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()

def _canonical_string(method: str, path: str, query_str: str, ts: str, nonce: str, body_hex: str) -> str:
    return "\n".join([method.upper(), path, query_str, ts, nonce, body_hex])

def _get_secret() -> bytes:
    try:
        s = os.environ["HMAC_SECRET"]
    except KeyError:
        raise RuntimeError("Missing HMAC_SECRET in environment")
    try:
        return bytes.fromhex(s)
    except ValueError:
        return s.encode("utf-8")

def sign_payload(
    *,
    method: str,
    path: str,
    query: Union[str, Mapping[str, Any], None],
    payload: Union[bytes, str, Mapping[str, Any], None],
    key_id: str = "v1",
    nonce_bytes: int = 16,
    timestamp: Optional[int] = None,
    extra_headers: Optional[Mapping[str, str]] = None,
    fly_force_instance_id: Optional[str] = None,  # NEW
) -> Tuple[Mapping[str, str], bytes]:
    """
    Create HMAC headers for a request and return (headers, body_bytes).

    - Query is normalized deterministically (see _canonical_query).
    - JSON payloads are encoded with stable separators (no spaces) so bytes are deterministic.

    Notes:
    - extra_headers are added to the returned headers but are NOT included in the signature.
      This is intentional so you can add things like Content-Type and Idempotency-Key without
      changing the signature format.
    - Fly-Force-Instance-Id is optional and is NOT included in the signature.
    """
    if payload is None:
        body_bytes = b""
    elif isinstance(payload, bytes):
        body_bytes = payload
    elif isinstance(payload, str):
        body_bytes = payload.encode("utf-8")
    else:
        body_bytes = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    q = _canonical_query(query)
    ts = str(int(time.time()) if timestamp is None else int(timestamp))
    nonce = secrets.token_hex(nonce_bytes)
    body_hex = _sha256_hex(body_bytes)
    can = _canonical_string(method, path, q, ts, nonce, body_hex)

    secret = _get_secret()
    sig = hmac.new(secret, can.encode("utf-8"), hashlib.sha256).hexdigest()

    headers: dict[str, str] = {
        "X-Key-Id": key_id,
        "X-Timestamp": ts,
        "X-Nonce": nonce,
        "X-Signature": sig,
    }

    if fly_force_instance_id is not None:
        headers["Fly-Force-Instance-Id"] = str(fly_force_instance_id)

    if extra_headers:
        for k, v in extra_headers.items():
            if v is None:
                continue
            headers[str(k)] = str(v)

    return headers, body_bytes

def validate_hmac(
    *,
    method: str,
    path: str,
    query: Union[str, Mapping[str, Any], None],
    body_bytes: bytes,
    headers: Mapping[str, str],
    skew_seconds: int = 300,
    require_fly_instance_id: bool = False,
) -> Tuple[bool, Optional[str]]:
    """
    Validate an incoming request. Returns (ok, error_message).

    Requires the exact HTTP method, path, raw body bytes, and either the raw query string
    (with or without '?') or a mapping. The query will be normalized identically to the sender.
    """
    headers_lower = {k.lower(): v for k, v in headers.items()}

    key_id = headers_lower.get("x-key-id")
    ts = headers_lower.get("x-timestamp")
    nonce = headers_lower.get("x-nonce")
    sig = headers_lower.get("x-signature")
    fly_instance_id = headers_lower.get("fly-force-instance-id")

    if not all([key_id, ts, nonce, sig]):
        return False, "missing_required_headers"

    if require_fly_instance_id and fly_instance_id is None:
        return False, "missing_fly_force_instance_id"

    try:
        ts_i = int(ts)
    except (TypeError, ValueError):
        return False, "bad_timestamp"
    now = int(time.time())
    if abs(now - ts_i) > skew_seconds:
        return False, "stale_timestamp"

    q = _canonical_query(query)
    body_hex = _sha256_hex(body_bytes)
    can = _canonical_string(method, path, q, ts, nonce, body_hex)

    secret = _get_secret()
    expected = hmac.new(secret, can.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return False, "bad_signature"

    return True, None