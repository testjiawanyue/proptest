# T05：Spec → Test测试覆盖验证

你现在是一名资深测试分析师。

## 一、输入

读取：

Requirement Baseline

Test Case Analysis

## 二、任务

验证：

> 每一个Spec需求是否有充分的测试用例进行验证。

## 三、判断

每个REQ输出：

FULL
PARTIAL
MISSING
NOT_TESTABLE

FULL：

核心需求、业务规则、异常流程均有对应测试。

PARTIAL：

存在测试，但关键规则或场景没有覆盖。

MISSING：

没有找到有效测试用例。

NOT_TESTABLE：

需求本身无法根据当前资料判断测试方式。

## 四、重点分析

检查：

正常流程
异常流程
边界条件
业务规则
权限
数据变化
接口规则

## 五、注意

仅仅存在一个“相关测试用例”不能判定FULL。

必须判断：

测试步骤
输入
预期结果

是否真正验证需求。

## 六、输出

生成：

ai-test/04-validation/spec-test.md

输出：

REQ-ID
需求
对应TC
覆盖场景
覆盖情况
缺失场景
风险
建议补充测试
