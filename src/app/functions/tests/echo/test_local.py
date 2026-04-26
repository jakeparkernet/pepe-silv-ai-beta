import json
import sys, os

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, project_root)
from edge.aws.echo import lambda_handler

# Example test event
test_event = {
    "message": "Hello from local test!"
}

# Simulate a Lambda invocation (context can be None if unused)
response = lambda_handler(test_event, None)

# Pretty-print the result
print("Lambda local response:", json.dumps(response, indent=2))
