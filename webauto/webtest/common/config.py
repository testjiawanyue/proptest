"""环境配置解析；所有测试通过 fixture 获取 base URL 与全局设置。"""

from __future__ import annotations

import os
from dataclasses import dataclass


DEFAULT_BASE_URL = "http://localhost:8090"
DEFAULT_TIMEOUT_MS = 10_000
DEFAULT_USERNAME = "admin"
DEFAULT_PASSWORD = "admin123"


@dataclass(frozen=True)
class Settings:
    """运行环境配置；通过 ``settings`` fixture 注入，用例不直接读环境变量。"""

    base_url: str
    default_timeout_ms: int = DEFAULT_TIMEOUT_MS
    username: str = DEFAULT_USERNAME
    password: str = DEFAULT_PASSWORD

    def url(self, path: str = "") -> str:
        return f"{self.base_url.rstrip('/')}/{path.lstrip('/')}" if path else self.base_url.rstrip("/")


def settings_from_env(base_url: str | None = None) -> Settings:
    return Settings(
        base_url=(base_url or os.getenv("WEBTEST_BASE_URL") or DEFAULT_BASE_URL).rstrip("/"),
        default_timeout_ms=int(os.getenv("WEBTEST_DEFAULT_TIMEOUT_MS", str(DEFAULT_TIMEOUT_MS))),
        username=os.getenv("WEBTEST_USERNAME", DEFAULT_USERNAME),
        password=os.getenv("WEBTEST_PASSWORD", DEFAULT_PASSWORD),
    )
