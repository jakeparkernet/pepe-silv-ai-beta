import os
import boto3
import json
import logging
from app.edge.base_edge_runner import EdgeRunner
from typing import Dict, List, Any
from app.config import NetConfig
from app.util.get_value_safe import get_value_safe

logger = logging.getLogger(__name__)

class AwsAdapter(EdgeRunner):

    def brave_search_callback(self, job_id: str, query: str, options: Dict[str, Any] = {}):
        arn = "arn:aws:lambda:us-east-2:900232986494:function:brave_search_callback"
        payload = {
            "job_id": job_id,
            "query": query
        }

        payload["options"] = options
        
        self._invoke_lambda(arn, payload, "Event")

    def scrape_page_callback(self, job_id: str, url: str, options: Dict[str, Any] = {}):
        arn = "arn:aws:lambda:us-east-2:900232986494:function:scrape_page_callback"
        payload = {
            "job_id": job_id,
            "url": url,
            "format": options.get("format", None),
            "timeout_s": options.get("timeout_s", None),
            "target": options.get("target", None),

        }
        self._invoke_lambda(arn, payload, "Event")

    def get_llm_response_callback(self, job_id: str, options: Dict[str, Any] = {}):
        arn = "arn:aws:lambda:us-east-2:900232986494:function:get_llm_response_callback"

        payload = {
            "job_id": job_id
        }

        messages = None

        if "message" in options:
            messages = options["messages"]

        if (messages is None and 
            "system_message" in options and
            "user_message" in options):

            messages = [
                {"role": "system", "content": options["system_message"]},
                {"role": "user", "content": options["user_message"]}
            ]
        
        payload["messages"] = messages
        if "model" in options:
            payload["model"] = options["model"]
        if "response_format" in options:
            payload["response_format"] = options["response_format"]
        if "endpoint" in options:
            payload["endpoint"] = options["endpoint"]
        if "parameters" in options:
            payload["parameters"] = options["parameters"]
        if "post_endpoint" in options:
            payload["post_endpoint"] = options["post_endpoint"]
        if "token_limit" in options:
            payload["token_limit"] = options["token_limit"]

        #print(payload)
        return self._invoke_lambda(arn, payload, "Event")
    
    def echo_callback(self, job_id: str, message: str) -> str:
        arn = "arn:aws:lambda:us-east-2:900232986494:function:echo_callback"
        payload = {
            "job_id": job_id,
            "message": message
        }
        self._invoke_lambda(arn, payload, "Event")

    async def echo(self, message: str) -> str:
        arn = "arn:aws:lambda:us-east-2:900232986494:function:echo"
        payload = {"message": message}
        result = self._invoke_lambda(arn, payload)
        return result["result"]

    def brave_search(self, query: str, max_results: int = None, offset: int = None,
                     retries: int = None, backoff_factor: float = None) -> List[Dict[str, Any]]:
        arn = "arn:aws:lambda:us-east-2:900232986494:function:brave_search"
        payload = {"query": query}
        if max_results is not None:
            payload["max_results"] = max_results
        if offset is not None:
            payload["offset"] = offset
        if retries is not None:
            payload["retries"] = retries
        if backoff_factor is not None:
            payload["backoff_factor"] = backoff_factor
        return self._invoke_lambda(arn, payload)

    def scrape_page(self, url: str, get_raw: bool = None) -> str:
        arn = "arn:aws:lambda:us-east-2:900232986494:function:scrape_page"
        payload = {"url": url}
        if get_raw is not None:
            payload["get_raw"] = get_raw
        result = self._invoke_lambda(arn, payload)
        return result["result"]

    def get_llm_response(self, messages: str = None, system_message: str = None,
                         user_message: str = None, model: str = None, response_format: Dict[str, str] = None,
                         endpoint: str = None, parameters: Dict[str, str] = None, post_endpoint: str = None,
                         token_limit: int = None):
        arn = "arn:aws:lambda:us-east-2:900232986494:function:get_llm_response"
        payload = {}
        if messages is None and system_message is not None and user_message is not None:
            messages = [
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message}
            ]
        payload["messages"] = messages
        if model is not None:
            payload["model"] = model
        if response_format is not None:
            payload["response_format"] = response_format
        if endpoint is not None:
            payload["endpoint"] = endpoint
        if parameters is not None:
            payload["parameters"] = parameters
        if post_endpoint is not None:
            payload["post_endpoint"] = post_endpoint
        if token_limit is not None:
            payload["token_limit"] = token_limit
        return self._invoke_lambda(arn, payload)

    def _invoke_lambda(self, arn: str, payload: dict, invocation_type: str = "RequestResponse"):
        client = boto3.client("lambda",
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID_LAMBDA"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY_LAMBDA"),
            region_name=os.getenv("AWS_DEFAULT_REGION_LAMBDA"))

        if invocation_type == "Event":

            if "callback_url" not in payload:
                payload["callback_url"] = NetConfig.get_callback_url()

            fly_id = os.getenv("FLY_MACHINE_ID", None)
            if fly_id is not None:
                payload["fly_force_instance_id"] = fly_id

            logger.info(f"invoking lambda with payload: {payload}")

            client.invoke(
                FunctionName=arn,
                InvocationType=invocation_type,
                LogType="Tail",
                Payload=json.dumps(payload).encode("utf-8"),
            )
            return

        response = client.invoke(
            FunctionName=arn,
            InvocationType=invocation_type,
            LogType="Tail",
            Payload=json.dumps(payload).encode("utf-8"),
        )
        if "FunctionError" in response:
            raw_err = response["Payload"].read().decode("utf-8", errors="replace")
            logs_b64 = response.get("LogResult")
            raise RuntimeError(
                f"Lambda FunctionError: {response['FunctionError']}. "
                f"Payload: {raw_err}. "
                f"Logs(Base64): {logs_b64}"
            )
        raw = response["Payload"].read().decode("utf-8", errors="replace").strip()
        if not raw or raw == "null":
            return None
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            if raw.startswith('"') and raw.endswith('"'):
                try:
                    obj = json.loads(json.loads(raw))
                except Exception:
                    return raw
            else:
                return raw
        if isinstance(obj, str) and obj.strip().startswith("{"):
            try:
                obj = json.loads(obj)
            except Exception as e:
                print(str(e))
                raise
        return obj
