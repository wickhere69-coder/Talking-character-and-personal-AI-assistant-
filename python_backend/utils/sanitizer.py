"""String sanitization utilities."""


def sanitize_string(text: str, max_length: int = 4000) -> str:
    """Strip null bytes, truncate, strip leading/trailing whitespace."""
    if not text:
        return ""
    # Remove null bytes
    text = text.replace("\x00", "")
    # Truncate
    if len(text) > max_length:
        text = text[:max_length]
    return text.strip()
