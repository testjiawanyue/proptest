"""订单列表主流程自动化测试。"""

from __future__ import annotations

import allure
import pytest

from business.order_flow import OrderFlow
from business.production_flow import ProductionFlow
from data.factory import customer_data, order_data, production_chain_data
from pages.order_detail_page import OrderDetailPage
from pages.order_list_page import OrderListPage


TEST_POINT = "订单列表：创建客户与订单 → 建立寄送准备 → 关键词查询 → 制造番号查询 → 详情核对"


@pytest.mark.mainflow
@pytest.mark.destructive
@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
@allure.epic("订单管理")
@allure.feature("订单列表")
@allure.story("订单创建、查询与详情")
@allure.title(TEST_POINT)
@allure.severity(allure.severity_level.CRITICAL)
def test_order_list_queries_created_order(
    logged_in_page,
    settings,
    _test_point: str,
) -> None:
    """测试点：验证订单创建后可被列表按关键词与制造番号检索并进入详情。

    验证内容：
    1. 通过生产主流程准备已质检产品，并以该产品数量创建订单和寄送准备。
    2. 关键词查询同时命中客户订单号与自动生成的订单管理番号。
    3. 寄送准备中的制造番号可反查订单，不要求先登记寄出。
    4. 列表字段与详情进度一致，寄送准备阶段有效出荷数仍为 0。
    """
    data = production_chain_data()
    customer = customer_data()
    order = order_data()
    flow = OrderFlow(logged_in_page, settings)

    # 步骤 1：准备一条已质检生产链，订单数量由可寄送产品台数计算。
    ProductionFlow(logged_in_page, settings).prepare_inspected_products(data)
    quantity = len(data.eligible_products)
    # 断言 1：生产链至少有一台可寄送产品，避免空订单掩盖后续问题。
    assert quantity > 0

    # 步骤 2：通过 UI 新建客户与订单，并建立待打印寄送准备。
    record = flow.create_order(customer, order, quantity=quantity)
    record = flow.prepare_shipment(record, data)
    # 断言 2：订单号、寄送号与产品编号均由系统生成且与生产计划关联。
    assert record.order_no
    assert record.shipment_no.startswith("SH")
    assert len(record.product_numbers) == quantity

    page = OrderListPage(logged_in_page, settings).open()
    # 步骤 3：以客户订单号查询，核对列表行展示的订单、客户、内容与进度。
    page.search_keyword(order.customer_order_no, expected_total=1)
    row = page.row_by_order_no(record.order_no)
    # 断言 3：列表行与刚创建的订单、客户和产品计划完全对应。
    assert page.total_count() == 1
    assert page.row_count() == 1
    assert page.order_no(row) == record.order_no
    assert page.customer_order_no(row) == order.customer_order_no
    assert page.ordering_party(row) == customer.company_name
    assert "注文先と同じ" in page.recipient_text(row)
    assert record.product_name in page.requirement(row)
    assert order.color_note in page.requirement(row)
    assert f"×{quantity}" in page.requirement(row)
    assert page.total_quantity(row) == f"合計 {quantity} 台"
    assert page.type_text(row) == "販売"
    assert "受注" in page.dates_text(row)
    assert "発送予定" in page.dates_text(row)
    assert page.progress_text(row) == "未出荷"
    assert page.fulfilled_text(row) == f"0 / {quantity} 台"

    # 步骤 4：改用系统生成的订单管理番号查询同一订单。
    page.search_keyword(record.order_no, expected_total=1)
    # 断言 4：订单管理番号同样返回唯一结果，且订单号未被改写。
    assert page.order_no(page.row_by_order_no(record.order_no)) == record.order_no

    # 步骤 5：重置筛选后，用寄送准备中已关联的制造番号反查订单。
    page.reset()
    assert page.total_count() > 1
    page.search_manufacturing_no(record.product_numbers[0], expected_total=1)
    # 断言 5：准备中的寄送产品可以命中订单，说明制造番号覆盖未寄出关联。
    assert page.order_no(page.row_by_order_no(record.order_no)) == record.order_no

    # 步骤 6：从列表进入详情，核对订单编号与有效出荷数。
    page.reset()
    page.search_keyword(order.customer_order_no, expected_total=1)
    page.open_detail(page.row_by_order_no(record.order_no))
    detail = OrderDetailPage(logged_in_page, settings).wait_ready()
    # 断言 6：详情展示同一订单，寄送准备尚未登记寄出。
    assert detail.order_no() == record.order_no
    assert "未出荷" in detail.header_tags()
    metrics = detail.metrics_text()
    assert f"{quantity}台" in metrics
    assert "0台" in metrics

