"""订单列表页面对象：关键词查询、制造番号查询与详情跳转。"""

from __future__ import annotations

import re

from playwright.sync_api import Locator, expect

from common.antd import button_with_text
from pages.base import BasePage


class OrderListPage(BasePage):
    PATH = "/orders/index"
    ROW = ".order-page .ant-table-tbody tr.ant-table-row"
    SEARCH_ENDPOINT = "/prop/order/list"

    def open(self) -> "OrderListPage":
        self.goto()
        expect(self.page.get_by_role("heading", name="注文一覧", exact=True)).to_be_visible()
        expect(self.page.locator(".order-page .ant-table")).to_be_visible()
        return self

    def search_keyword(self, value: str, *, expected_total: int | None = None) -> None:
        self.page.get_by_placeholder(
            "注文管理番号／お客様注文番号／注文先／納品先"
        ).fill(value)
        self._search(expected_total)

    def search_manufacturing_no(
        self, value: str, *, expected_total: int | None = None
    ) -> None:
        self.page.get_by_placeholder("製造番号を入力").fill(value)
        self._search(expected_total)

    def _search(self, expected_total: int | None) -> None:
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
        expect(self.page.locator(".ant-pagination-total-text")).to_have_text(
            f"全{expected}件"
        )

    def total_count(self) -> int:
        text = self.page.locator(".ant-pagination-total-text").inner_text()
        match = re.search(r"全(\d+)件", text)
        return int(match.group(1)) if match else 0

    def row_count(self) -> int:
        return self.page.locator(self.ROW).count()

    def row_by_order_no(self, order_no: str) -> Locator:
        row = self.page.locator(self.ROW).filter(has_text=order_no).first
        expect(row).to_be_visible()
        return row

    def _cell(self, row: Locator, index: int) -> Locator:
        return row.locator("td").nth(index)

    def order_no(self, row: Locator) -> str:
        return self._cell(row, 0).locator(".mono").inner_text().strip()

    def customer_order_no(self, row: Locator) -> str:
        return self._cell(row, 0).locator("strong").inner_text().strip()

    def ordering_party(self, row: Locator) -> str:
        return self._cell(row, 1).inner_text().splitlines()[0].strip()

    def recipient_text(self, row: Locator) -> str:
        lines = [line.strip() for line in self._cell(row, 1).inner_text().splitlines()]
        return next((line for line in lines if line.startswith("納品先：")), "")

    def requirement(self, row: Locator) -> str:
        return self._cell(row, 2).locator(".ellipsis").inner_text().strip()

    def total_quantity(self, row: Locator) -> str:
        return self._cell(row, 2).locator(".muted").inner_text().strip()

    def type_text(self, row: Locator) -> str:
        return self._cell(row, 3).locator(".ant-tag").inner_text().strip()

    def dates_text(self, row: Locator) -> str:
        return self._cell(row, 4).inner_text().strip()

    def progress_text(self, row: Locator) -> str:
        return self._cell(row, 5).locator(".ant-tag").inner_text().strip()

    def fulfilled_text(self, row: Locator) -> str:
        return self._cell(row, 5).locator(".muted").inner_text().strip()

    def open_detail(self, row: Locator) -> None:
        with self.page.expect_response(
            lambda response: re.search(r"/prop/order/\d+$", response.url) is not None
            and response.request.method == "GET",
            timeout=15_000,
        ) as response_info:
            row.locator(".action-btn").filter(has_text="詳細").click()
        assert response_info.value.ok
        expect(self.page).to_have_url(re.compile(r"/orders/\d+$"))

