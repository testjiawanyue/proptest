# UI 自动化测试框架

基于 `pytest + Playwright`（POM 分层）的 Web UI 测试框架骨架，与具体业务系统解耦。

当前目录保留通用框架能力，并补充了十一条可运行的高价值主流程。历史测试用例与运行产物已清理。

## 目录结构

```text
webtest/
├── conftest.py          # 全局 fixture：context/page、失败截图、录屏、Allure 附件
├── pytest.ini           # pytest 配置与通用标记
├── requirements.txt     # Python 依赖
├── case/                # 模块契约卡（低 Token 用例设计入口）
├── common/              # 配置、日志、软断言、UI 组件助手等通用能力
│   ├── antd.py          # Ant Design Vue 表格/表单/弹窗/消息的通用封装
│   └── arco.py          # 其他组件库的通用封装（保留）
├── pages/               # 页面对象层
│   ├── base.py          # BasePage：通用导航与基础操作
│   ├── login_page.py    # 登录页
│   ├── part_profile_page.py
│   ├── base_data_page.py
│   ├── work_option_page.py
│   ├── customer_page.py
│   ├── production_intake_page.py
│   ├── production_assembly_page.py
│   ├── production_inspection_page.py
│   ├── product_list_page.py
│   ├── part_tracing_page.py
│   ├── order_list_page.py
│   ├── order_form_page.py
│   ├── order_detail_page.py
│   ├── shipment_drawer.py
│   └── order_batch_print_page.py
├── business/            # 业务流程层
│   ├── base_flow.py     # BaseFlow
│   ├── auth_flow.py     # 登录流程
│   ├── production_flow.py # 产品生产与产品管理前置数据流
│   └── order_flow.py    # 客户、订单与寄送准备数据流
├── data/                # 测试数据层
│   └── factory.py       # AUTO-WA-* 唯一测试数据
├── tests/               # 测试用例层
│   ├── test_example.py  # 离线框架自检
│   ├── test_part_profile_mainflow.py
│   ├── test_basedata_mainflow.py
│   ├── test_work_option_mainflow.py
│   ├── test_customer_mainflow.py
│   ├── test_production_intake_mainflow.py
│   ├── test_production_assembly_mainflow.py
│   ├── test_production_inspection_mainflow.py
│   ├── test_product_list_mainflow.py
│   ├── test_part_tracing_mainflow.py
│   ├── test_order_list_mainflow.py
│   └── test_order_batch_print_mainflow.py
└── reports/             # 运行产物（videos/screenshots/allure-results）
```

## 快速开始

```powershell
cd E:\proptest\webauto\webtest
pip install -r requirements.txt
py -3.11 -m playwright install chromium

# 框架自检（不依赖被测系统）
py -3.11 -m pytest -s -v tests/test_example.py
```

指定被测系统地址：

```powershell
py -3.11 -m pytest -s -v --base-url=http://localhost:8090
# 或
$env:WEBTEST_BASE_URL = "http://localhost:8090"
py -3.11 -m pytest -s -v
```

默认登录账号为 `admin` / `admin123`，可通过 `WEBTEST_USERNAME`、`WEBTEST_PASSWORD` 覆盖。

生产主数据可通过环境变量覆盖，未设置时使用当前环境默认值：

```powershell
$env:WEBTEST_PROD_JACKET_PREFIX = "PTG"
$env:WEBTEST_PROD_AIRBAG_PROFILE = "气囊 A型"
$env:WEBTEST_PROD_SENSOR_PROFILE = "传感器 A型"
$env:WEBTEST_PROD_FIRMWARE = "85cm"
$env:WEBTEST_PROD_INFLATOR_PROFILE = "充气发生器 A型"
```

## 高价值主流程

```powershell
cd E:\proptest\webauto\webtest

# 十一条主流程全量运行
py -3.11 -m pytest -m mainflow -vv --base-url=http://localhost:8090

# 单独运行
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_part_profile_mainflow.py
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_basedata_mainflow.py
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_work_option_mainflow.py
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_customer_mainflow.py
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_production_intake_mainflow.py
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_production_assembly_mainflow.py
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_production_inspection_mainflow.py
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_product_list_mainflow.py
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_part_tracing_mainflow.py
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_order_list_mainflow.py
py -3.11 -m pytest -vv --base-url=http://localhost:8090 tests/test_order_batch_print_mainflow.py
```

- 部件资料：新建 -> 编辑 -> 停用 -> 启用。
- 基础数据：新增传感器固件版本 -> 重复值拦截 -> 停用 -> 启用。
- 作业选项：新增处置内容 -> 重复值拦截 -> 停用 -> 启用。
- 客户管理：新建公司含地址联系人 -> 新建支店 -> 编辑公司 -> 列表查询按层级展开。
- 衣体入库：单个加入 -> 重复拦截 -> 连续范围补齐 -> 确认入库。
- 部件组装：设置默认部件 -> 范围检索 -> 连续录入 -> 保存回显。
- 质检工作台：范围筛选 -> 最低构成过滤 -> 批量确认 -> 清单移除。
- 产品列表：默认已质检范围查询 -> 在制单件查询 -> 部件反查 -> 详情返回 -> 删除阻断。
- 部件追溯：类型筛选 -> 组装部件编号查询 -> 安装中归属筛选 -> 详情履历 -> 删除阻断 -> 重置。
- 订单列表：UI 新建客户与订单 -> 建立寄送准备 -> 客户订单号与订单管理番号查询 -> 制造番号反查 -> 详情进度核对。
- 运单生成：寄送准备 -> 勾选寄送 -> 设置面单张数 -> 切换承运商 -> 生成并下载 Excel -> 复核承运商改写且未登记寄出。
- 主数据用例使用 `AUTO-WA-` 前缀；生产用例使用“衣体前缀 + 唯一数字”，测试不自动清理这些业务数据。

## 中文测试点规范

每个用例必须定义中文 `TEST_POINT`，并通过参数化 ID 显示在测试运行结果中。测试函数还需包含中文 docstring、`# 步骤 N：` 和 `# 断言 N：` 注释，明确当前验证的功能点及预期结果。

```python
TEST_POINT = "功能模块：动作 A → 动作 B → 动作 C"


@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
def test_feature_flow(logged_in_page, settings, _test_point: str) -> None:
    """测试点：验证某功能的完整业务流程。"""
    # 步骤 1：中文说明当前操作。
    ...
    # 断言 1：中文说明期望结果。
    ...
```

使用 `pytest -vv` 运行时，输出中的用例节点会显示类似：

```text
test_part_profile_create_edit_disable_enable[部件资料：新增 → 编辑 → 停用 → 启用]
```

`pytest.ini` 已关闭非 ASCII 用例 ID 转义；在 VSCode 中打开 `E:\proptest\webauto\webtest` 后，`.vscode/settings.json` 会固定使用 Python 3.11、pytest `mainflow` 参数和 UTF-8 输出。

## 编写新用例

1. 在 `pages/` 新建页面对象并继承 `BasePage`，只放定位器和页面动作，不写业务断言。
2. 在 `business/` 组合多个页面对象，封装跨页面业务流程。
3. 在 `data/` 集中维护测试数据或数据工厂。
4. 在 `tests/` 新增 `test_*.py`，通过 `page`、`context`、`settings`、`traced_page` 等 fixture 编排并断言。
5. 需要暴露多个不符合项时，可使用 `common/checks.py` 的软断言收集器，在用例末尾调用 `finish()` 统一报告。
6. 新用例必须遵守根目录 `AGENTS.md` 中的中文测试点、中文步骤注释和中文运行 ID 规范。

## 标记与产物

- `smoke`：核心冒烟场景。
- `mainflow`：高价值业务主流程。
- `destructive`：会改变测试环境数据的场景。
- 用例失败时自动保留整页截图和录屏；安装 `allure-pytest` 后可附加到 Allure 报告。

## 生成并查看 Allure 报告

前置环境：

```powershell
py -3.11 -m pip install -r requirements.txt
allure --version
```

生成静态报告：

```powershell
cd E:\proptest\webauto\webtest
py -3.11 -m pytest -m mainflow -vv --base-url=http://localhost:8090 --alluredir=reports/allure-results --clean-alluredir
allure generate reports/allure-results -o reports/allure-report --clean
```

打开已生成的报告：

```powershell
allure open reports/allure-report
```

也可以直接启动临时报告服务，测试完成后统一查看：

```powershell
allure serve reports/allure-results
```

Allure 报告按“基础设置 -> 部件资料 / 基础数据 / 作业选项”分类，用例标题直接显示中文测试点；失败时截图和录屏会作为附件显示在对应用例中。
