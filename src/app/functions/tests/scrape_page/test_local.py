import json
import sys, os

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
sys.path.insert(0, project_root)
from edge.aws.scrape_page import lambda_handler

test_event = {
    "url": "https://www.theverge.com"
}

# Simulate a Lambda invocation (context can be None if unused)
response = lambda_handler(test_event, None)

# Pretty-print the result
print("Lambda local response:", json.dumps(response, indent=2))
