import json

def lambda_handler(event, context):
    # TODO implement
    return {
        'statusCode': 200,
        'body': json.dumps('Hello from Lambda!')
    }
import asyncio
import base64
import json
import os
from get_llm_response import get_llm_response


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
    api_key = os.environ["OPEN_ROUTER"]
    endpoint = payload.get("endpoint", "openrouter.ai")
    model = payload.get("model", "nvidia/nemotron-nano-9b-v2:free")
    messages = payload.get("messages")
    system_message = payload.get("system_message")
    user_message = payload.get("user_message")
    response_format = payload.get("response_format")
    parameters = payload.get("parameters", {})
    post_endpoint = payload.get("post_endpoint", "/api/v1/chat/completions")

    if messages is None and system_message and user_message:
        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message},
        ]

    if messages is None:
        return _respond(event, {"status_code": 400, "result": "ERROR: NO MESSAGES IN REQUEST"}, 400)

    if response_format is not None:
        parameters["response_format"] = response_format

    try:
        completion = asyncio.run(get_llm_response(
            api_key=api_key,
            model=model,
            messages=messages,
            parameters=parameters,
            endpoint=endpoint,
            post_endpoint=post_endpoint
        ))

        content = completion["choices"][0]["message"]["content"]
        return _respond(event, {"status_code": 200, "full_completion": completion, "result": content})

    except Exception as e:
        return _respond(event, {"status_code": 500, "result": str(e)}, 500)
