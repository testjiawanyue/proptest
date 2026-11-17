"""Ant Design Vue 4 helpers shared by page objects and assertions."""

from __future__ import annotations

import re
from collections.abc import Iterable

from playwright.sync_api import Locator, Page, expect


TABLE_ROW = ".ant-table-tbody tr.ant-table-row"
MODAL = ".ant-modal"
CONFIRM_MODAL = ".ant-modal-confirm"
MESSAGE = ".ant-message-notice-content"
NOTIFICATION = ".ant-notification-notice"


def visible_modal(page: Page) -> Locator:
    return page.locator(f"{MODAL}:visible").last


def visible_confirm(page: Page) -> Locator:
    modal = page.locator(f"{CONFIRM_MODAL}:visible").last
    expect(modal).to_be_visible()
    return modal


def row_by_text(page: Page, text: str, scope: Locator | None = None) -> Locator:
    root = scope or page
    row = root.locator(TABLE_ROW).filter(has_text=text).first
    expect(row).to_be_visible()
    return row


def row_count(page: Page, text: str, scope: Locator | None = None) -> int:
    root = scope or page
    return root.locator(TABLE_ROW).filter(has_text=text).count()


def form_item(modal: Locator, label: str) -> Locator:
    item = modal.locator(".ant-form-item").filter(has_text=label).first
    expect(item).to_be_visible()
    return item


def fill_form_item(
    modal: Locator,
    label: str,
    value: str,
    *,
    textarea: bool = False,
) -> None:
    control = form_item(modal, label).locator("textarea" if textarea else "input").first
    control.fill(value)


def disable_virtual_scroll(page: Page) -> None:
    """禁用 AntD Select rc-virtual-list 虚拟滚动，强制渲染所有选项 DOM。

    rc-virtual-list 默认只渲染可见区域（~10 条）的选项 DOM，排在后面的选项
    不在 DOM 里导致 Playwright locator 找不到。把 holder 的 max-height 和
    height 设为 0（或一个很大的值）可以让它一次性渲染全部选项。
    """
    page.evaluate(
        """
        () => {
            const drops = document.querySelectorAll('.ant-select-dropdown');
            const dd = drops[drops.length - 1];
            if (!dd) return;
            const holders = dd.querySelectorAll('.rc-virtual-list-holder');
            const inners = dd.querySelectorAll('.rc-virtual-list-holder-inner');
            const containers = dd.querySelectorAll('.rc-virtual-list');
            for (const h of holders) {
                h.style.maxHeight = 'none';
                h.style.height = 'auto';
                h.style.overflow = 'visible';
            }
            for (const c of containers) {
                c.style.position = 'static';
                c.style.height = 'auto';
            }
        }
        """
    )
    page.wait_for_timeout(100)


def scroll_dropdown_to_bottom(page: Page) -> None:
    """AntD 4 Select 使用 rc-virtual-list 虚拟滚动，只渲染可见区域的 DOM 元素。

    当后端选项数量超过可见区域容量（约 10 条）时，排在后面的选项
    （如 seed data 的 PTG）不在 DOM 里，Playwright 的 locator 找不到。
    这个 helper 强制滚动 virtual list 到底部，让所有选项都渲染出来。
    """
    page.evaluate(
        """
        () => {
            const drops = document.querySelectorAll('.ant-select-dropdown');
            const dd = drops[drops.length - 1];
            if (!dd) return;
            const holders = dd.querySelectorAll('.rc-virtual-list-holder');
            for (const h of holders) {
                if (h.scrollHeight > h.clientHeight) {
                    h.scrollTop = h.scrollHeight;
                }
            }
        }
        """
    )
    page.wait_for_timeout(150)  # 等滚动触发 DOM 重渲染


def _scroll_virtual_list(page: Page, delta: float) -> float:
    """滚动 rc-virtual-list holder，返回新的 scrollTop。"""
    result = page.evaluate(
        """
        (delta) => {
            const drops = document.querySelectorAll('.ant-select-dropdown');
            const dd = drops[drops.length - 1];
            if (!dd) return { scrolled: false, holder: null };
            const holder = dd.querySelector('.rc-virtual-list-holder');
            if (!holder) return { scrolled: false, holder: null };
            const old = holder.scrollTop;
            holder.scrollTop = Math.min(holder.scrollTop + delta, holder.scrollHeight);
            return {
                scrolled: holder.scrollTop !== old,
                holder: {
                    scrollTop: holder.scrollTop,
                    scrollHeight: holder.scrollHeight,
                    clientHeight: holder.clientHeight,
                },
            };
        }
        """,
        delta,
    )
    page.wait_for_timeout(100)
    return result


def find_dropdown_option(
    dropdown: Locator,
    *,
    text: str | None = None,
    pattern: re.Pattern | None = None,
    exact: bool = False,
) -> Locator:
    """在 dropdown 中找到目标选项，分段滚动穿透 rc-virtual-list 虚拟渲染。

    AntD 4 Select 的 rc-virtual-list 只渲染可见区域（~10 条）的选项 DOM。
    当目标不在初始可见区域时 Playwright locator 找不到。
    这个 helper 的策略：
    1) 先尝试在当前可见区域直接 filter
    2) 找不到 → 分段滚动 virtual list，每滚一段 filter 一次，直到找到或滚完
    3) 最坏情况：滚完了还没找到 → expect 抛错给出明确信息

    Args:
        text: 直接文本匹配。默认 exact=False（contains），因为 AntD dropdown
            选项格式常是 ``"prefix｜name"``（如 ``"QN｜气囊 A型"``），
            调用方通常只传 name 部分，需要 contains 匹配。
        pattern: 正则匹配，优先级高于 text。
        exact: text 模式下是否精确匹配（default False，即 contains）。
    """
    if text is not None:
        target = dropdown.get_by_text(text, exact=exact)
    elif pattern is not None:
        target = dropdown.locator(".ant-select-item-option").filter(has_text=pattern).first
    else:
        raise ValueError("must provide either text or pattern")

    # 1) 直接找
    if target.count() > 0 and target.first.is_visible():
        return target.first

    page = dropdown.page

    # 2) 分段滚动扫描
    holder_info = page.evaluate(
        """
        () => {
            const drops = document.querySelectorAll('.ant-select-dropdown');
            const dd = drops[drops.length - 1];
            if (!dd) return null;
            const holder = dd.querySelector('.rc-virtual-list-holder');
            if (!holder) return null;
            return {
                scrollTop: holder.scrollTop,
                scrollHeight: holder.scrollHeight,
                clientHeight: holder.clientHeight,
            };
        }
        """
    )

    # 没有 virtual list 就只滚底试一次
    if holder_info is None or holder_info["scrollHeight"] <= holder_info["clientHeight"]:
        scroll_dropdown_to_bottom(page)
        if text is not None:
            target = dropdown.get_by_text(text, exact=exact)
        else:
            target = dropdown.locator(".ant-select-item-option").filter(has_text=pattern).first
        expect(target).to_be_visible(timeout=3_000)
        return target

    # 分段滚动：每次滚 clientHeight 的 80%，直到找到或滚到底
    step = max(holder_info["clientHeight"] * 0.8, 50)
    steps = max(int((holder_info["scrollHeight"] - holder_info["scrollTop"]) / step) + 2, 30)

    for _ in range(steps):
        info = _scroll_virtual_list(page, step)
        if not info.get("scrolled"):
            break
        if text is not None:
            target = dropdown.get_by_text(text, exact=exact)
        else:
            target = dropdown.locator(".ant-select-item-option").filter(has_text=pattern).first
        if target.count() > 0:
            try:
                expect(target.first).to_be_visible(timeout=1_000)
                return target.first
            except Exception:
                continue

    # 做最后一次 expect，让 Playwright 给出明确的 not found 错误
    if text is not None:
        target = dropdown.get_by_text(text, exact=exact)
    else:
        target = dropdown.locator(".ant-select-item-option").filter(has_text=pattern).first

    expect(target).to_be_visible(timeout=3_000)
    return target


def select_form_option(page: Page, select: Locator, option: str) -> None:
    select.click()
    dropdown = page.locator(".ant-select-dropdown:visible").last
    expect(dropdown).to_be_visible()
    target = find_dropdown_option(dropdown, text=option, exact=True)  # part-profile 页面选项是纯日文名，精确匹配
    target.click(force=True)  # AntD 4 动画, 绕过 stable 检测
    # 等 dropdown 关闭，确保下一个 select 的下拉不会被残留动画影响
    expect(dropdown).to_be_hidden(timeout=5_000)


def message_texts(page: Page) -> list[str]:
    return page.locator(f"{MESSAGE}:visible").all_inner_texts()


def notification_texts(page: Page) -> list[str]:
    return page.locator(f"{NOTIFICATION}:visible").all_inner_texts()


def feedback_texts(page: Page) -> list[str]:
    return [*message_texts(page), *notification_texts(page)]


def wait_for_feedback(page: Page, text: str, timeout: int = 10_000) -> str:
    feedback = page.locator(f"{MESSAGE}:visible, {NOTIFICATION}:visible").filter(
        has_text=re.compile(re.escape(text))
    ).first
    expect(feedback).to_be_visible(timeout=timeout)
    return feedback.inner_text()


def click_confirm(page: Page) -> None:
    modal = visible_confirm(page)
    primary = modal.locator(".ant-modal-confirm-btns .ant-btn-primary").first
    if primary.count():
        primary.click()
        return
    modal.get_by_role("button", name=re.compile(r"^確\s*認$")).click()


def click_button(locator: Locator, label_pattern: str | re.Pattern[str]) -> None:
    pattern = re.compile(label_pattern) if isinstance(label_pattern, str) else label_pattern
    locator.get_by_role("button", name=pattern).first.click()


def button_with_text(scope: Page | Locator, text: str) -> Locator:
    """Locate an AntD button by its visible text, ignoring icon content."""
    button = scope.locator("button").filter(has_text=text).first
    expect(button).to_be_visible()
    return button


def tag_text(row: Locator) -> str:
    tags = row.locator(".ant-tag")
    expect(tags.last).to_be_visible()
    return tags.last.inner_text().strip()


def contains_any(texts: Iterable[str], pattern: str | re.Pattern[str]) -> bool:
    compiled = re.compile(pattern) if isinstance(pattern, str) else pattern
    return any(compiled.search(text) for text in texts)
