"""部件资料主流程自动化测试。"""

from __future__ import annotations

import pytest
import allure
from playwright.sync_api import expect

from common.antd import wait_for_feedback
from data.factory import part_profile_data
from pages.part_profile_page import PartProfilePage


TEST_POINT = "部件资料：新增 → 编辑 → 停用 → 启用"


@pytest.mark.mainflow
@pytest.mark.destructive
@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
@allure.epic("基础设置")
@allure.feature("部件资料")
@allure.story("部件资料生命周期")
@allure.title(TEST_POINT)
@allure.severity(allure.severity_level.CRITICAL)
def test_part_profile_create_edit_disable_enable(
    logged_in_page,
    settings,
    _test_point: str,
) -> None:
    """测试点：验证部件资料新增、编辑、停用、启用的完整生命周期。

    验证内容：
    1. 新增部件资料后，列表展示新记录且状态为“有効”。
    2. 编辑规格和厂商后，列表立即展示更新后的内容。
    3. 停用后状态变为“無効”，再次启用后恢复为“有効”。
    """
    page = PartProfilePage(logged_in_page, settings)
    data = part_profile_data()

    # 步骤 1：进入“部品マスタ”页面并新增一条唯一部件资料。
    page.open()
    page.add(
        part_name=data.part_name,
        specification=data.specification,
        manufacturer=data.manufacturer,
        number_prefix=data.number_prefix,
    )
    # 断言 1：页面提示新增成功，列表可查到记录且初始状态有效。
    wait_for_feedback(logged_in_page, "部品マスタを追加しました。")
    row = page.row(data.part_name)
    expect(row).to_contain_text(data.specification)
    expect(row.locator(".ant-tag").last).to_have_text("有効")

    # 步骤 2：修改规格与厂商，验证编辑结果在列表中回显。
    updated_spec = f"{data.specification}-UPDATED"
    updated_maker = f"{data.manufacturer}-UPDATED"
    page.edit(
        data.part_name,
        specification=updated_spec,
        manufacturer=updated_maker,
    )
    wait_for_feedback(logged_in_page, "部品マスタを更新しました。")
    row = page.row(data.part_name)
    expect(row).to_contain_text(updated_spec)
    expect(row).to_contain_text(updated_maker)

    # 步骤 3：停用部件资料，验证状态由“有効”切换为“無効”。
    page.change_status(data.part_name, "無効")
    wait_for_feedback(logged_in_page, "無効にしました。")
    expect(page.row(data.part_name).locator(".ant-tag").last).to_have_text("無効")

    # 步骤 4：重新启用部件资料，验证状态恢复为“有効”。
    page.change_status(data.part_name, "有効")
    wait_for_feedback(logged_in_page, "有効にしました。")
    expect(page.row(data.part_name).locator(".ant-tag").last).to_have_text("有効")
