"""登录业务流程。"""

from __future__ import annotations

from business.base_flow import BaseFlow
from pages.login_page import LoginPage


class AuthFlow(BaseFlow):
    def login(self) -> None:
        LoginPage(self.page, self.settings).open().login(
            self.settings.username,
            self.settings.password,
        )
