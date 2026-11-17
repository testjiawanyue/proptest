"""作业选项页面对象。"""

from __future__ import annotations

import re

from playwright.sync_api import Locator, expect

from common.antd import button_with_text, click_confirm, row_by_text, row_count, tag_text
from pages.base import BasePage


class WorkOptionPage(BasePage):
    PATH = "/prop-settings/work-option"

    def open(self) -> "WorkOptionPage":
        self.goto()
        expect(self.page.locator(".option-page aside h2")).to_have_text("選択肢の区分")
        button_with_text(self.page, "選択肢を追加")
        return self

    def select_category(self, label: str) -> None:
        self.page.locator(".option-page aside").get_by_role(
            "button", name=label, exact=True
        ).click()
        expect(self.page.locator(".option-page section header h2")).to_have_text(label)

    def select_work_group(self, label: str) -> None:
        item = self.page.locator(".option-page .ant-segmented-item").filter(
            has_text=label
        ).first
        expect(item).to_be_visible()
        item.click()
        expect(item).to_have_class(re.compile(r"ant-segmented-item-selected"))

    def open_add(self) -> None:
        button_with_text(self.page, "選択肢を追加").click()
        expect(self.page.locator(".add input:visible")).to_be_visible()

    def fill_new_value(self, value: str) -> None:
        self.page.locator(".add input:visible").fill(value)

    def save(self) -> None:
        self.page.locator(".add .ant-btn-primary:visible").click()

    def cancel_add(self) -> None:
        button = self.page.locator(".add").get_by_role(
            "button", name=re.compile(r"^キャンセル$")
        )
        if button.count():
            button.click()

    def add_value(self, value: str) -> None:
        self.open_add()
        self.fill_new_value(value)
        self.save()

    def change_status(self, value: str, action: str) -> None:
        pattern = re.compile(rf"^{re.escape(action[0])}\s*{re.escape(action[1:])}$")
        button = row_by_text(self.page, value).get_by_role("button", name=pattern)
        expect(button).to_be_enabled()
        button.click()
        click_confirm(self.page)

    def row(self, value: str) -> Locator:
        return row_by_text(self.page, value)

    def status(self, value: str) -> str:
        return tag_text(self.row(value))

    def count(self, value: str) -> int:
        return row_count(self.page, value)
