import json
import time
import hashlib
import urllib.request
import urllib.error
import os
from urllib.parse import urljoin
from typing import Any, Dict, Optional

from hmac_utils import sign_payload


def send_response(
    payload: Dict[str, Any],
    response_headers: Dict[str, Any] = {},
    *,
    timeout_seconds: int = 30,
    max_attempts: int = 10,
    retry_delay_seconds: float = 0.5,
    idempotency_key: Optional[str] = None,
    fly_force_instance_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Send a callback to the coordinator's /api/job/response endpoint.

    Adds:
    - Authorization: Bearer <PEPE_API_KEY> (if present in Lambda env)
    - Fly-Force-Instance-Id: <value> (if provided)
    """

    method = "POST"
    path = "/api/job/response"
    query = None

    callback_url = payload.get("callback_url")
    if not callback_url or not isinstance(callback_url, str):
        raise ValueError("payload must include a string 'callback_url'")

    pepe_api_key = os.getenv("PEPE_API_KEY")
    should_sign = payload.get("job_id") is not None

    last_exc: Optional[BaseException] = None

    for attempt in range(1, max_attempts + 1):
        if should_sign:
            headers, body_bytes = sign_payload(
                method=method,
                path=path,
                query=query,
                payload=payload,
                key_id="v1",
                extra_headers=response_headers,
                fly_force_instance_id=fly_force_instance_id,
            )
            headers = dict(headers)
        else:
            headers = dict(response_headers)
            if fly_force_instance_id is not None:
                headers["Fly-Force-Instance-Id"] = str(fly_force_instance_id)
            body_bytes = json.dumps(payload).encode("utf-8")

        if idempotency_key is None:
            idempotency_key = payload.get("idempotency_key")
        if idempotency_key is None:
            idempotency_key = hashlib.sha256(body_bytes).hexdigest()

        headers["Idempotency-Key"] = str(idempotency_key)
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"

        if pepe_api_key:
            headers["Authorization"] = f"Bearer {pepe_api_key}"

        url = urljoin(callback_url, path)

        req = urllib.request.Request(
            url,
            data=body_bytes,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
                status = getattr(resp, "status", None) or resp.getcode()
                raw = resp.read() or b""

                if status == 202 and attempt < max_attempts:
                    time.sleep(retry_delay_seconds)
                    continue

                if not raw:
                    return {"status_code": int(status)}

                try:
                    return json.loads(raw.decode("utf-8"))
                except Exception:
                    return {
                        "status_code": int(status),
                        "raw": raw.decode("utf-8", "ignore"),
                    }

        except urllib.error.HTTPError as e:
            raw = e.read() or b""
            try:
                err_body = json.loads(raw.decode("utf-8"))
            except Exception:
                err_body = raw.decode("utf-8", "ignore")

            if e.code in (400, 401, 403):
                raise RuntimeError(
                    f"Callback rejected (HTTP {e.code}): {err_body}"
                ) from e

            last_exc = RuntimeError(
                f"Callback failed (HTTP {e.code}) attempt {attempt}/{max_attempts}: {err_body}"
            )

        except urllib.error.URLError as e:
            last_exc = RuntimeError(
                f"Callback network error attempt {attempt}/{max_attempts}: {e}"
            )

        if attempt < max_attempts:
            time.sleep(retry_delay_seconds)

    raise last_exc or RuntimeError("Callback failed with unknown error")
