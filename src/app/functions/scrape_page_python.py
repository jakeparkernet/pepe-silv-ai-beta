import requests
import asyncio
import time
from bs4 import BeautifulSoup
from urllib.parse import urlparse

DEFAULT_TIMEOUT_SECONDS = 60
MAX_RETRIES = 5
BACKOFF_BASE_SECONDS = 2

async def scrape_page(url: str, format: str = "text", timeout_s: int = DEFAULT_TIMEOUT_SECONDS) -> str:
    loop = asyncio.get_running_loop()

    def normalize_url(u: str) -> str:
        parsed = urlparse(u)
        if not parsed.scheme:
            u = "https://" + u
            parsed = urlparse(u)
        if not parsed.netloc and parsed.path:
            u = "https://" + parsed.path
        return u

    def blocking_fetch():
        normalized = normalize_url(url)

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = requests.get(normalized, timeout=timeout_s)
                if resp.status_code != 200:
                    resp.raise_for_status()
                page = resp.text

                if format == "text":
                    soup = BeautifulSoup(page, "html.parser")
                    return {
                        "url": url,
                        "result": soup.get_text(),
                        "status_code": resp.status_code
                    }
                else:
                    return {
                        "url": url,
                        "result": page,
                        "status_code": resp.status_code
                    }

            except (requests.RequestException, TimeoutError) as e:
                if attempt == MAX_RETRIES:
                    raise RuntimeError(f"Failed after {MAX_RETRIES} attempts: {e}")
                wait_time = BACKOFF_BASE_SECONDS ** attempt
                print(f"Error ({type(e).__name__}: {e}), retrying in {wait_time:.1f}s... ({attempt}/{MAX_RETRIES})")
                time.sleep(wait_time)

    return await loop.run_in_executor(None, blocking_fetch)
