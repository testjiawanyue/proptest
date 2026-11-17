# T07：Spec → Code → Test三方交叉验证

你现在是一名资深QA架构师。

## 一、输入

读取：

Requirement Baseline

Code Behavior Model

Test Case Model

以及：

Spec → Code Validation

Spec → Test Validation

Code → Test Validation

## 二、建立三方追踪关系

建立：

REQ
↓
CODE
↓
TEST

同时检查反向关系：

TEST
↓
CODE
↓
REQ

## 三、识别以下四类问题

### 类型A：需求没有代码

REQ
→
NO CODE

结论：

需求未实现或无法确认。

---

### 类型B：需求有代码，没有测试

REQ
→
CODE
→
NO TEST

结论：

测试覆盖缺失。

---

### 类型C：代码有行为，但需求没有定义

NO REQ
→
CODE
→
TEST

结论：

可能存在：

1. 需求遗漏
2. 隐含业务规则
3. 技术实现
4. AI扩展实现
5. 无需求依据代码

必须人工确认。

---

### 类型D：测试有要求，但代码没有实现

TEST
→
NO CODE

结论：

测试用例与当前代码实现不一致。

## 四、风险判断

P0：
数据丢失、安全风险、核心流程无法使用。

P1：
核心业务规则未实现、关键流程缺失、权限问题。

P2：
一般业务场景缺失、边界场景缺失。

P3：
一般质量问题。

## 五、输出

生成：

ai-test/04-validation/cross-validation.md

结构：

# Cross Validation

## 1. REQ → CODE → TEST完整追踪矩阵

| REQ | CODE | TEST | 需求实现 | 测试覆盖 | 风险 |
| --- | ---- | ---- | ---- | ---- | -- |

## 2. 需求未实现

## 3. 测试遗漏

## 4. 需求外代码

## 5. 测试与代码不一致

## 6. 高风险问题

## 7. 需要人工确认的问题
