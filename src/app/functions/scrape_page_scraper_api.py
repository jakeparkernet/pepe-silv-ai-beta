import requests
import os
import time

def scrape_page(url: str, format: str = "markdown", max_retries: int = 1):
    api_key = os.environ["SCRAPER_API"]

    payload = {
        "api_key": api_key,
        "url": url,
        "output_format": format
    }

    backoff = 1

    return_obj = {
        "url": url,
        "result": None,
        "results": [],
        "status_code": None
    }

    try:
        for attempt in range(max_retries):
            attempt_payload = dict(payload)
            attempt_payload["ultra_premium"] = "true"

            # Escalation by attempt
            if attempt == 1:
                attempt_payload["ultra_premium"] = "true"
            elif attempt >= 2:
                attempt_payload["ultra_premium"] = "true"

            r = requests.get(
                "https://api.scraperapi.com/",
                params=attempt_payload,
                timeout=(10, 30)   # connect timeout, read timeout
            )

            return_obj["results"].append({
                "result": r.text,
                "status_code": r.status_code,
                "attempt": attempt,
                "used_premium": attempt_payload.get("premium") == "true",
                "used_ultra_premium": attempt_payload.get("ultra_premium") == "true",
            })

            if r.status_code == 429:
                wait_time = backoff * (2 ** attempt)
                print(
                    f"Rate limit hit (429). Retrying in {wait_time:.1f}s "
                    f"(attempt {attempt + 1}/{max_retries})..."
                )
                time.sleep(wait_time)
                continue

            return_obj["result"] = r.text
            return_obj["status_code"] = r.status_code
            return return_obj

    except Exception as e:
        return_obj["error"] = str(e)
        return return_obj

    return return_obj
