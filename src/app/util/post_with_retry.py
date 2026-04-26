import httpx

def post_with_retry(url, body, headers, job_id_local, dedupe_key, max_retries=3):
    for attempt in range(max_retries):
        try:
            resp = httpx.post(url, json=body, headers=headers or None, timeout=5.0)
            resp.raise_for_status()
            logger.debug(f"POST success for job {job_id_local}")
            return True
        except Exception as e:
            logger.warning(f"POST attempt {attempt + 1} failed for job {job_id_local}: {e}")
            if attempt < max_retries - 1:
                time.sleep(0.5 * (2 ** attempt))  # Exponential backoff
            else:
                logger.error(f"POST failed permanently for job {job_id_local}: {e}")
                return False
    return False