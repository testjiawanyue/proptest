"""客户管理页面对象。"""

from __future__ import annotations

import re

from playwright.sync_api import Locator, Page, expect

from common.antd import button_with_text, fill_form_item, form_item, row_by_text, visible_modal
from data.factory import CustomerData
from pages.base import BasePage


class CustomerPage(BasePage):
    PATH = "/customer"

    SAVE_BUTTON = re.compile(r"^保\s*存$")
    DETAIL_URL = re.compile(r"/customer/detail/\d+")

    def open(self) -> "CustomerPage":
        self.goto()
        expect(self.page.get_by_role("heading", name="顧客管理", exact=True)).to_be_visible()
        button_with_text(self.page, "＋ 会社を追加")
        return self

    def open_create_company(self) -> Locator:
        button_with_text(self.page, "＋ 会社を追加").click()
        modal = visible_modal(self.page)
        expect(modal.locator(".ant-modal-title")).to_have_text("会社を追加")
        return modal

    def create_company(self, data: CustomerData) -> str:
        modal = self.open_create_company()
        fill_form_item(modal, "会社名", data.company_name)
        expect(form_item(modal, "標準の顧客区分").locator(".ant-select-selector")).to_contain_text(
            "直販"
        )
        fill_form_item(modal, "資料の保存先", data.storage_path)
        self.add_address(
            modal,
            postal=data.postal,
            address1=data.address1,
            address2=data.address2,
        )
        self.add_contact(
            modal,
            name=data.contact_name,
            title=data.title,
            phone=data.phone,
            fax=data.fax,
            email=data.email,
            note=data.note,
        )
        self.save_modal(modal)
        expect(self.page).to_have_url(self.DETAIL_URL)
        expect(self.company_card()).to_contain_text(data.company_name)
        return self.page.url.rstrip("/").split("/")[-1]

    def add_address(self, modal: Locator, *, postal: str, address1: str, address2: str = "") -> Locator:
        button_with_text(modal, "＋ 住所を追加").click()
        block = modal.locator(".address-block").last
        block.locator("input[id$='_postalCode']").fill(postal)
        block.locator("input[id$='_addressLine1']").fill(address1)
        if address2:
            block.locator(".ant-form-item").filter(has_text="住所2（任意）").locator("input").fill(
                address2
            )
        return block

    def add_contact(
        self,
        modal: Locator,
        *,
        name: str,
        title: str = "",
        phone: str = "",
        fax: str = "",
        email: str = "",
        note: str = "",
    ) -> Locator:
        address = modal.locator(".address-block").last
        button_with_text(address, "＋ 担当者を追加").click()
        contact = address.locator(".contact-block").last
        contact.locator("input[id$='_contactName']").fill(name)
        optional_fields = {
            "役職（任意）": title,
            "電話番号": phone,
            "ファックス（任意）": fax,
            "メール（任意）": email,
            "備考（任意）": note,
        }
        for label, value in optional_fields.items():
            if value:
                contact.locator(".ant-form-item").filter(has_text=label).locator("input").fill(value)
        return contact

    def save_modal(self, modal: Locator) -> None:
        modal.get_by_role("button", name=self.SAVE_BUTTON).click()
        expect(modal).to_be_hidden(timeout=self.settings.default_timeout_ms)

    def company_card(self) -> Locator:
        card = self.page.locator(".subject-card").first
        expect(card).to_be_visible()
        return card

    def branch_card(self, branch_name: str) -> Locator:
        card = self.page.locator(".subject-card").filter(has_text=branch_name).last
        expect(card).to_be_visible()
        return card

    def field_value(self, card: Locator, label: str) -> str:
        labels = [text.strip() for text in card.locator(".subject-descriptions th").all_inner_texts()]
        values = [text.strip() for text in card.locator(".subject-descriptions td").all_inner_texts()]
        fields = dict(zip(labels, values))
        return fields[label]

    def customer_no(self, card: Locator) -> str:
        return self.field_value(card, "顧客番号")

    def open_add_branch(self) -> Locator:
        button_with_text(self.page, "＋ 支店／現場を追加").click()
        modal = visible_modal(self.page)
        expect(modal.locator(".ant-modal-title")).to_have_text("支店／現場を追加")
        return modal

    def create_branch(self, data: CustomerData) -> None:
        modal = self.open_add_branch()
        owner = form_item(modal, "所属会社").locator("input")
        expect(owner).to_have_value(data.company_name)
        expect(owner).to_be_disabled()
        fill_form_item(modal, "支店／現場名", data.branch_name)
        self.add_address(
            modal,
            postal=data.branch_postal,
            address1=data.branch_address1,
        )
        self.add_contact(
            modal,
            name=data.branch_contact_name,
            phone=data.branch_phone,
        )
        self.save_modal(modal)
        expect(self.page).to_have_url(self.DETAIL_URL)
        expect(self.branch_card(data.branch_name)).to_be_visible()

    def open_edit_company(self) -> Locator:
        button_with_text(self.page, "会社情報を編集").click()
        modal = visible_modal(self.page)
        expect(modal.locator(".ant-modal-title")).to_have_text("会社情報を編集")
        return modal

    def rename_company(self, new_name: str) -> None:
        modal = self.open_edit_company()
        fill_form_item(modal, "会社名", new_name)
        self.save_modal(modal)
        expect(self.page).to_have_url(self.DETAIL_URL)
        expect(self.company_card()).to_contain_text(new_name)

    def back_to_list(self) -> "CustomerPage":
        self.page.goto(self.url, wait_until="domcontentloaded")
        expect(self.page.get_by_role("heading", name="顧客管理", exact=True)).to_be_visible()
        return self

    def search(self, keyword: str) -> Locator:
        search_input = self.page.locator(
            "input[placeholder='顧客番号・会社名・支店／現場名']"
        )
        search_input.fill(keyword)
        button_with_text(self.page, "検索").click()
        row = row_by_text(self.page, keyword)
        expect(row).to_be_visible()
        return row

    def row(self, name: str) -> Locator:
        return row_by_text(self.page, name)

    def expanded_branch_row(self, branch_name: str) -> Locator:
        row = self.row(branch_name)
        expect(row).to_be_visible()
        return row
