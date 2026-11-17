"""客户管理主流程自动化测试。"""

from __future__ import annotations

import re

import allure
import pytest
from playwright.sync_api import expect

from common.antd import wait_for_feedback
from data.factory import customer_data
from pages.customer_page import CustomerPage


TEST_POINT = "客户管理：新建公司含地址联系人 → 新建支店 → 编辑公司 → 列表查询按层级展开"


@pytest.mark.mainflow
@pytest.mark.destructive
@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
@allure.epic("客户管理")
@allure.feature("客户主档")
@allure.story("公司、支店、地址与联系人主流程")
@allure.title(TEST_POINT)
@allure.severity(allure.severity_level.CRITICAL)
def test_customer_company_branch_edit_and_search(
    logged_in_page,
    settings,
    _test_point: str,
) -> None:
    """测试点：验证公司及支店从新建、详情展示、编辑到列表查询的完整链路。

    验证内容：
    1. 新建公司时连续录入地址与联系人，保存后跳转详情并自动生成客户编号。
    2. 在公司详情中新建支店，所属公司只读且支店拥有独立地址与联系人。
    3. 编辑公司名称后详情刷新，但客户编号保持不变。
    4. 返回列表按名称查询时命中公司并自动展开其支店行，支店读取公司客户区分。
    """
    page = CustomerPage(logged_in_page, settings)
    data = customer_data()

    # 步骤 1：进入客户列表并新建公司，连续录入地址与联系人后保存。
    page.open()
    company_id = page.create_company(data)
    # 断言 1：保存成功并跳转公司详情，客户编号符合 C+数字且地址邮编已归一化展示。
    wait_for_feedback(logged_in_page, "顧客情報の保存が完了。")
    assert company_id.isdigit()
    company_card = page.company_card()
    company_no = page.customer_no(company_card)
    assert re.fullmatch(r"C\d+", company_no)
    expect(company_card).to_contain_text("〒104-0033")
    expect(company_card).to_contain_text(data.address1)
    expect(company_card).to_contain_text(data.address2)
    expect(company_card).to_contain_text(data.contact_name)
    expect(company_card).to_contain_text(data.phone)

    # 步骤 2：在公司详情中新建支店，填写独立地址与联系人后保存。
    page.create_branch(data)
    # 断言 2：保存后仍停留在公司详情，支店卡出现且编号符合规则。
    wait_for_feedback(logged_in_page, "顧客情報の保存が完了。")
    branch_card = page.branch_card(data.branch_name)
    branch_no = page.customer_no(branch_card)
    assert re.fullmatch(r"C\d+", branch_no)
    assert branch_no != company_no
    expect(branch_card).to_contain_text("〒104-0034")
    expect(branch_card).to_contain_text(data.branch_address1)
    expect(branch_card).to_contain_text(data.branch_contact_name)

    # 步骤 3：编辑公司名称，验证详情刷新且客户编号终身不变。
    updated_name = f"{data.company_name}-UPD"
    page.rename_company(updated_name)
    # 断言 3：保存提示出现，公司名称已更新，客户编号与新建时一致。
    wait_for_feedback(logged_in_page, "顧客情報の保存が完了。")
    company_card = page.company_card()
    expect(company_card).to_contain_text(updated_name)
    assert page.customer_no(company_card) == company_no

    # 步骤 4：返回列表按更新后的公司名称查询。
    page.back_to_list()
    company_row = page.search(updated_name)
    # 断言 4：公司行命中并自动展开支店行，支店行读取所属公司的客户区分。
    expect(company_row).to_contain_text(updated_name)
    expect(company_row).to_contain_text("直販")
    branch_row = page.expanded_branch_row(data.branch_name)
    expect(branch_row).to_contain_text(branch_no)
    expect(branch_row).to_contain_text("直販")
