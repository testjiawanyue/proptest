"""订单详情页面对象：读取订单进度并打开寄送抽屉。"""

from __future__ import annotations

import re

from playwright.sync_api import expect

from pages.base import BasePage
from pages.shipment_drawer import ShipmentDrawerPage


class OrderDetailPage(BasePage):
    def open(self, order_id: str) -> "OrderDetailPage":
        self.page.goto(
            self.settings.url(f"/orders/{order_id}"),
            wait_until="domcontentloaded",
        )
        return self.wait_ready()

    def wait_ready(self) -> "OrderDetailPage":
        expect(self.page.locator(".order-detail-page")).to_be_visible()
        expect(self.page.locator(".order-detail-page .detail-head h2")).to_be_visible()
        return self

    def order_no(self) -> str:
        return self.page.locator(".detail-page .prop-descriptions .mono").first.inner_text().strip()

    def header_tags(self) -> list[str]:
        return [text.strip() for text in self.page.locator(".detail-head .ant-tag").all_inner_texts()]

    def metrics_text(self) -> str:
        return self.page.locator(".order-detail-page .metrics").inner_text().strip()

    def open_shipment_drawer(self) -> ShipmentDrawerPage:
        button = self.page.locator("button").filter(has_text=re.compile(r"出\s*荷")).first
        expect(button).to_be_visible()
        button.click()
        return ShipmentDrawerPage.wait_open(self.page, self.settings)

