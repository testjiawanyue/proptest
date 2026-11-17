"""运单生成（送り状一括生成）主流程自动化测试。"""

from __future__ import annotations

from pathlib import Path

import allure
import pytest

from business.order_flow import OrderFlow
from business.production_flow import ProductionFlow
from data.factory import customer_data, order_data, production_chain_data
from pages.order_batch_print_page import OrderBatchPrintPage
from pages.order_detail_page import OrderDetailPage


TEST_POINT = "运单生成：订单寄送准备 → 选择寄送 → 设置份数 → 切换承运商 → 生成下载 → 未登记寄出复核"


@pytest.mark.mainflow
@pytest.mark.destructive
@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
@allure.epic("订单管理")
@allure.feature("运单生成")
@allure.story("批量面单生成、下载与业务结果复核")
@allure.title(TEST_POINT)
@allure.severity(allure.severity_level.CRITICAL)
def test_order_batch_print_generates_labels_without_shipping(
    logged_in_page,
    settings,
    _test_point: str,
) -> None:
    """测试点：验证待寄送订单可批量生成面单，且生成不登记寄出。

    验证内容：
    1. 订单寄送准备中的产品、台数与页面汇总一致。
    2. 选择寄送并修改面单张数后，汇总按张数累加。
    3. 切换承运商只影响生成结果，不筛掉表格中的寄送。
    4. 生成后自动下载 Excel，成功提示明确说明未确定寄出。
    5. 批量生成只改面单文件承运商，寄存档承运商不变；订单有效出荷数仍为 0、状态仍未出荷。
    """
    data = production_chain_data()
    customer = customer_data()
    order = order_data()
    flow = OrderFlow(logged_in_page, settings)

    # 步骤 1：准备已质检产品，创建订单并建立寄送准备，初始承运商为ヤマト運輸。
    ProductionFlow(logged_in_page, settings).prepare_inspected_products(data)
    quantity = len(data.eligible_products)
    record = flow.create_order(customer, order, quantity=quantity)
    record = flow.prepare_shipment(record, data, carrier="ヤマト運輸")
    # 断言 1：寄送准备包含计划内全部可寄送产品，且订单尚未登记寄出。
    assert len(record.product_numbers) == quantity

    page = OrderBatchPrintPage(logged_in_page, settings).open()
    # 步骤 2：按寄送号定位本次寄送，核对来源、产品与台数。
    row = page.row(record.shipment_no)
    row_text = row.inner_text()
    # 断言 2：待生成行来自本次订单，产品编号与台数正确。
    assert record.order_no in row_text
    for number in record.product_numbers:
        assert number in row_text
    assert page.row_quantity(row) == str(quantity)

    # 步骤 3：勾选寄送并设置每笔 2 张面单，核对汇总。
    page.select_row(row)
    page.set_copies(row, 2)
    page.expect_summary(count=1, products=quantity, carrier="ヤマト運輸", copies=2)
    # 断言 3：未选择承运商前，默认仍为ヤマト運輸且张数按份数累加。

    # 步骤 4：切换为佐川急便，确认表格行未被筛除且汇总承运商同步变化。
    page.select_carrier("佐川急便")
    page.expect_summary(count=1, products=quantity, carrier="佐川急便", copies=2)
    # 断言 4：承运商切换只影响生成参数，已选寄送仍为同一行。
    assert record.shipment_no in page.row(record.shipment_no).inner_text()

    # 步骤 5：生成面单并捕获自动下载。
    download = page.generate(carrier="佐川急便", copies=2)
    file_path = download.path()
    # 断言 5：下载文件为 Excel，且文件内容非空。
    assert download.suggested_filename.lower().endswith(".xlsx")
    assert file_path is not None
    assert Path(file_path).stat().st_size > 0
    page.close_dialog()

    # 步骤 6：关闭弹窗后刷新列表，从同一行的“作業票を変更”打开原寄送。
    row = page.row(record.shipment_no)
    drawer = page.open_worksheet(row)
    # 断言 6：寄送仍为同一笔，产品未变化，承运商已被批量生成改写为佐川急便。
    assert drawer.shipment_no() == record.shipment_no
    assert drawer.carrier_text() == "ヤマト運輸"
    drawer.expect_products(record.product_numbers)
    drawer.close()

    # 步骤 7：回到订单详情，确认有效出荷数仍为 0，生成面单未登记寄出。
    detail = OrderDetailPage(logged_in_page, settings).open(record.order_id)
    # 断言 7：订单仍未出荷，批量生成只写文件版本与承运商。
    assert "未出荷" in detail.header_tags()
    assert "0台" in detail.metrics_text()
