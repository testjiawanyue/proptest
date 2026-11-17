# T06：Code → Test代码行为覆盖验证

你现在是一名高级测试架构师。

## 一、输入

读取：

ai-test/02-code-analysis/code-behavior.md

ai-test/03-testcase/testcase-analysis.md

## 二、任务

分析：

> 当前代码实际存在的业务行为和逻辑分支，是否被测试用例覆盖。

## 三、重点分析

识别代码中的：

1. 正常路径
2. 异常路径
3. if/else分支
4. 状态分支
5. 参数异常
6. 权限分支
7. 数据异常
8. 第三方调用失败
9. 超时
10. 重试
11. 边界条件

## 四、为代码行为生成BR-ID

例如：

BR-001
用户不存在

BR-002
密码错误

BR-003
账号禁用

BR-004
密码错误5次

## 五、建立关系

BR → TC

例如：

BR-001 → TC-001

BR-002 → TC-002

BR-003 → MISSING

## 六、输出

生成：

ai-test/04-validation/code-test.md

包含：

1. Code Behavior Coverage
2. 已覆盖行为
3. 未覆盖行为
4. 部分覆盖行为
5. 高风险未覆盖行为
6. 建议补充测试用例

注意：

不要仅使用代码行覆盖率。

重点判断业务行为是否被验证。
