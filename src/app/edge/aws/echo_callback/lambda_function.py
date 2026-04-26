import json
import time
import urllib.request
import urllib.error
from urllib.parse import urljoin

from echo import echo
from send_response import send_response


def check_health(callback_url: str, fly_force_instance_id: str | None, timeout_seconds: int = 5):
    url = urljoin(callback_url, "/api/health")

    headers = {}
    if fly_force_instance_id:
        headers["Fly-Force-Instance-Id"] = fly_force_instance_id

    print("\n=== HEALTH CHECK START ===")
    print(f"[HEALTH] URL: {url}")
    print(f"[HEALTH] Headers: {headers}")

    start = time.time()

    try:
        req = urllib.request.Request(
            url,
            headers=headers,
            method="GET",
        )

        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            duration = time.time() - start

            status = getattr(resp, "status", None) or resp.getcode()
            raw = resp.read() or b""

            try:
                body = json.loads(raw.decode("utf-8"))
            except Exception:
                body = raw.decode("utf-8", "ignore")

            print(f"[HEALTH] SUCCESS")
            print(f"[HEALTH] status={status}")
            print(f"[HEALTH] duration={duration:.3f}s")
            print(f"[HEALTH] body={body}")
            print("=== HEALTH CHECK END ===\n")

            return {
                "ok": True,
                "status": int(status),
                "duration": duration,
                "body": body,
            }

    except urllib.error.HTTPError as e:
        duration = time.time() - start
        raw = e.read() or b""

        print(f"[HEALTH] HTTP ERROR")
        print(f"[HEALTH] status={e.code}")
        print(f"[HEALTH] duration={duration:.3f}s")
        print(f"[HEALTH] body={raw.decode('utf-8', 'ignore')}")
        print("=== HEALTH CHECK END ===\n")

        return {
            "ok": False,
            "status": int(e.code),
            "duration": duration,
            "error": "http_error",
        }

    except urllib.error.URLError as e:
        duration = time.time() - start

        print(f"[HEALTH] NETWORK ERROR")
        print(f"[HEALTH] duration={duration:.3f}s")
        print(f"[HEALTH] error={e}")
        print("=== HEALTH CHECK END ===\n")

        return {
            "ok": False,
            "duration": duration,
            "error": str(e),
        }


def lambda_handler(event, context):
    print("\n=== LAMBDA START ===")
    print("Received event:", event)

    fly_force_instance_id = event.get("fly_force_instance_id")

    # ---- STEP 1: HEALTH CHECK ----
    health = check_health(
        callback_url=event["callback_url"],
        fly_force_instance_id=fly_force_instance_id,
        timeout_seconds=5,
    )

    print("[HEALTH RESULT]:", health)

    # ---- OPTIONAL: HARD FAIL IF UNREACHABLE ----
    # Uncomment this if you want to abort early
    # if not health["ok"]:
    #     print("[ABORT] Cannot reach Fly machine, exiting early.")
    #     return

    # ---- STEP 2: PREP CALLBACK HEADERS ----
    response_headers = event.get("response_headers") or {}

    if fly_force_instance_id:
        print(f"[REPLAY] Forcing replay to instance={fly_force_instance_id}")
        response_headers["fly-replay"] = f"instance={fly_force_instance_id}"

    # ---- STEP 3: BUSINESS LOGIC ----
    result = echo(event)

    # ---- STEP 4: SEND CALLBACK ----
    payload = {
        "job_id": event["job_id"],
        "status_code": 200,
        "result": result,
        "callback_url": event["callback_url"],
        "health_check": health,  # <-- include for debugging
    }

    print("[CALLBACK] Sending response payload:")
    print(json.dumps(payload, indent=2))

    send_response(
        payload,
        response_headers,
        fly_force_instance_id=fly_force_instance_id,
    )

    print("=== LAMBDA END ===\n")