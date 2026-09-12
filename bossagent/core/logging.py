from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any


PHONE = re.compile(r"(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)")
EMAIL = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
SECRET = re.compile(r"(?i)(cookie|token|session|authorization)(\s*[:=]\s*)([^\s,;]+)")


def redact(value: Any, *, max_length: int = 500) -> Any:
    if isinstance(value, dict):
        return {str(key): redact(item, max_length=max_length) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item, max_length=max_length) for item in value[:50]]
    text = str(value or "")
    text = PHONE.sub("[REDACTED_PHONE]", text)
    text = EMAIL.sub("[REDACTED_EMAIL]", text)
    text = SECRET.sub(r"\1\2[REDACTED]", text)
    if any(part in text.lower() for part in ("screenshot", ".png", ".html")):
        text = Path(text).name
    return text[:max_length] + ("..." if len(text) > max_length else "")


def get_logger(name: str) -> logging.Logger:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    return logging.getLogger(name)
