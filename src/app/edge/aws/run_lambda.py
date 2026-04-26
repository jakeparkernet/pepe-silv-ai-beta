import json
import concurrent.futures
import boto3
import asyncio

_client = boto3.client("lambda",
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID_LAMBDA"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY_LAMBDA"),
    region_name=os.getenv("AWS_DEFAULT_REGION_LAMBDA"))
_executor = concurrent.futures.ThreadPoolExecutor(max_workers=50)

def _invoke_blocking(arn: str, payload: dict):
    resp = _client.invoke(
        FunctionName=arn,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode("utf-8"),
    )

    payload_bytes = resp["Payload"].read()
    return json.loads(payload_bytes.decode("utf-8") or "{}")

def run_lambda(arn, payload, on_complete):
    """
    Fire-and-forget launcher. Returns immediately.
    When the Lambda result arrives, calls `on_complete(result)`.
    `on_complete` may be sync or async.
    """

    loop = asyncio.get_running_loop()

    def _work():
        try:
            result = _invoke_blocking(arn, payload)
        except Exception as e:
            result = {"error": str(e)}
        # hand off to the asyncio loop safely
        if asyncio.iscoroutinefunction(on_complete):
            asyncio.run_coroutine_threadsafe(on_complete(result), loop)
        else:
            loop.call_soon_threadsafe(on_complete, result)

    _executor.submit(_work)