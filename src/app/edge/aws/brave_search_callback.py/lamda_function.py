import asyncio
from brave_search import brave_search
from send_response import send_response


def lambda_handler(event, context):
    fly_force_instance_id = event.get("fly_force_instance_id", None)

    payload = {
        "job_id": event["job_id"],
        "status_code": 500,
        "result": "UNKNOWN ERROR!!!",
        "callback_url": event["callback_url"]
    }

    query = event.get("query")
    if not query:
        payload = {
            "job_id": event["job_id"],
            "callback_url": event["callback_url"],
            "status_code": 500,
            "result": "ERROR",
            "error": "Missing 'query' parameter"
        }
        send_response(
            payload,
            fly_force_instance_id=fly_force_instance_id,
        )
        return

    print(event)
    options = event.get("options", {})

    try:
        results = asyncio.run(brave_search(query, options))
        payload = {
            "job_id": event["job_id"],
            "callback_url": event["callback_url"],
            "status_code": 200,
            "result": results
        }
    except Exception as e:
        payload = {
            "job_id": event["job_id"],
            "callback_url": event["callback_url"],
            "status_code": 500,
            "result": "ERROR",
            "error": str(e)
        }

    send_response(
        payload,
        fly_force_instance_id=fly_force_instance_id,
    )