"""部件追溯页面对象：覆盖组合筛选、详情履历与已绑定删除阻断。"""

from __future__ import annotations

import re

from playwright.sync_api import Locator, expect

from common.antd import button_with_text, find_dropdown_option
from pages.base import BasePage


class PartTracingPage(BasePage):
    PATH = "/products/parts"
    ROW = ".part-page .ant-table-tbody tr.ant-table-row"
    SEARCH_ENDPOINT = "/prop/production/parts?"

    def open(self) -> "PartTracingPage":
        self.goto()
        expect(self.page.get_by_role("heading", name="部品履歴", exact=True)).to_be_visible()
        expect(self.page.locator("#part-partNo")).to_be_visible()
        expect(self.page.locator(self.ROW).first).to_be_visible()
        return self

    def _select_by_id(
        self,
        field_id: str,
        option_text: str,
        expected_total: int | None,
    ) -> None:
        root = self.page.locator(f"#{field_id}").locator(
            "xpath=ancestor::div[contains(@class,'ant-select')][1]"
        )
        root.click()
        dropdown = self.page.locator(".ant-select-dropdown:visible").last
        expect(dropdown).to_be_visible()
        pattern = re.compile(rf"{re.escape(option_text)}$")
        option = find_dropdown_option(dropdown, pattern=pattern)
        with self.page.expect_response(
            lambda response: self.SEARCH_ENDPOINT in response.url
            and response.request.method == "GET",
            timeout=15_000,
        ) as response_info:
            option.click(force=True)
        assert response_info.value.ok
        expect(root).to_contain_text(option_text)
        if expected_total is not None:
            self.expect_total(expected_total)

    def select_type(self, label: str, *, expected_total: int | None = None) -> None:
        self._select_by_id("part-partType", label, expected_total)

    def select_owner(self, label: str, *, expected_total: int | None = None) -> None:
        self._select_by_id("part-bound", label, expected_total)

    def search(self, part_no: str, *, expected_total: int | None = None) -> None:
        self.page.locator("#part-partNo").fill(part_no)
        with self.page.expect_response(
            lambda response: self.SEARCH_ENDPOINT in response.url
            and response.request.method == "GET",
            timeout=15_000,
        ) as response_info:
            button_with_text(self.page, "検索").click()
        assert response_info.value.ok
        if expected_total is not None:
            self.expect_total(expected_total)

    def reset(self) -> None:
        with self.page.expect_response(
            lambda response: self.SEARCH_ENDPOINT in response.url
            and response.request.method == "GET",
            timeout=15_000,
        ) as response_info:
            button_with_text(self.page, "リセット").click()
        assert response_info.value.ok

    def expect_total(self, expected: int) -> None:
        expect(self.page.locator(".toolbar > span")).to_have_text(f"全{expected}件")

    def total_count(self) -> int:
        text = self.page.locator(".toolbar > span").inner_text()
        match = re.search(r"全(\d+)件", text)
        return int(match.group(1)) if match else 0

    def row_count(self) -> int:
        return self.page.locator(self.ROW).count()

    def row(self, part_no: str) -> Locator:
        row = self.page.locator(self.ROW).filter(has_text=part_no).first
        expect(row).to_be_visible()
        return row

    def part_no(self, row: Locator) -> str:
        return row.locator("code").first.inner_text().strip()

    def type_text(self, row: Locator) -> str:
        return row.locator("td").nth(1).inner_text().strip()

    def profile_text(self, row: Locator) -> str:
        return row.locator("td").nth(2).inner_text().strip()

    def owner_text(self, row: Locator) -> str:
        return row.locator("td").nth(3).inner_text().strip()

    def registered_text(self, row: Locator) -> str:
        return row.locator("td").nth(4).inner_text().strip()

    def filter_text(self, field_id: str) -> str:
        root = self.page.locator(f"#{field_id}").locator(
            "xpath=ancestor::div[contains(@class,'ant-select')][1]"
        )
        return root.inner_text().strip()

    def open_detail(self, row: Locator) -> None:
        with self.page.expect_response(
            lambda response: re.search(r"/prop/production/parts/\d+$", response.url) is not None
            and response.request.method == "GET",
            timeout=15_000,
        ) as response_info:
            button_with_text(row, "詳細").click()
        assert response_info.value.ok
        expect(self.page.locator(".ant-modal:visible .ant-modal-title")).to_have_text("部品の詳細")

    def detail_text(self) -> str:
        modal = self.page.locator(".ant-modal:visible").last
        expect(modal.locator(".ant-descriptions")).to_be_visible()
        return modal.inner_text()

    def close_detail(self) -> None:
        modal = self.page.locator(".ant-modal:visible").last
        modal.locator(".ant-modal-close").click()
        expect(modal).to_be_hidden(timeout=self.settings.default_timeout_ms)

    def delete_part(self, row: Locator) -> None:
        row.locator("button").filter(has_text="···").click()
        menu_item = self.page.locator(
            ".ant-dropdown:visible .ant-dropdown-menu-item"
        ).filter(has_text=re.compile(r"^削除$")).first
        expect(menu_item).to_be_visible()
        menu_item.click()
        expect(self.page.locator(".ant-modal-confirm-title")).to_be_visible()

    def delete_feedback(self) -> str:
        modal = self.page.locator(".ant-modal-confirm:visible").last
        expect(modal).to_be_visible()
        return modal.inner_text().strip()

    def close_confirm(self) -> None:
        modal = self.page.locator(".ant-modal-confirm:visible").last
        modal.locator(".ant-modal-confirm-btns .ant-btn-primary").first.click()
        expect(modal).to_be_hidden(timeout=self.settings.default_timeout_ms)
