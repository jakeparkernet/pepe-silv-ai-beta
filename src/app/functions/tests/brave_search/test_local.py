import json
import sys, os

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, project_root)
from edge.aws.brave_search import lambda_handler

# Example test event
test_event = {
    "query": "who owns the verge news site?"
}

# Simulate a Lambda invocation (context can be None if unused)
response = lambda_handler(test_event, None)

# Pretty-print the result
print("Lambda local response:", json.dumps(response, indent=2))

# Get the directory where the current script is located
script_dir = os.path.dirname(os.path.abspath(__file__))

# Build a path for the output file in the same directory
file_path = os.path.join(script_dir, "brave_search_test_results.json")

with open(file_path, "w") as f:
    json.dump(response, f, indent=2)