"""产品列表主流程自动化测试。"""

from __future__ import annotations

import re

import allure
import pytest
from playwright.sync_api import expect

from business.production_flow import ProductionFlow
from data.factory import production_chain_data
from pages.product_list_page import ProductListPage


TEST_POINT = "产品列表：范围查询 → 单件查询 → 部件反查 → 详情返回 → 删除阻断"


@pytest.mark.mainflow
@pytest.mark.destructive
@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
@allure.epic("产品管理")
@allure.feature("产品列表")
@allure.story("产品查询、详情与删除阻断")
@allure.title(TEST_POINT)
@allure.severity(allure.severity_level.CRITICAL)
def test_product_list_queries_chain_data(
    logged_in_page,
    settings,
    _test_point: str,
) -> None:
    """测试点：验证已质检生产链在产品列表中的三种查询、详情与删除阻断。

    验证内容：
    1. 默认按“组立检查完成”范围查询，只出现计划中已完成质检的产品。
    2. 单件查询可看到未完成质检产品的在制阶段和缺失部件。
    3. 部件反查由组装产生的部件编号命中当前绑定产品。
    4. 详情返回恢复查询上下文，已绑定且已质检的产品删除被阻断。
    """
    data = production_chain_data()
    ProductionFlow(logged_in_page, settings).prepare_inspected_products(data)
    page = ProductListPage(logged_in_page, settings).open()
    eligible = data.eligible_products
    ineligible = data.ineligible_products

    # 步骤 1：确认默认生产阶段为“组立检查完成”，按本次编号范围查询。
    assert page.stage_filter_text() == "組立検査済"
    page.search_range(
        prefix=data.master.jacket_prefix,
        start_no=data.number_start,
        end_no=data.number_end,
        expected_total=len(eligible),
    )
    # 断言 1：仅计划中完成质检的产品命中，未完成品不进入默认结果。
    assert page.total_count() == len(eligible)
    assert page.row_count() == len(eligible)
    airbag_numbers: dict[str, str] = {}
    for product in eligible:
        row = page.row(product.number)
        assert page.stage(row) == "組立検査済"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", page.inspection_date(row))
        assert page.first_shipment(row) == "初回出荷待ち"
        assert page.owner(row) == "現在の注文なし"
        assert "注文なし" in page.status(row)
        composition = page.composition(row)
        assert composition["エアバッグ"] not in {"", "-"}
        assert data.master.firmware in composition["センサ"]
        expected_inflators = sum(1 for part in product.parts if part.slot.startswith("inflator"))
        assert len(page.inflator_numbers(row)) == expected_inflators
        airbag_numbers[product.number] = page.airbag_number(row)
    for product in ineligible:
        expect(
            logged_in_page.locator(page.ROW).filter(has_text=product.number)
        ).to_have_count(0)

    # 步骤 2：单件查询未完成质检产品，验证在制阶段与缺失部件。
    incomplete = ineligible[0]
    page.search_single(incomplete.number, expected_total=1)
    # 断言 2：产品留在列表展示，阶段为在制，传感器和发生器显示未安装。
    incomplete_row = page.row(incomplete.number)
    assert page.stage(incomplete_row) == "組立中"
    incomplete_airbag = page.airbag_number(incomplete_row)
    assert incomplete_airbag not in {"", "-"}
    assert page.sensor_number(incomplete_row) == "-"
    assert page.inflator_numbers(incomplete_row) == ()
    assert page.inspection_date(incomplete_row) == "-"

    # 步骤 3：从单件结果进入详情，核对当前部件构成。
    page.open_detail(incomplete_row)
    # 断言 3：详情打开同一制造编号，已安装气囊与未安装部件均正确展示。
    assert page.detail_heading() == incomplete.number
    expect(logged_in_page.locator(".ant-card").filter(has_text="基本情報").first).to_contain_text(
        incomplete.number
    )
    expect(page.detail_part_row("エアバッグ")).to_contain_text(
        incomplete_airbag
    )
    expect(page.detail_part_row("センサ")).to_contain_text("未取付")
    expect(page.detail_part_row("インフレータ1")).to_contain_text("未取付")

    # 步骤 4：返回列表，确认最后成功生效的单件查询上下文被恢复。
    page.back_to_list()
    page.expect_total(1)
    # 断言 4：查询模式仍为单件，制造编号输入保持不变。
    assert logged_in_page.locator("#product-number").input_value() == incomplete.number

    # 步骤 5：使用组装产生的气囊编号执行部件反查。
    checked_product = eligible[0]
    airbag_no = airbag_numbers[checked_product.number]
    page.search_part(airbag_no, expected_total=1)
    # 断言 5：部件反查命中当前绑定产品，并展示该产品的完整组成。
    part_row = page.row(checked_product.number)
    assert page.airbag_number(part_row) == airbag_no
    page.open_detail(part_row)
    assert page.detail_heading() == checked_product.number
    expect(page.detail_part_row("エアバッグ")).to_contain_text(airbag_no)
    page.back_to_list()
    page.expect_total(1)

    # 步骤 6：对已绑定部件且已有质检记录的产品执行删除。
    part_row = page.row(checked_product.number)
    page.delete_product(part_row)
    # 断言 6：删除被阻断，阻断弹窗同时列出部件绑定与质检记录原因。
    feedback = page.delete_feedback()
    assert "検査記録" in feedback
    assert "ジャケット以外の部品" in feedback
    page.close_confirm()
    expect(page.row(checked_product.number)).to_be_visible()
