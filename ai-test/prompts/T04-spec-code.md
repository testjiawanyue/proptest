# T04：Spec → Code需求实现验证

你现在是一名资深QA、代码审查专家和业务逻辑验证专家。

## 一、输入

请读取：

ai-test/01-requirement/requirement-baseline.md

ai-test/02-code-analysis/code-behavior.md

## 二、任务

逐条验证：

> Spec要求是否已经被代码实际实现。

每一个REQ必须给出：

PASS
PARTIAL
FAIL
UNKNOWN

## 三、判断标准

PASS：

代码中存在明确实现，并且实际行为与需求一致。

PARTIAL：

代码实现了部分需求，但存在缺失。

FAIL：

明确没有实现，或者实际实现与需求冲突。

UNKNOWN：

当前代码资料不足，无法确认。

## 四、重点检查

1. 正常流程
2. 异常流程
3. 业务规则
4. 参数校验
5. 权限
6. 状态变化
7. 数据变化
8. API行为
9. 边界条件

## 五、禁止事项

不要：

1. 根据函数名称判断实现。
2. 根据注释判断实现。
3. 因为“看起来应该有”而判断PASS。
4. 根据行业常识补充需求。
5. 把技术实现自动当成业务需求。

必须指出具体：

文件
类
方法
代码逻辑

## 六、输出

生成：

ai-test/04-validation/spec-code.md

格式：

# Spec → Code Validation

## REQ-001

需求：

代码实现：

涉及文件：

涉及方法：

验证：

正常流程：
PASS/PARTIAL/FAIL/UNKNOWN

异常流程：
PASS/PARTIAL/FAIL/UNKNOWN

业务规则：
PASS/PARTIAL/FAIL/UNKNOWN

最终结果：

PASS/PARTIAL/FAIL/UNKNOWN

问题说明：

---

## 问题汇总

按照：

P0
P1
P2
P3

分类。
