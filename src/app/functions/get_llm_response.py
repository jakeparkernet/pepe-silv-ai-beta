import http.client
import json
import asyncio
import os

def within_token_limit (system_message, user_message, token_limit):
    token_count = count_tokens(system_message, user_message)
    return token_count <= token_limit

def count_tokens(system_message, user_message):
    encoding = tiktoken.encoding_for_model(model)
    total_text = f"{system_message}\n{user_message}"
    return len(encoding.encode(total_text))

async def get_llm_response(api_key, model, messages, parameters, endpoint, post_endpoint):
    conn = http.client.HTTPSConnection(endpoint)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": model,
        "messages": messages
    }

    payload.update(parameters)

    conn.request("POST", post_endpoint, body=json.dumps(payload), headers=headers)

    response = conn.getresponse()

    content_type = response.getheader("Content-Type", "")
    charset = "utf-8"
    if "charset=" in content_type.lower():
        charset = content_type.split("charset=")[-1].strip()

    data = response.read().decode(charset)

    result = json.loads(data)
    return result