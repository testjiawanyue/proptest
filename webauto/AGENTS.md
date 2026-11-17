# Web 自动化测试维护规则

本目录及子目录内的测试代码必须遵守以下规则。

## 中文测试点规范

1. 每个 `test_*.py` 文件必须定义常量 `TEST_POINT`，使用中文准确描述被测功能点。
2. 每个测试函数必须通过 `pytest.mark.parametrize` 设置中文用例 ID，确保 `pytest -vv` 和 VSCode Test Explorer 中可以直接看到测试点。
3. 每个测试函数必须包含中文 docstring，说明测试点、验证内容和预期结果。
4. 测试步骤统一使用 `# 步骤 N：中文说明`，关键校验统一使用 `# 断言 N：中文说明`。
5. 页面对象和业务流程的中文说明用于解释测试目的；匹配页面元素的日文原文（例如 `部品マスタを追加`、`同じ値が登録済`）不得为了中文化而修改。
6. 新增、删除或调整测试点时，必须同步更新 `README.md` 中的主流程说明和测试点名称。
7. 必须保留 `pytest.ini` 中的 `disable_test_id_escaping_and_forfeit_all_rights_to_community_support = True`，避免中文用例 ID 被输出为 `\uXXXX`。
8. VSCode 终端和测试面板应使用 UTF-8；不得删除 `webtest/.vscode/settings.json` 中的 `PYTHONUTF8` 与 `PYTHONIOENCODING` 配置。
9. 每个测试必须保留 `@allure.epic`、`@allure.feature`、`@allure.story`、`@allure.title(TEST_POINT)` 和 `allure.severity`，确保 Allure 报告使用中文功能分类和标题。

## 用例模板

```python
TEST_POINT = "功能模块：动作 A → 动作 B → 动作 C"


@pytest.mark.parametrize("_test_point", [pytest.param(TEST_POINT, id=TEST_POINT)])
def test_feature_flow(logged_in_page, settings, _test_point: str) -> None:
    """测试点：验证某功能的完整业务流程。

    验证内容：
    1. 首步操作的页面反馈和数据结果。
    2. 关键业务规则及异常拦截结果。
    3. 最终状态是否符合预期。
    """
    # 步骤 1：中文说明当前正在测试的功能。
    ...
    # 断言 1：中文说明期望结果。
    ...
```

运行用例时必须使用 `-vv`，中文测试点会显示在用例节点名称中：

```powershell
py -3.11 -m pytest -m mainflow -vv --base-url=http://localhost:8090
```
