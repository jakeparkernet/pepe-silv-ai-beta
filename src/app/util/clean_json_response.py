import re
from fast_json_repair import repair_json  # returns a JSON string by default :contentReference[oaicite:2]{index=2}

_CODE_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)

def _strip_code_fences(text: str) -> str:
    return _CODE_FENCE_RE.sub("", text).strip()

def _extract_first_json_block(text: str) -> str | None:
    start = None
    start_ch = None
    for i, ch in enumerate(text):
        if ch in "{[":
            start, start_ch = i, ch
            break
    if start is None:
        return None

    end_ch = "}" if start_ch == "{" else "]"

    depth = 0
    in_str = False
    esc = False

    for j in range(start, len(text)):
        ch = text[j]

        if in_str:
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = False
            continue

        if ch == '"':
            in_str = True
            continue

        if ch == start_ch:
            depth += 1
        elif ch == end_ch:
            depth -= 1
            if depth == 0:
                return text[start : j + 1]

    return None

def custom_repair_json(text: str) -> str:
    """
    Returns a strictly valid JSON *string* from an LLM response.
    Output is ASCII-only (non-ASCII escaped) via ensure_ascii=True. :contentReference[oaicite:3]{index=3}
    """
    if not isinstance(text, str):
        raise TypeError("Input must be a string")

    cleaned = _strip_code_fences(text)
    extracted = _extract_first_json_block(cleaned)
    candidate = extracted if extracted is not None else cleaned

    # Returns valid JSON string (not a dict), and escapes non-ASCII -> ASCII-only output.
    return repair_json(candidate, ensure_ascii=True, skip_json_loads=True)
