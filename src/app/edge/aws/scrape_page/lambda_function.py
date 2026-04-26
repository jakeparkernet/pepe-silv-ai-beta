import base64
import json
import os
from scrape_page_scraper_api import scrape_page as scrape_page_scraper_api


def _is_http_event(event):
    return isinstance(event, dict) and ("requestContext" in event or "rawPath" in event)


def _get_payload(event):
    if not _is_http_event(event):
        return event

    body = event.get("body")
    if body is None:
        return {}

    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")

    if isinstance(body, str) and body:
        return json.loads(body)

    return {}


def _check_edge_key(event):
    expected = os.getenv("PEPE_EDGE_KEY")
    if not expected or not _is_http_event(event):
        return True

    headers = event.get("headers") or {}
    provided = (
        headers.get("x-pepe-edge-key")
        or headers.get("X-Pepe-Edge-Key")
        or headers.get("X-PEPE-EDGE-KEY")
    )
    return provided == expected


def _respond(event, payload, http_status=200):
    if not _is_http_event(event):
        return payload

    return {
        "statusCode": http_status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(payload),
    }

def lambda_handler(event, context):
    if not _check_edge_key(event):
        return _respond(event, {"status_code": 403, "result": "Forbidden"}, 403)

    payload = _get_payload(event)
    url = payload.get("url")
    if not url:
        return _respond(event, {
            "status_code": 500,
            "result": "Missing 'url' parameter"
        }, 400)

    format_ = payload.get("format")
    timeout_s = payload.get("timeout_s")
    target = payload.get("target")

    try:
        result = scrape_page_scraper_api(url)
        return _respond(event, {
            "status_code": 200,
            "result": result
        })
    except Exception as e:
        return _respond(event, {
            "status_code": 500,
            "result": str(e)
        }, 500)
