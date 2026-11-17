"""基础数据主流程自动化测试。"""

from __future__ import annotations

import pytest
import allure
from playwright.sync_api import expect

from common.antd import wait_for_feedback
from data.factory import firmware_version_data
from pages.base_data_page import BaseDataPage


TEST_POINT = "基础数据：传感器版本号新增 → 重复值拦截 → 停用 → 启用"


@pytest.mark.mainflow
@pytest.mark.destructive
@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
@allure.epic("基础设置")
@allure.feature("基础数据")
@allure.story("传感器版本号生命周期")
@allure.title(TEST_POINT)
@allure.severity(allure.severity_level.CRITICAL)
def test_firmware_version_add_duplicate_disable_enable(
    logged_in_page,
    settings,
    _test_point: str,
) -> None:
    """测试点：验证传感器版本号新增、重复值拦截、停用、启用的完整流程。

    验证内容：
    1. 新增唯一版本号后，列表展示记录且状态为“有効”。
    2. 再次提交相同值时必须提示“同じ値が登録済”，且不能产生重复记录。
    3. 停用后状态变为“無効”，再次启用后恢复为“有効”。
    """
    page = BaseDataPage(logged_in_page, settings)
    data = firmware_version_data()

    # 步骤 1：切换至“传感器版本号”类型并新增唯一版本号。
    page.open()
    page.select_type("センサのバージョンNo.")
    page.add_value(data.value)
    # 断言 1：新增成功，列表展示该版本号且初始状态有效。
    wait_for_feedback(logged_in_page, "追加しました。")
    row = page.row(data.value)
    expect(row).to_contain_text(data.value)
    expect(row.locator(".ant-tag").last).to_have_text("有効")

    # 步骤 2：再次提交相同版本号，验证重复值被业务规则拦截。
    page.open_add()
    page.fill_new_value(data.value)
    page.save()
    # 断言 2：出现重复值提示，目标值在列表中仍然只有一条。
    wait_for_feedback(logged_in_page, "同じ値が登録済")
    assert page.count(data.value) == 1
    page.cancel_add()

    # 步骤 3：停用版本号，验证状态切换为“無効”。
    page.change_status(data.value, "無効")
    wait_for_feedback(logged_in_page, "無効にしました。")
    expect(page.row(data.value).locator(".ant-tag").last).to_have_text("無効")

    # 步骤 4：重新启用版本号，验证状态恢复为“有効”。
    page.change_status(data.value, "有効")
    wait_for_feedback(logged_in_page, "有効にしました。")
    expect(page.row(data.value).locator(".ant-tag").last).to_have_text("有効")
