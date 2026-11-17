"""无业务含义的测试工具。"""

from __future__ import annotations

import re
import time
import uuid


def unique_token(prefix: str = "T", length: int | None = None) -> str:
    value = f"{prefix}{time.time_ns()}{uuid.uuid4().hex[:8]}"
    return value[:length] if length else value


def parse_count(text: str, pattern: str) -> int | None:
    match = re.search(pattern, text)
    return int(match.group(1)) if match else None


def first_non_empty(values):
    return next((value for value in values if value), None)
