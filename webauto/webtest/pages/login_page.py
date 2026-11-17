"""登录页对象。"""

from __future__ import annotations

import re

from playwright.sync_api import expect

from pages.base import BasePage


class LoginPage(BasePage):
    PATH = "/login2"

    def open(self) -> "LoginPage":
        self.goto()
        expect(self.page).to_have_url(re.compile(r"/login2(?:$|[?#])"))
        expect(self.page.get_by_role("heading", name="ログイン", exact=True)).to_be_visible()
        return self

    def login(self, username: str, password: str) -> None:
        self.page.locator("#form_item_username").fill(username)
        self.page.locator("#form_item_password").fill(password)
        self.page.get_by_role("button", name="ログイン", exact=True).click()
        self.page.wait_for_url(
            re.compile(r"/home/workbench"),
            timeout=self.settings.default_timeout_ms,
        )
