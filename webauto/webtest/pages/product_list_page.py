"""产品列表页面对象：覆盖三种查询、详情返回与删除阻断。"""

from __future__ import annotations

import re

from playwright.sync_api import Locator, expect

from common.antd import button_with_text
from pages.base import BasePage


class ProductListPage(BasePage):
    PATH = "/products/list"
    ROW = ".product-page .ant-table-tbody tr.ant-table-row"
    SEARCH_ENDPOINT = "/prop/production/product-list"

    def open(self) -> "ProductListPage":
        self.goto()
        expect(self.page.get_by_role("heading", name="製品一覧", exact=True)).to_be_visible()
        expect(self.page.locator(self.ROW).first).to_be_visible()
        return self

    def select_mode(self, label: str) -> None:
        option = self.page.locator(".ant-segmented-item-label").filter(
            has_text=re.compile(rf"^{re.escape(label)}$")
        )
        expect(option).to_be_visible()
        option.click()

    def search_range(
        self,
        *,
        prefix: str,
        start_no: str,
        end_no: str,
        expected_total: int,
    ) -> None:
        self.select_mode("範囲検索")
        self.page.get_by_label("接頭辞", exact=True).fill(prefix)
        self.page.get_by_label("開始番号", exact=True).fill(start_no)
        self.page.get_by_label("終了番号", exact=True).fill(end_no)
        self._search(expected_total)

    def search_single(self, manufacturing_no: str, *, expected_total: int) -> None:
        self.select_mode("製造番号検索")
        self.page.locator("#product-number").fill(manufacturing_no)
        self._search(expected_total)

    def search_part(self, part_no: str, *, expected_total: int) -> None:
        self.select_mode("部品番号検索")
        self.page.locator("#product-part-number").fill(part_no)
        self._search(expected_total)

    def _search(self, expected_total: int) -> None:
        with self.page.expect_response(
            lambda response: self.SEARCH_ENDPOINT in response.url
            and response.request.method == "GET",
            timeout=15_000,
        ) as response_info:
            button_with_text(self.page, "検索").click()
        assert response_info.value.ok
        self.expect_total(expected_total)

    def expect_total(self, expected: int) -> None:
        expect(self.page.locator(".total")).to_have_text(f"全{expected}台")

    def total_count(self) -> int:
        text = self.page.locator(".total").inner_text()
        match = re.search(r"全(\d+)台", text)
        return int(match.group(1)) if match else 0

    def stage_filter_text(self) -> str:
        root = self.page.locator("#product-stage").locator(
            "xpath=ancestor::div[contains(@class,'ant-select')][1]"
        )
        return root.inner_text().strip()

    def row(self, manufacturing_no: str) -> Locator:
        row = self.page.locator(self.ROW).filter(has_text=manufacturing_no).first
        expect(row).to_be_visible()
        return row

    def row_count(self) -> int:
        return self.page.locator(self.ROW).count()

    def _cell(self, row: Locator, index: int) -> Locator:
        return row.locator("td").nth(index)

    def stage(self, row: Locator) -> str:
        return self._cell(row, 1).locator(".ant-tag").inner_text().strip()

    def name_and_specification(self, row: Locator) -> str:
        return self._cell(row, 2).inner_text().strip()

    def owner(self, row: Locator) -> str:
        return self._cell(row, 3).inner_text().strip()

    def status(self, row: Locator) -> str:
        return self._cell(row, 4).locator(".ant-tag").inner_text().strip()

    def composition(self, row: Locator) -> dict[str, str]:
        result: dict[str, str] = {}
        for line in row.locator(".part-summary").all_inner_texts():
            label, _, value = line.partition("：")
            result[label.strip()] = value.strip()
        return result

    def airbag_number(self, row: Locator) -> str:
        return self.composition(row).get("エアバッグ", "-").split(" / ")[0].strip()

    def sensor_number(self, row: Locator) -> str:
        return self.composition(row).get("センサ", "-").split(" / ")[0].strip()

    def inflator_numbers(self, row: Locator) -> tuple[str, ...]:
        value = self.composition(row).get("インフレータ", "-")
        return tuple(part.strip() for part in value.split(" / ") if part.strip() not in {"", "-"})

    def inspection_date(self, row: Locator) -> str:
        return self._cell(row, 6).inner_text().strip()

    def first_shipment(self, row: Locator) -> str:
        return self._cell(row, 7).inner_text().strip()

    def open_detail(self, row: Locator) -> "ProductListPage":
        with self.page.expect_response(
            lambda response: re.search(r"/prop/production/products/\d+$", response.url) is not None
            and response.request.method == "GET",
            timeout=15_000,
        ) as response_info:
            button_with_text(row, "詳細").click()
        assert response_info.value.ok
        expect(self.page).to_have_url(re.compile(r"/products/\d+$"))
        expect(self.page.locator("h1")).to_be_visible()
        return self

    def detail_heading(self) -> str:
        return self.page.locator("h1").inner_text().strip()

    def detail_basic_text(self) -> str:
        card = self.page.locator(".ant-card").filter(has_text="基本情報").first
        expect(card).to_be_visible()
        return card.inner_text()

    def detail_part_row(self, label: str) -> Locator:
        card = self.page.locator(".ant-card").filter(has_text="取り付け中の部品").first
        expect(card).to_be_visible()
        row = card.locator("tr.ant-table-row").filter(has_text=label).first
        expect(row).to_be_visible()
        return row

    def back_to_list(self) -> "ProductListPage":
        self.page.locator("button[aria-label='戻る']").click()
        expect(self.page).to_have_url(re.compile(r"/products/list"))
        expect(self.page.get_by_role("heading", name="製品一覧", exact=True)).to_be_visible()
        return self

    def delete_product(self, row: Locator) -> None:
        row.locator("button").filter(has_text="···").click()
        menu_item = self.page.locator(
            ".ant-dropdown:visible .ant-dropdown-menu-item"
        ).filter(has_text="製品を削除").first
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
