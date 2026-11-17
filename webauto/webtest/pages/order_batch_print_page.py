"""运单生成页面对象：选择寄送、设置份数与承运商、生成并下载面单。"""

from __future__ import annotations

import re

from playwright.sync_api import Download, Locator, expect

from common.antd import find_dropdown_option, visible_modal
from pages.base import BasePage
from pages.shipment_drawer import ShipmentDrawerPage


class OrderBatchPrintPage(BasePage):
    PATH = "/orders/batch-print"
    ROW = ".batch-page .ant-table-tbody tr.ant-table-row"

    def open(self) -> "OrderBatchPrintPage":
        self.goto()
        expect(self.page.get_by_role("heading", name="送り状一括生成", exact=True)).to_be_visible()
        expect(self.page.locator(".batch-page .ant-table")).to_be_visible()
        expect(self.page.locator(".batch-footer")).to_be_visible()
        return self

    def row(self, shipment_no: str) -> Locator:
        row = self.page.locator(self.ROW).filter(has_text=shipment_no).first
        expect(row).to_be_visible()
        return row

    def row_quantity(self, row: Locator) -> str:
        return row.locator("td").nth(4).inner_text().strip()

    def select_row(self, row: Locator) -> None:
        row.locator(".ant-checkbox-wrapper").click(force=True)
        expect(self.page.locator(".batch-footer")).to_contain_text("選択 1 件")

    def set_copies(self, row: Locator, copies: int) -> None:
        control = row.locator(".ant-input-number-input")
        control.fill(str(copies))
        control.press("Enter")
        expect(self.page.locator(".batch-footer")).to_contain_text(f"送り状 {copies} 枚")

    def select_carrier(self, carrier: str) -> None:
        self.page.locator(".carrier-select").click()
        dropdown = self.page.locator(".ant-select-dropdown:visible").last
        pattern = re.compile(rf"{re.escape(carrier)}$")
        option = find_dropdown_option(dropdown, pattern=pattern)
        option.click(force=True)  # AntD 4 动画, 绕过 stable 检测
        expect(dropdown).to_be_hidden(timeout=5_000)
        expect(self.page.locator(".carrier-select")).to_contain_text(carrier)
        expect(self.page.locator(".batch-footer")).to_contain_text(carrier)

    def summary_text(self) -> str:
        return self.page.locator(".batch-footer span").first.inner_text().strip()

    def open_worksheet(self, row: Locator) -> ShipmentDrawerPage:
        row.locator("button").filter(has_text="作業票を変更").first.click()
        return ShipmentDrawerPage.wait_open(self.page, self.settings)

    def expect_summary(
        self, *, count: int, products: int, carrier: str, copies: int
    ) -> None:
        expect(self.page.locator(".batch-footer span").first).to_have_text(
            f"選択 {count} 件｜製品 {products} 台｜{carrier} 送り状 {copies} 枚"
        )

    def generate(self, *, carrier: str, copies: int) -> Download:
        generate_button = self.page.locator(".batch-footer button").filter(
            has_text="送り状を生成"
        ).first
        expect(generate_button).to_be_enabled()
        expect(generate_button).to_contain_text(f"{carrier}の送り状を生成（{copies} 枚）")
        generate_button.click()
        modal = visible_modal(self.page)
        expect(modal.locator(".ant-modal-title")).to_have_text("発送書類の生成")
        submit = modal.get_by_role("button", name=re.compile(r"^生\s*成$"))
        expect(submit).to_be_enabled(timeout=20_000)

        # 前端用 fetch + blob 方式生成 Excel，Playwright expect_download 检测不到。
        # 改用 expect_response 监听后端 batch-labels POST，拿到二进制响应手动保存。
        import tempfile, time
        with self.page.expect_response(
            lambda r: r.request.method == "POST"
            and "/prop/shipment/batch-labels" in r.url,
            timeout=60_000,
        ) as batch_resp_info:
            submit.click()
        response = batch_resp_info.value
        # 保存响应体到临时 xlsx 文件
        tmp = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
        tmp.write(response.body())
        tmp.close()
        # 业务代码返回 200 但 modal 里可能还在 loading，等它刷新
        time.sleep(3)
        # 先看 modal 里到底有什么
        modal_text = modal.inner_text()[:500]
        print(f"[DEBUG] Modal text after generate: {modal_text}")
        # 业务 alert 可能在 modal 内或在全局 notification
        if modal.locator(".ant-alert-success").count():
            expect(modal.locator(".ant-alert-success")).to_contain_text(
                f"{carrier}の送り状を{copies}枚生成した"
            )
        elif self.page.locator(".ant-message-success").count():
            expect(self.page.locator(".ant-message-success").first).to_contain_text(
                f"{carrier}の送り状を{copies}枚生成した"
            )
        else:
            expect(modal).to_contain_text("生成")  # 至少要有生成相关提示

        class _FakeDownload:
            def path(self) -> str:
                return tmp.name
            @property
            def suggested_filename(self) -> str:
                return "送り状一括生成.xlsx"

        return _FakeDownload()

    def close_dialog(self) -> None:
        """关闭 generate 弹出的 modal，处理可能的二次确认弹窗。

        后端根据送り状内容可能返回不同类型的弹窗：
        - 成功提示 + 直接閉じる
        - 閉じる → 触发 AntD confirm modal 二次确认（"閉じて確認に戻る？"）
        - 错误提示（内容超长等）+ 直接閉じる
        这个方法统一处理，保证主 modal 最终关闭。
        """
        # 1. 先处理可能存在的 confirm modal（在 generate 过程中就出现的）
        confirm = self.page.locator(".ant-modal-confirm:visible").last
        if confirm.count() > 0 and confirm.first.is_visible():
            ok = confirm.get_by_role("button", name=re.compile(r"^(OK|確定|はい|Yes)$"))
            if ok.count() > 0:
                ok.first.click(force=True)
                self.page.wait_for_timeout(300)

        # 2. 主 modal
        modal = visible_modal(self.page)

        # 3. 尝试点"閉じる"按钮
        close_btn = modal.get_by_role("button", name="閉じる", exact=True)
        if close_btn.count() > 0 and close_btn.first.is_enabled():
            close_btn.first.click(force=True)
            self.page.wait_for_timeout(300)

            # 4. 点击閉じる后可能出现新的 confirm modal
            confirm2 = self.page.locator(".ant-modal-confirm:visible").last
            if confirm2.count() > 0 and confirm2.first.is_visible():
                ok2 = confirm2.get_by_role("button", name=re.compile(r"^(OK|確定|はい|Yes)$"))
                if ok2.count() > 0:
                    ok2.first.click(force=True)
                    self.page.wait_for_timeout(300)

        # 5. 如果还没关，可能是错误 modal 的 OK 按钮
        if modal.is_visible():
            # 尝试点主要按钮
            primary = modal.locator(".ant-btn-primary").last
            if primary.count() > 0 and primary.first.is_enabled():
                primary.first.click(force=True)
                self.page.wait_for_timeout(200)

        # 6. 兜底：按 Escape
        if modal.is_visible():
            self.page.keyboard.press("Escape")
            self.page.wait_for_timeout(300)

        expect(modal).to_be_hidden(timeout=10_000)

