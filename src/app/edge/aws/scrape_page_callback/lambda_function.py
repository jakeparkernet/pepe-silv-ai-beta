from scrape_page import scrape_page
from send_response import send_response
from scrape_page_scraper_api import scrape_page as scrape_page_scraper_api


def lambda_handler(event, context):
    url = event.get("url")
    job_id = event.get("job_id")
    callback_url = event.get("callback_url")
    fly_force_instance_id = event.get("fly_force_instance_id", None)

    payload = {
        "callback_url": callback_url,
        "status_code": 500,
        "result": "UNKNOWN ERROR!!!"
    }

    if job_id is not None:
        payload["job_id"] = job_id

    if not url:
        payload = {
            "callback_url": callback_url,
            "status_code": 500,
            "result": "Missing 'url' parameter"
        }
        if job_id is not None:
            payload["job_id"] = job_id

        send_response(
            payload,
            fly_force_instance_id=fly_force_instance_id,
        )
        return

    format_ = event.get("format", None)
    timeout_s = event.get("timeout_s", None)
    target = event.get("target", None)

    try:
        result = scrape_page_scraper_api(url)

        payload = {
            "callback_url": callback_url,
            "status_code": 200,
            "result": result
        }
        if job_id is not None:
            payload["job_id"] = job_id

        send_response(
            payload,
            fly_force_instance_id=fly_force_instance_id,
        )
    except Exception as e:
        payload = {
            "callback_url": callback_url,
            "status_code": 500,
            "result": str(e)
        }
        if job_id is not None:
            payload["job_id"] = job_id

        send_response(
            payload,
            fly_force_instance_id=fly_force_instance_id,
        )
