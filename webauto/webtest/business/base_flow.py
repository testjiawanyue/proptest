"""业务流程基类：组合多个页面对象完成跨页面业务动作，不包含断言。"""

from __future__ import annotations

from playwright.sync_api import Page

from common.config import Settings


class BaseFlow:
    def __init__(self, page: Page, settings: Settings):
        self.page = page
        self.settings = settings
