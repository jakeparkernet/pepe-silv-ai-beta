import asyncio
from brave_search import brave_search

def lambda_handler(event, context):
    query = event.get("query")
    if not query:
        return {"error": "Missing 'query' parameter"}

    try:
        results = asyncio.run(brave_search(query))
        return {
                "status_code": 200,
                "result": results
            }
    except Exception as e:
        return {
            "status_code": 500,
            "result": str(e)
        }


