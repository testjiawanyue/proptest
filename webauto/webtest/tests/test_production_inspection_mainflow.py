"""质检工作台主流程自动化测试。"""

from __future__ import annotations

import allure
import pytest
from playwright.sync_api import expect

from business.production_flow import ProductionFlow
from common.antd import wait_for_feedback
from data.factory import production_chain_data
from pages.production_inspection_page import ProductionInspectionPage


TEST_POINT = "质检工作台：范围筛选 → 最低构成过滤 → 批量确认 → 清单移除"


@pytest.mark.mainflow
@pytest.mark.destructive
@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
@allure.epic("产品生产")
@allure.feature("质检工作台")
@allure.story("质检通过登记与最低构成校验")
@allure.title(TEST_POINT)
@allure.severity(allure.severity_level.CRITICAL)
def test_production_inspection_confirms_eligible_products(
    logged_in_page,
    settings,
    _test_point: str,
) -> None:
    """测试点：验证待质检筛选、最低构成过滤和批量质检通过的完整链路。

    验证内容：
    1. 计划中组装齐全的产品进入待质检清单，不完整产品不出现。
    2. 齐全产品状态为“検査登録可”，可批量勾选。
    3. 确认后成功台数等于勾选台数，产品从清单移除。
    4. 再次按已质检编号单件筛选时不再进入可质检清单。
    """
    data = production_chain_data()
    flow = ProductionFlow(logged_in_page, settings)
    flow.intake_products(data)
    flow.assemble_products(data)
    page = ProductionInspectionPage(logged_in_page, settings).open()
    eligible = data.eligible_products
    ineligible = data.ineligible_products

    # 步骤 1：选择前缀并按本次编号范围筛选。
    page.select_prefix(data.master.jacket_prefix)
    page.filter_range(data.number_start, data.number_end)
    # 断言 1：只有计划中满足最低构成的产品进入清单。
    assert page.row_count() == len(eligible)
    for product in eligible:
        expect(page.row(product.number)).to_be_visible()
        assert page.status(product.number) == "検査登録可"
    for product in ineligible:
        expect(
            logged_in_page.locator(".list-panel .ant-table-row").filter(has_text=product.number)
        ).to_have_count(0)

    # 步骤 2：勾选全部可质检产品。
    for product in eligible:
        page.select_row(product.number)
    # 断言 2：页面显示已选台数与可质检计划一致。
    assert page.selected_count() == len(eligible)

    # 步骤 3：确认质检通过。
    page.confirm()
    # 断言 3：成功台数与勾选台数一致，清单移除全部成功产品。
    wait_for_feedback(logged_in_page, f"成功 {len(eligible)}台、失敗 0台")
    for product in eligible:
        expect(
            logged_in_page.locator(".list-panel .ant-table-row").filter(has_text=product.number)
        ).to_have_count(0)

    # 步骤 4：按已质检编号单件筛选，验证不再可登记。
    checked_number = eligible[0].number
    page.filter_single_expect_alert(checked_number[len(data.master.jacket_prefix) :])
    # 断言 4：出现不可登记提示，原清单不会被错误替换为可质检行。
    assert page.alert_text()
    expect(
        logged_in_page.locator(".list-panel .ant-table-row").filter(has_text=checked_number)
    ).to_have_count(0)
