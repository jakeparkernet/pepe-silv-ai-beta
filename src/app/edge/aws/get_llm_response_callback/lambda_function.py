import asyncio
import os
from get_llm_response import get_llm_response
from send_response import send_response

TOKEN_LIMIT = 128000


def lambda_handler(event, context):
    api_key = os.environ["OPEN_ROUTER"]
    job_id = event.get("job_id")
    callback_url = event.get("callback_url")
    endpoint = event.get("endpoint", "openrouter.ai")
    model = event.get("model", "nvidia/nemotron-nano-9b-v2:free")
    messages = event.get("messages")
    system_message = event.get("system_message")
    user_message = event.get("user_message")
    response_format = event.get("response_format")
    parameters = event.get("parameters", {})
    post_endpoint = event.get("post_endpoint", "/api/v1/chat/completions")
    token_limit = event.get("token_limit", TOKEN_LIMIT)
    fly_force_instance_id = event.get("fly_force_instance_id", None)

    payload = {
        "callback_url": callback_url,
        "status_code": 500,
        "result": "UNKNOWN ERROR!!"
    }
    if job_id is not None:
        payload["job_id"] = job_id

    if messages is None and system_message and user_message:
        messages = [
            {"role": "system", "content": system_message},
            {"role": "user", "content": user_message},
        ]

    if messages is None:
        payload = {
            "callback_url": callback_url,
            "status_code": 500,
            "result": "ERROR",
            "error": "NO MESSAGES IN REQUEST"
        }
        if job_id is not None:
            payload["job_id"] = job_id
        send_response(
            payload,
            fly_force_instance_id=fly_force_instance_id,
        )
        return

    if response_format is not None:
        parameters["response_format"] = response_format

    def get_content_from_completion(completion):
        content = completion
        if "choices" in completion:
            if len(completion["choices"]) == 0:
                content = completion

            if "message" in completion["choices"][0]:
                if "content" in completion["choices"][0]["message"]:
                    content = completion["choices"][0]["message"]["content"]
                else:
                    content = completion["choices"][0]["message"]

        return content

    completion = None

    try:
        completion = asyncio.run(get_llm_response(
            api_key=api_key,
            model=model,
            messages=messages,
            parameters=parameters,
            endpoint=endpoint,
            post_endpoint=post_endpoint
        ))

        content = get_content_from_completion(completion)
        payload = {
            "callback_url": callback_url,
            "status_code": 200,
            "result": content,
            "full_completion": completion
        }
        if job_id is not None:
            payload["job_id"] = job_id

    except Exception as e:
        payload = {
            "callback_url": callback_url,
            "status_code": 500,
            "result": "ERROR",
            "completion": completion,
            "error": str(e)
        }
        if job_id is not None:
            payload["job_id"] = job_id

    send_response(
        payload,
        fly_force_instance_id=fly_force_instance_id,
    )
