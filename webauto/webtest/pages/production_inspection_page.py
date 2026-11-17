"""质检工作台页面对象。"""

from __future__ import annotations

import re

from playwright.sync_api import Locator, expect

from common.antd import button_with_text, find_dropdown_option, visible_confirm
from pages.base import BasePage


class ProductionInspectionPage(BasePage):
    PATH = "/production/inspection"

    def open(self) -> "ProductionInspectionPage":
        self.goto()
        expect(
            self.page.get_by_role("heading", name="組立検査待ちの製品を検索", exact=True)
        ).to_be_visible()
        expect(self.page.locator("#inspection-prefix")).to_be_visible()
        return self

    def select_prefix(self, prefix: str) -> None:
        self.page.locator(".filter-panel .ant-select").first.click()
        dropdown = self.page.locator(".ant-select-dropdown:visible").last
        expect(dropdown).to_be_visible()
        pattern = re.compile(rf"{re.escape(prefix)}$")
        option = find_dropdown_option(dropdown, pattern=pattern)
        option.click(force=True)  # AntD 4 动画, 绕过 stable 检测
        expect(dropdown).to_be_hidden(timeout=5_000)

    def filter_range(self, start_suffix: str, end_suffix: str) -> None:
        self.page.get_by_role("tab", name="連続入力", exact=True).click()
        self.page.locator("#inspection-start").fill(start_suffix)
        self.page.locator("#inspection-end").fill(end_suffix)
        self._search()

    def filter_single(self, suffix: str) -> None:
        self.page.get_by_role("tab", name="番号入力", exact=True).click()
        self.page.locator("#inspection-number").fill(suffix)
        self._search()

    def filter_single_expect_alert(self, suffix: str) -> str:
        """单件筛选已质检产品：接口返回不可登记，只等待页面提示。"""
        self.page.get_by_role("tab", name="番号入力", exact=True).click()
        self.page.locator("#inspection-number").fill(suffix)
        self.page.get_by_role("button", name=re.compile(r"^検\s*索$")).click()
        alert = self.page.locator(".list-panel .ant-alert").first
        expect(alert).to_be_visible()
        return alert.inner_text().strip()

    def _search(self) -> None:
        with self.page.expect_response(
            lambda response: "/prop/production/inspection/candidates" in response.url
            and response.request.method == "GET",
            timeout=15_000,
        ) as response_info:
            self.page.get_by_role("button", name=re.compile(r"^検\s*索$")).click()
        assert response_info.value.ok

    def row(self, manufacturing_no: str) -> Locator:
        row = self.page.locator(".list-panel .ant-table-row").filter(has_text=manufacturing_no).first
        expect(row).to_be_visible()
        return row

    def row_count(self) -> int:
        return self.page.locator(".list-panel .ant-table-row").count()

    def status(self, manufacturing_no: str) -> str:
        return self.row(manufacturing_no).locator(".ant-tag").inner_text().strip()

    def select_row(self, manufacturing_no: str) -> None:
        self.row(manufacturing_no).locator(".ant-checkbox-wrapper").click()

    def selected_count(self) -> int:
        text = self.page.locator(".list-panel header").inner_text()
        match = re.search(r"選択中\s*(\d+)件", text)
        return int(match.group(1)) if match else 0

    def confirm(self) -> None:
        button_with_text(self.page, "検査合格を登録").click()
        confirm = visible_confirm(self.page)
        expect(confirm).to_contain_text("組立検査合格の登録")
        confirm.get_by_role("button", name="検査合格を登録", exact=True).click()
        expect(confirm).to_be_hidden(timeout=self.settings.default_timeout_ms)

    def alert_text(self) -> str:
        alert = self.page.locator(".list-panel .ant-alert").first
        expect(alert).to_be_visible()
        return alert.inner_text().strip()

    def reset(self) -> None:
        button_with_text(self.page, "検索条件をリセット").click()
