"""部件资料页面对象。"""

from __future__ import annotations

import re

from playwright.sync_api import Locator, expect

from common.antd import (
    button_with_text,
    click_confirm,
    fill_form_item,
    form_item,
    row_by_text,
    select_form_option,
    tag_text,
    visible_modal,
)
from pages.base import BasePage


class PartProfilePage(BasePage):
    PATH = "/prop-settings/part-profile"

    def open(self) -> "PartProfilePage":
        self.goto()
        expect(self.page.get_by_role("heading", name="部品マスタ", exact=True)).to_be_visible()
        button_with_text(self.page, "部品マスタを追加")
        return self

    def add(
        self,
        *,
        part_name: str,
        specification: str,
        manufacturer: str,
        number_prefix: str,
    ) -> None:
        button_with_text(self.page, "部品マスタを追加").click()
        modal = visible_modal(self.page)
        expect(modal).to_contain_text("部品マスタを追加")

        select = form_item(modal, "部品種別").locator(".ant-select")
        select_form_option(self.page, select, "ジャケット")
        fill_form_item(modal, "部品名", part_name)
        fill_form_item(modal, "仕様", specification, textarea=True)
        fill_form_item(modal, "メーカー", manufacturer)
        fill_form_item(modal, "番号の接頭辞", number_prefix)
        modal.locator(".ant-modal-footer .ant-btn-primary").click()
        expect(modal).to_be_hidden(timeout=self.settings.default_timeout_ms)

    def edit(self, part_name: str, *, specification: str, manufacturer: str) -> None:
        row_by_text(self.page, part_name).get_by_role(
            "button", name=re.compile(r"^編\s*集$")
        ).click()
        modal = visible_modal(self.page)
        expect(modal).to_contain_text("部品マスタを編集")
        fill_form_item(modal, "仕様", specification, textarea=True)
        fill_form_item(modal, "メーカー", manufacturer)
        modal.locator(".ant-modal-footer .ant-btn-primary").click()
        expect(modal).to_be_hidden(timeout=self.settings.default_timeout_ms)

    def change_status(self, part_name: str, action: str) -> None:
        pattern = re.compile(rf"^{re.escape(action[0])}\s*{re.escape(action[1:])}$")
        button = row_by_text(self.page, part_name).get_by_role("button", name=pattern)
        expect(button).to_be_enabled()
        button.click()
        click_confirm(self.page)

    def row(self, part_name: str) -> Locator:
        return row_by_text(self.page, part_name)

    def status(self, part_name: str) -> str:
        return tag_text(self.row(part_name))
