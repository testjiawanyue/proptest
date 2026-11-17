"""衣体入库主流程自动化测试。"""

from __future__ import annotations

import allure
import pytest
from playwright.sync_api import expect

from common.antd import wait_for_feedback
from data.factory import production_chain_data
from pages.production_assembly_page import ProductionAssemblyPage
from pages.production_intake_page import ProductionIntakePage


TEST_POINT = "衣体入库：单个加入 → 重复拦截 → 连续范围补齐 → 确认入库"


@pytest.mark.mainflow
@pytest.mark.destructive
@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
@allure.epic("产品生产")
@allure.feature("衣体入库")
@allure.story("衣体批量入库与产品成立")
@allure.title(TEST_POINT)
@allure.severity(allure.severity_level.CRITICAL)
def test_production_intake_creates_products(
    logged_in_page,
    settings,
    _test_point: str,
) -> None:
    """测试点：验证单个加入、候选去重、范围补齐和确认入库的完整链路。

    验证内容：
    1. 选择衣体资料后单个加入，候选状态为“入庫待ち”。
    2. 同一编号再次加入时被前端候选清单拦截。
    3. 连续范围包含已存在候选时只补齐新编号，最终候选数与计划一致。
    4. 确认入库后候选清空，组装页可以检索到本次全部产品。
    """
    data = production_chain_data()
    page = ProductionIntakePage(logged_in_page, settings).open()

    # 步骤 1：选择衣体资料并单个加入第一台。
    page.select_jacket(data.master.jacket_prefix)
    page.add_single(data.number_start)
    # 断言 1：候选清单出现第一台，状态为入库待确认。
    expect(page.candidate_row(data.numbers[0])).to_be_visible()
    expect(page.candidate_row(data.numbers[0]).locator(".ant-tag")).to_have_text("入庫待ち")

    # 步骤 2：再次加入同一编号，验证候选清单去重。
    duplicate_input = logged_in_page.locator("#intake-number")
    duplicate_input.fill(data.number_start)
    duplicate_input.press("Enter")
    # 断言 2：出现重复提示，候选数量仍为 1。
    wait_for_feedback(logged_in_page, "この番号はすでに今回の入庫候補に含まれています。")
    assert page.candidate_count() == 1

    # 步骤 3：连续范围覆盖计划内全部产品，已存在的第一台不重复加入。
    page.add_range(data.number_start, data.number_end)
    page.wait_for_candidate_count(len(data.products))
    # 断言 3：计划内产品均进入候选，状态均为入库待确认。
    for number in data.numbers:
        expect(page.candidate_row(number)).to_be_visible()
        assert page.candidate_status(number) == "入庫待ち"

    # 步骤 4：确认全部入库。
    page.confirm_all()
    # 断言 4：提示成功件数与计划一致，候选清单清空。
    wait_for_feedback(
        logged_in_page,
        f"成功 {len(data.products)}件、スキップ 0件、失敗 0件",
    )
    page.wait_for_candidate_count(0)

    # 步骤 5：进入组装页检索同一范围，验证产品已成立。
    assembly = ProductionAssemblyPage(logged_in_page, settings).open()
    assembly.select_jacket(data.master.jacket_prefix)
    assembly.select_airbag(data.master.airbag_profile)
    assembly.search_range(data.number_start, data.number_end)
    # 断言 5：组装清单显示本次全部产品。
    assert logged_in_page.locator(assembly.ROW).count() == len(data.products)
    for number in data.numbers:
        expect(assembly.row(number)).to_be_visible()
