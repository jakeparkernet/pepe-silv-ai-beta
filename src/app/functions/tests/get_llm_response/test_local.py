import json
import sys, os

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, project_root)
from edge.aws.get_llm_response import lambda_handler

system_message = "You are a helpful assistant"
user_message = "/no_think Why is the sky blue?"

test_event_no_messages = {
    "system_message": system_message,
    "user_message": user_message
}

response_no_messages = lambda_handler(test_event_no_messages, None)
print("Lambda local response:", json.dumps(response_no_messages, indent=2))

test_event_messages = {
    "messages": [
        {"role": "system", "content": system_message},
        {"role": "user", "content": user_message}
    ]
}

response_messages = lambda_handler(test_event_messages, None)
print("Lambda local response:", json.dumps(response_messages, indent=2))