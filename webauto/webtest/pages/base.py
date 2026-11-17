"""页面对象基类：封装与业务无关的导航和通用操作。

具体页面继承本类，只声明定位器和页面动作，不写断言。
"""

from __future__ import annotations

from typing import Any

from playwright.sync_api import Locator, Page

from common.config import Settings


class BasePage:
    PATH: str = ""

    def __init__(self, page: Page, settings: Settings):
        self.page = page
        self.settings = settings

    @property
    def url(self) -> str:
        return self.settings.url(self.PATH)

    def goto(self, wait_until: str = "domcontentloaded", **kwargs: Any) -> "BasePage":
        self.page.goto(self.url, wait_until=wait_until, **kwargs)
        return self

    def wait_for_ready(self, timeout: int | None = None) -> "BasePage":
        self.page.wait_for_load_state("load", timeout=timeout or self.settings.default_timeout_ms)
        return self

    def locator(self, selector: str) -> Locator:
        return self.page.locator(selector)

    def by_test_id(self, test_id: str) -> Locator:
        return self.page.get_by_test_id(test_id)
