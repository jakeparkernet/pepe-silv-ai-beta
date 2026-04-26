import asyncio
import os
import json
import sys

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, project_root)
from edge.aws.run_lambda import run_lambda

system_message = "You are a helpful assistant"
user_message = "/no_think Why is the sky blue?"

test_event_no_messages = {
    "system_message": system_message,
    "user_message": user_message,
    "model": "nvidia/nemotron-nano-9b-v2"
}

target_count = 10
complete_count = 0
done_event = asyncio.Event()

def on_complete(result):
    global complete_count
    print(f"complete_count: {complete_count}")
    print("Lambda response:", json.dumps(result, indent=2))
    complete_count += 1
    if complete_count >= target_count:
        done_event.set()

async def main():
    arn = "arn:aws:lambda:us-east-2:900232986494:function:get_llm_response"
    for x in range(0, target_count):
        run_lambda(
            arn=arn,
            payload=test_event_no_messages,
            on_complete=on_complete
        )

    await done_event.wait()
    print(f"Reached {target_count} completions, continuing...")

asyncio.run(main())
