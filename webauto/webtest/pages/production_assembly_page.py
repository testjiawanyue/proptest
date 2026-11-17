"""部件组装页面对象。"""

from __future__ import annotations

import re

from playwright.sync_api import Locator, Response, expect

from common.antd import button_with_text, find_dropdown_option
from pages.base import BasePage


class ProductionAssemblyPage(BasePage):
    PATH = "/production/assembly"
    ROW = ".assembly-card .ant-table-tbody tr.ant-table-row"

    def open(self) -> "ProductionAssemblyPage":
        self.goto()
        expect(self.page.get_by_role("heading", name="部品組立", exact=True)).to_be_visible()
        expect(self.page.locator("#assembly-jacket")).to_be_visible()
        return self

    def select_jacket(self, prefix: str) -> None:
        self.page.locator("#assembly-jacket").click()
        dropdown = self.page.locator(".ant-select-dropdown:visible").last
        expect(dropdown).to_be_visible()
        pattern = re.compile(rf"{re.escape(prefix)}$")
        option = find_dropdown_option(dropdown, pattern=pattern)
        option.click(force=True)  # AntD 4 动画, 绕过 stable 检测
        expect(dropdown).to_be_hidden(timeout=5_000)

    def _select_field(self, field_id: str, option_text: str) -> None:
        root = self.page.locator(f"#{field_id}").locator(
            "xpath=ancestor::div[contains(@class,'ant-select')][1]"
        )
        root.click()
        dropdown = self.page.locator(".ant-select-dropdown:visible").last
        expect(dropdown).to_be_visible()
        option = find_dropdown_option(dropdown, text=option_text)
        option.click(force=True)
        # 等待 dropdown 关闭，确保下一个 select 的下拉不会被残留动画影响
        expect(dropdown).to_be_hidden(timeout=5_000)
        expect(root).to_contain_text(option_text)

    def set_defaults(
        self,
        *,
        airbag: str,
        sensor: str,
        firmware: str,
        inflator: str,
    ) -> None:
        self._select_field("assembly-airbag-profile", airbag)
        self._select_field("assembly-sensor-profile", sensor)
        self._select_field("assembly-firmware", firmware)
        self._select_field("assembly-inflator_1-profile", inflator)
        self._select_field("assembly-inflator_2-profile", inflator)

    def select_airbag(self, option_text: str) -> None:
        """仅选择气囊默认资料，用于只需检索产品的轻量校验。"""
        self._select_field("assembly-airbag-profile", option_text)

    def search_range(self, start_suffix: str, end_suffix: str) -> None:
        self.page.locator("#assembly-start").fill(start_suffix)
        self.page.locator("#assembly-end").fill(end_suffix)
        button_with_text(self.page, "検索して組立入力へ").click()
        expect(self.page.locator(self.ROW).first).to_be_visible()

    def row(self, manufacturing_no: str) -> Locator:
        row = self.page.locator(self.ROW).filter(has_text=manufacturing_no).first
        expect(row).to_be_visible()
        return row

    def save_cell(self, manufacturing_no: str, column_index: int, suffix: str) -> Response:
        row = self.row(manufacturing_no)
        input_box = row.locator("td input").nth(column_index)
        input_box.click()
        with self.page.expect_response(
            lambda response: "/prop/production/assembly/entry" in response.url
            and response.request.method == "PUT",
            timeout=15_000,
        ) as response_info:
            input_box.fill(suffix)
            input_box.press("Enter")
        response = response_info.value
        expect(row.locator(".cell-error")).to_have_count(0)
        return response

    def cell_value(self, manufacturing_no: str, column_index: int) -> str:
        return self.row(manufacturing_no).locator("td input").nth(column_index).input_value()

    def cell_error(self, manufacturing_no: str, column_index: int) -> str:
        row = self.row(manufacturing_no)
        error = row.locator(".cell-error")
        return error.nth(column_index).inner_text().strip() if error.count() else ""

    def complete_count(self) -> tuple[int, int]:
        text = self.page.locator(".assembly-card").inner_text()
        match = re.search(r"必須部品の取付完了\s*(\d+)/(\d+)台", text)
        return (int(match.group(1)), int(match.group(2))) if match else (0, 0)

