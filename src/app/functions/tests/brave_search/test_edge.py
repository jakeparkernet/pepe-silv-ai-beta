import json
import concurrent.futures
import boto3
import asyncio

_LAMBDA_ARN = "arn:aws:lambda:us-east-2:900232986494:function:brave_search"
_client = boto3.client("lambda")
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)

def _invoke_blocking(payload: dict):
    # Blocking call on a worker thread
    resp = _client.invoke(
        FunctionName=_LAMBDA_ARN,
        InvocationType="RequestResponse",  # we want the actual result
        Payload=json.dumps(payload).encode("utf-8"),
    )
    # Payload is a stream-like object in boto3
    payload_bytes = resp["Payload"].read()
    return json.loads(payload_bytes.decode("utf-8") or "{}")

def run_test(query, on_complete):
    """
    Fire-and-forget launcher. Returns immediately.
    When the Lambda result arrives, calls `on_complete(result)`.
    `on_complete` may be sync or async.
    """

    # Define the payload to send to the Lambda
    payload = {"query": query}
    loop = asyncio.get_running_loop()

    def _work():
        try:
            result = _invoke_blocking(payload)
        except Exception as e:
            result = {"error": str(e)}
        # hand off to the asyncio loop safely
        if asyncio.iscoroutinefunction(on_complete):
            asyncio.run_coroutine_threadsafe(on_complete(result), loop)
        else:
            loop.call_soon_threadsafe(on_complete, result)

    _executor.submit(_work)