from .scrape_page_python import scrape_page as scrape_page_python
from .scrape_page_scraper_api import scrape_page as scrape_page_scraper_api
import asyncio

DEFAULT_TIMEOUT_SECONDS = 5

async def scrape_page(url: str, format: str = "markdown",
                timeout_s: int = DEFAULT_TIMEOUT_SECONDS, target = "scraperapi") -> str:
    if target == "python":
        return await scrape_page_python(url=url, format=format, timeout_s=timeout_s)
    elif target == "scraperapi":
        return scrape_page_scraper_api(url=url, format=format)
    elif target == "shotgun":
        python_task = asyncio.create_task(scrape_page_python(url=url, format=format, timeout_s=timeout_s))
        scraperapi_task = asyncio.create_task(scrape_page_scraper_api(url=url, format=format))
        return await asyncio.gather(python_task, scraperapi_task)