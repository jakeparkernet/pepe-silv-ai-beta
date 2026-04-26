import asyncio
from typing import List, Dict, Any
import os
import httpx

BRAVE_MAX_COUNT = 20 
BRAVE_MAX_PAGE_INDEX = 9

async def brave_search(
    query: str,
    max_results: int = 20,
    offset: int = 0,
    retries: int = 10,
    backoff_factor: float = 0.5,
    target_result_count: int = 20
) -> List[Dict[str, Any]]:

    if offset < 0 or max_results <= 0:
        raise ValueError("offset must be ≥ 0 and max_results must be > 0")

    if max_results > BRAVE_MAX_COUNT:
        max_results = BRAVE_MAX_COUNT

    page_index, in_page_offset = divmod(offset, max_results)
    if page_index > BRAVE_MAX_PAGE_INDEX:
        raise ValueError(
            f"Brave supports at most {BRAVE_MAX_PAGE_INDEX + 1} pages of size {max_results}. "
            f"Requested offset {offset} is out of range."
        )

    pages = []
    for i in range(math.floor(target_result_count / max_results)):
        pages.append(await _fetch_brave_page(query, max_results, page_index + i, retries, backoff_factor))

    return pages

async def _fetch_brave_page(
    query: str,
    count: int,
    page_index: int,
    retries: int,
    backoff_factor: float,
) -> Dict[str, Any]:
    """Fetch a *single* page from Brave Search."""
    api_key = os.environ["BRAVE_API_KEY"]
    if not api_key:
        raise ValueError("BRAVE_API_KEY environment variable is not set.")

    url = "https://api.search.brave.com/res/v1/web/search"
    headers = {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": api_key,
    }
    params = {"q": query, "count": count, "offset": page_index, "result_filter": "web,infobox"}

    attempt = 0
    while attempt <= retries:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, params=params, timeout=10.0)
                response.raise_for_status()
                return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 422:
                raise ValueError(f"Brave API rejected the request: {e.response.text}") from e
            raise
        except httpx.ConnectTimeout:
            attempt += 1
            backoff = backoff_factor * 2 ** (attempt - 1)
            print(f"Brave timeout; retrying in {backoff:.1f}s (attempt {attempt}/{retries})")
            await asyncio.sleep(backoff)
    raise Exception("Exceeded maximum retries for Brave API")