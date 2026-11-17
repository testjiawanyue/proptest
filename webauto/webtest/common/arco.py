"""Arco Design Web React 组件的通用 Playwright 封装。

与具体业务无关：表格、下拉、弹窗、全局消息等交互在此统一，
页面页面对象只表达“在哪个区域做什么”，不直接散落 CSS 类名。
"""

from __future__ import annotations

import re
from typing import Iterable

from playwright.sync_api import Locator, Page


# Arco 表格在当前版本中 tbody 不带 arco-table-tbody 类，数据行统一用 tbody .arco-table-tr。
TABLE_ROW = "tbody .arco-table-tr"
TAG = ".arco-tag"
MODAL = ".arco-modal"
MESSAGE = ".arco-message-content"


class DataTable:
    """Arco Table 读取/定位助手。"""

    def __init__(self, page: Page, scope: Locator | None = None):
        self.page = page
        self.scope = scope

    @property
    def host(self) -> Locator:
        return self.scope or self.page.locator("body")

    def rows(self) -> Locator:
        return self.host.locator(TABLE_ROW)

    def row_count(self) -> int:
        return self.rows().count()

    def row(self, first_col_value: str) -> Locator:
        """按首列“值”精确匹配一行，避免子串命中相邻值。"""
        return self.rows().filter(has=self.page.get_by_text(first_col_value, exact=True)).first

    @staticmethod
    def cell_texts(row: Locator) -> list[str]:
        cells = row.locator("td")
        return [cells.nth(i).inner_text().strip().replace("\n", "/") for i in range(cells.count())]

    @staticmethod
    def status_tag(row: Locator) -> Locator:
        return row.locator(TAG).first

    def action_button(self, first_col_value: str, name: str) -> Locator:
        return self.row(first_col_value).get_by_role("button", name=name).first

    def first_column_values(self) -> list[str]:
        values: list[str] = []
        rows = self.rows()
        for i in range(rows.count()):
            cells = rows.nth(i).locator("td")
            if cells.count():
                values.append(cells.nth(0).inner_text().strip())
        return values


class Select:
    """Arco Select 下拉助手（选项通过 Portal 渲染在 body 下）。"""

    def __init__(self, page: Page, view: Locator):
        self.page = page
        self.view = view

    def open(self) -> "Select":
        self.view.click()
        self.page.wait_for_timeout(200)
        return self

    def options(self) -> Locator:
        return self.page.get_by_role("option")

    def option_texts(self) -> list[str]:
        return [opt.inner_text().strip() for opt in self.options().all()]

    def choose(self, label: str) -> None:
        self.open()
        self.page.get_by_role("option", name=label).click()
        self.page.wait_for_timeout(200)

    def close(self) -> None:
        self.page.keyboard.press("Escape")
        self.page.wait_for_timeout(100)


def visible_modal(page: Page) -> Locator:
    return page.locator(MODAL).last


def confirm_modal(page: Page, ok_text: str) -> None:
    """点击 Arco Modal.confirm 的确认按钮，并等待弹窗真正卸载，避免动画遮挡后续操作。"""
    modal = page.locator(MODAL).last
    button = page.get_by_role("button", name=ok_text).first
    button.click()
    try:
        modal.wait_for(state="detached", timeout=5000)
    except Exception:
        # 某些弹窗卸载很快或选择器已失效，退化为固定等待。
        page.wait_for_timeout(300)


def messages(page: Page) -> list[str]:
    return [text.strip() for text in page.locator(MESSAGE).all_inner_texts()]


def descriptions_value(page: Page, label: str, scope: Locator | None = None) -> str | None:
    """读取 Arco Descriptions 中某个 label 对应的 value（无结构化字段时返回 None）。"""
    host = scope or page
    label_locator = host.locator(".arco-descriptions-item-label").filter(has_text=re.compile(rf"^\s*{re.escape(label)}\s*$"))
    if not label_locator.count():
        return None
    value = label_locator.first.locator(
        "xpath=following-sibling::*[contains(@class,'arco-descriptions-item-value')][1]"
    )
    return value.inner_text().strip() if value.count() else None


def first_match(pattern: str, texts: Iterable[str]) -> str | None:
    for text in texts:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return None
