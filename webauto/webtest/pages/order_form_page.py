"""订单创建页面对象：客户选择、商品与数量录入、创建提交。"""

from __future__ import annotations

import re
from typing import Any

from playwright.sync_api import expect

from common.antd import button_with_text, find_dropdown_option, visible_modal, wait_for_feedback
from pages.base import BasePage


class OrderFormPage(BasePage):
    PATH = "/orders/new"

    def open(self) -> "OrderFormPage":
        self.goto()
        expect(self.page.get_by_role("heading", name="注文を作成", exact=True)).to_be_visible()
        expect(self.page.locator("#orderForm_ordering")).to_be_visible()
        return self

    def select_ordering_customer(self, name: str) -> None:
        self.page.locator("#orderForm_ordering button.party-select-card").click()
        modal = visible_modal(self.page)
        expect(modal.locator(".ant-modal-title")).to_have_text("会社・支店／現場を選択")
        keyword = modal.locator("input").first
        keyword.fill(name)
        keyword.press("Enter")
        node = modal.locator(".ant-tree-node-content-wrapper").filter(has_text=name).first
        expect(node).to_be_visible()
        node.click()
        expect(modal.locator(".ant-descriptions").first).to_be_visible()
        confirm = modal.get_by_role("button", name=re.compile(r"^選\s*択"))
        expect(confirm).to_be_enabled()
        confirm.click()
        expect(modal).to_be_hidden()
        expect(self.page.locator("#orderForm_ordering")).to_contain_text(name)

    def expect_delivery_auto_selected(self, address1: str) -> None:
        expect(self.page.locator("#orderForm_deliveryAddress")).to_contain_text(address1)

    def choose_first_product_name(self) -> str:
        select = self.page.locator("#orderForm_productName")
        select.click()
        dropdown = self.page.locator(".ant-select-dropdown:visible").last
        option = find_dropdown_option(dropdown, pattern=re.compile(r".+"))
        name = option.inner_text().strip()
        option.click(force=True)  # AntD 4 动画, 绕过 stable 检测
        expect(dropdown).to_be_hidden(timeout=5_000)
        root = select.locator("xpath=ancestor::div[contains(@class,'ant-select')][1]")
        expect(root).to_contain_text(name)
        return name

    def fill_order(
        self,
        *,
        customer_order_no: str,
        color_note: str,
        quantity: int,
        remark: str = "",
    ) -> None:
        self.page.locator("#orderForm_customerOrderNo").fill(customer_order_no)
        self.page.locator("#orderForm_lines_0_colorNote").fill(color_note)
        self.page.locator("#orderForm_lines_0_quantity").fill(str(quantity))
        if remark:
            self.page.locator("#orderForm_remark").fill(remark)

    def create(self) -> dict[str, Any]:
        with self.page.expect_response(
            lambda response: re.search(r"/prop/order$", response.url) is not None
            and response.request.method == "POST",
            timeout=20_000,
        ) as response_info:
            button_with_text(self.page, "注文を作成").click()
        assert response_info.value.ok
        wait_for_feedback(self.page, "注文を作成した。", timeout=20_000)
        expect(self.page).to_have_url(re.compile(r"/orders/\d+$"))
        data = response_info.value.json().get("data") or {}
        assert data.get("orderId") and data.get("orderNo")
        return data

