def get_first_word(text: str) -> str:
    if text is None:
        return None
    return text.split(maxsplit=1)[0] if text else text
