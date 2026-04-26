def first_n_chars(text: str, n: int) -> str:
    if text is None:
        return None
    if n <= 0:
        return ""
    return text[:n]
