"""部件追溯主流程自动化测试。"""

from __future__ import annotations

import re

import allure
import pytest
from playwright.sync_api import expect

from business.production_flow import ProductionFlow
from data.factory import production_chain_data
from pages.part_tracing_page import PartTracingPage
from pages.product_list_page import ProductListPage


TEST_POINT = "部件追溯：类型筛选 → 编号查询 → 归属筛选 → 详情履历 → 删除阻断 → 重置"


@pytest.mark.mainflow
@pytest.mark.destructive
@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
@allure.epic("产品管理")
@allure.feature("部件追溯")
@allure.story("部件个体查询、履历与删除阻断")
@allure.title(TEST_POINT)
@allure.severity(allure.severity_level.CRITICAL)
def test_part_tracing_queries_assembled_part(
    logged_in_page,
    settings,
    _test_point: str,
) -> None:
    """测试点：验证组装产生的部件可在部件追溯中查询、查看履历并阻断删除。

    验证内容：
    1. 从产品列表读取本次组装实际生成的气囊编号，作为追溯查询的唯一键。
    2. 类型、编号、当前归属组合筛选命中同一部件个体。
    3. 详情展示当前资料、当前归属及首次登记、安装履历。
    4. 已绑定部件删除被阻断，重置后清空筛选条件。
    """
    data = production_chain_data()
    ProductionFlow(logged_in_page, settings).prepare_inspected_products(data)
    product = data.eligible_products[0]

    # 步骤 1：从产品列表读取组装后落库的气囊编号，建立模块间数据关联。
    catalog = ProductListPage(logged_in_page, settings).open()
    catalog.search_single(product.number, expected_total=1)
    airbag_no = catalog.airbag_number(catalog.row(product.number))
    # 断言 1：产品列表展示的气囊编号有效，可直接用于部件追溯。
    assert airbag_no not in {"", "-"}

    page = PartTracingPage(logged_in_page, settings).open()
    initial_total = page.total_count()
    # 断言 2：默认查询返回全量部件，且不限于本次测试数据。
    assert initial_total > 1

    # 步骤 2：按部件类型筛选，再以编号精确收窄。
    page.select_type("エアバッグ")
    page.search(airbag_no, expected_total=1)
    # 断言 3：编号命中唯一部件，类型、资料与归属均来自本次生产链。
    row = page.row(airbag_no)
    assert page.part_no(row) == airbag_no
    assert page.type_text(row) == "エアバッグ"
    assert page.profile_text(row) == data.master.airbag_profile
    assert page.owner_text(row) == f"製品 {product.number}"
    registered = page.registered_text(row)
    assert "組立時の登録" in registered
    assert re.search(r"\d{4}-\d{2}-\d{2}", registered)

    # 步骤 3：追加“安装中”归属筛选，验证组合条件保持一致。
    page.select_owner("取付中", expected_total=1)
    # 断言 4：组合筛选后仍为同一部件，未因条件切换丢失数据。
    assert page.row_count() == 1
    assert page.part_no(page.row(airbag_no)) == airbag_no

    # 步骤 4：打开详情，核对基础信息与安装履历。
    page.open_detail(page.row(airbag_no))
    # 断言 5：详情展示当前资料、当前归属、首次登记与安装事件。
    detail = page.detail_text()
    assert airbag_no in detail
    assert data.master.airbag_profile in detail
    assert f"製品 {product.number}" in detail
    assert "初回登録：組立時の登録" in detail
    assert f"部品取付：— → {airbag_no}" in detail
    page.close_detail()

    # 步骤 5：对当前已绑定部件执行删除。
    page.delete_part(page.row(airbag_no))
    # 断言 6：删除被阻断，并提示先解除与当前产品的绑定。
    feedback = page.delete_feedback()
    assert "部品を削除できません" in feedback
    assert f"製品 {product.number}" in feedback
    assert "取り付けられているため削除できない" in feedback
    page.close_confirm()

    # 步骤 6：重置筛选，恢复默认全量列表。
    page.reset()
    # 断言 7：关键词与类型条件被清空，列表恢复全量范围。
    expect(logged_in_page.locator("#part-partNo")).to_have_value("")
    assert "エアバッグ" not in page.filter_text("part-partType")
    assert page.total_count() == initial_total
