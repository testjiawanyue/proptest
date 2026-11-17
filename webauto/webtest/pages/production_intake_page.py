"""衣体入库页面对象。"""

from __future__ import annotations

import re

from playwright.sync_api import Locator, expect

from common.antd import button_with_text, find_dropdown_option, visible_confirm
from pages.base import BasePage


class ProductionIntakePage(BasePage):
    PATH = "/production/intake"

    def open(self) -> "ProductionIntakePage":
        self.goto()
        expect(self.page.get_by_role("heading", name="今回の入庫設定", exact=True)).to_be_visible()
        expect(self.page.locator("#intake-profile")).to_be_visible()
        return self

    def select_jacket(self, prefix: str) -> None:
        self.page.locator("#intake-profile").click()
        dropdown = self.page.locator(".ant-select-dropdown:visible").last
        expect(dropdown).to_be_visible()
        pattern = re.compile(rf"{re.escape(prefix)}$")
        option = find_dropdown_option(dropdown, pattern=pattern)
        option.click(force=True)  # AntD 4 动画, 绕过 stable 检测
        expect(dropdown).to_be_hidden(timeout=5_000)
        expect(self.page.locator(".profile-summary")).to_be_visible()

    def add_single(self, suffix: str) -> str:
        input_box = self.page.locator("#intake-number")
        input_box.fill(suffix)
        input_box.press("Enter")
        # 编号由页面前缀 + 输入后缀组成，返回候选行定位所需的完整编号。
        prefix = self.page.locator(".input-prefix").first.inner_text().strip()
        full_number = f"{prefix}{suffix}"
        expect(self.candidate_row(full_number)).to_be_visible()
        return full_number

    def add_range(self, start_suffix: str, end_suffix: str) -> None:
        self.page.get_by_role("tab", name="連続入力", exact=True).click()
        self.page.locator("#intake-start").fill(start_suffix)
        self.page.locator("#intake-end").fill(end_suffix)
        self.page.get_by_role("button", name=re.compile(r"^追\s*加$")).click()

    def candidate_row(self, number: str) -> Locator:
        row = self.page.locator(".candidate-panel .ant-table-row").filter(has_text=number).first
        expect(row).to_be_visible()
        return row

    def candidate_status(self, number: str) -> str:
        return self.candidate_row(number).locator(".ant-tag").inner_text().strip()

    def candidate_count(self) -> int:
        header = self.page.locator(".candidate-panel h2").inner_text()
        match = re.search(r"（(\d+)件）", header)
        return int(match.group(1)) if match else 0

    def wait_for_candidate_count(self, count: int) -> None:
        expect(self.page.locator(".candidate-panel h2")).to_contain_text(f"（{count}件）")

    def confirm_all(self) -> None:
        button_with_text(self.page, "すべて入庫する").click()
        confirm = visible_confirm(self.page)
        expect(confirm).to_contain_text("入庫の確認")
        confirm.get_by_role("button", name="入庫する", exact=True).click()
        expect(confirm).to_be_hidden(timeout=self.settings.default_timeout_ms)

    def clear_all(self) -> None:
        button_with_text(self.page, "今回の入力をクリア").click()
        self.wait_for_candidate_count(0)
