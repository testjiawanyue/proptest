"""部件组装主流程自动化测试。"""

from __future__ import annotations

import allure
import pytest
from playwright.sync_api import expect

from business.production_flow import ProductionFlow
from data.factory import production_chain_data
from pages.production_assembly_page import ProductionAssemblyPage


TEST_POINT = "部件组装：设置默认部件 → 范围检索 → 连续录入 → 保存回显"


@pytest.mark.mainflow
@pytest.mark.destructive
@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
@allure.epic("产品生产")
@allure.feature("部件组装")
@allure.story("部件绑定与组装完整性")
@allure.title(TEST_POINT)
@allure.severity(allure.severity_level.CRITICAL)
def test_production_assembly_binds_parts(
    logged_in_page,
    settings,
    _test_point: str,
) -> None:
    """测试点：验证部件组装从筛选、默认资料选择到逐格保存的完整链路。

    验证内容：
    1. 衣体入库后按编号范围检索出计划内全部产品。
    2. 设置气囊、传感器、固件、发生器默认资料。
    3. 按计划录入部件，完成计数等于计划中的齐全台数。
    4. 重新检索后已保存编号仍然存在，证明绑定已持久化。
    """
    data = production_chain_data()
    ProductionFlow(logged_in_page, settings).intake_products(data)
    page = ProductionAssemblyPage(logged_in_page, settings).open()

    # 步骤 1：选择衣体资料并检索本次计划内产品。
    page.select_jacket(data.master.jacket_prefix)
    page.set_defaults(
        airbag=data.master.airbag_profile,
        sensor=data.master.sensor_profile,
        firmware=data.master.firmware,
        inflator=data.master.inflator_profile,
    )
    page.search_range(data.number_start, data.number_end)
    # 断言 1：组装清单显示计划内全部产品。
    assert logged_in_page.locator(page.ROW).count() == len(data.products)

    # 步骤 2：按计划逐台录入部件。
    for product in data.products:
        for part in product.parts:
            page.save_cell(product.number, part.column, part.suffix)
    # 断言 2：完成计数与计划中的齐全台数一致。
    assert page.complete_count() == (data.complete_required_count, len(data.products))

    # 步骤 3：确认所有产品均无行内保存错误。
    for number in data.numbers:
        expect(page.row(number).locator(".cell-error")).to_have_count(0)

    # 步骤 4：重新进入组装页并检索，验证保存结果已持久化。
    page.open()
    page.select_jacket(data.master.jacket_prefix)
    page.select_airbag(data.master.airbag_profile)
    page.search_range(data.number_start, data.number_end)
    # 断言 4：计划内已录入部件的编号均持久化，未录入列保持为空。
    for product in data.products:
        for part in product.parts:
            assert part.suffix in page.cell_value(product.number, part.column)
        missing_columns = {0, 1, 2, 3} - {part.column for part in product.parts}
        for column in missing_columns:
            assert page.cell_value(product.number, column) == ""
