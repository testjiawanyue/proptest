"""订单详情中的寄送抽屉：创建准备、录入产品、维护承运商。"""

from __future__ import annotations

import re
from typing import Any

from playwright.sync_api import Locator, expect

from common.antd import find_dropdown_option
from pages.base import BasePage


class ShipmentDrawerPage(BasePage):
    def __init__(self, page, settings, root: Locator):
        super().__init__(page, settings)
        self.root = root

    @classmethod
    def wait_open(cls, page, settings) -> "ShipmentDrawerPage":
        root = page.locator(".ant-drawer-content:visible").last
        expect(root.locator(".ant-drawer-title")).to_contain_text("発送準備")
        expect(root.locator(".ant-drawer-title")).to_contain_text(re.compile(r"SH\d+"))
        return cls(page, settings, root)

    def shipment_no(self) -> str:
        text = self.root.locator(".ant-drawer-title").inner_text()
        match = re.search(r"SH\d+", text)
        assert match is not None, f"未从抽屉标题中解析到寄送编号：{text}"
        return match.group(0)

    def _products_endpoint(self, response) -> bool:
        return (
            re.search(r"/prop/shipment/\d+/products$", response.url) is not None
            and response.request.method == "POST"
        )

    def add_product_single(self, manufacturing_no: str) -> tuple[str, ...]:
        self.root.get_by_text("1件ずつ登録", exact=True).click()
        number = self.root.get_by_placeholder("製造番号を読み取るか入力して、Enterキーで追加")
        number.fill(manufacturing_no)
        with self.page.expect_response(self._products_endpoint, timeout=20_000) as response_info:
            self.root.locator("button").filter(has_text=re.compile(r"追\s*加")).first.click()
        assert response_info.value.ok
        payload: dict[str, Any] = response_info.value.json().get("data") or {}
        assert payload.get("failures") == []
        added = tuple(payload.get("added") or ())
        assert manufacturing_no in added
        expect(
            self.root.locator(".ant-table-tbody tr.ant-table-row").filter(
                has_text=manufacturing_no
            ).first
        ).to_be_visible()
        return added

    def select_carrier(self, carrier: str) -> None:
        field = self.root.locator(".ant-form-item").filter(has_text="配送業者").first
        select = field.locator(".ant-select")
        select.click()
        dropdown = self.page.locator(".ant-select-dropdown:visible").last
        pattern = re.compile(rf"{re.escape(carrier)}$")
        option = find_dropdown_option(dropdown, pattern=pattern)
        with self.page.expect_response(
            lambda response: re.search(r"/prop/shipment/\d+$", response.url) is not None
            and response.request.method == "PUT",
            timeout=20_000,
        ) as response_info:
            option.click(force=True)  # AntD 4 动画, 绕过 stable 检测
        assert response_info.value.ok
        expect(field).to_contain_text(carrier)

    def carrier_text(self) -> str:
        field = self.root.locator(".ant-form-item").filter(has_text="配送業者").first
        return field.locator(".ant-select-selection-item").inner_text().strip()

    def expect_products(self, numbers: tuple[str, ...]) -> None:
        for number in numbers:
            expect(
                self.root.locator(".ant-table-tbody tr.ant-table-row").filter(
                    has_text=number
                ).first
            ).to_be_visible()

    def close(self) -> None:
        self.root.locator(".ant-drawer-footer button").filter(
            has_text=re.compile(r"閉じる")
        ).first.click()
        expect(self.root).to_be_hidden(timeout=self.settings.default_timeout_ms)

