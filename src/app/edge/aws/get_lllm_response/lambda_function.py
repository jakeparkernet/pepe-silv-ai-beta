import asyncio
import os
from get_llm_response import get_llm_response

TOKEN_LIMIT = 128000

def lambda_handler(event, context):
    api_key = os.environ["OPEN_ROUTER"]
    endpoint = event.get("endpoint", "openrouter.ai")
    model = event.get("model", "nvidia/nemotron-nano-9b-v2:free")
    messages = event.get("messages")
    system_message = event.get("system_message")
    user_message = event.get("user_message")
    response_format = event.get("response_format")
    parameters = event.get("parameters", {})
    post_endpoint = event.get("post_endpoint", "/api/v1/chat/completions")
    token_limit = event.get("token_limit", TOKEN_LIMIT)

    if messages is None and system_message and user_message:
        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message},
        ]

    if messages is None:
        return {"status_code": 400, "result": "ERROR: NO MESSAGES IN REQUEST"}

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
        return {"status_code": 200, "full_completion": completion, "result": content}

    except Exception as e:
        # Returning a dict ensures the runtime emits valid JSON
        return {"status_code": 500, "result": str(e)}
