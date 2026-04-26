def normalize_letters_only(s: str) -> str:
    return ''.join(c for c in s if c.isalpha()).lower()