# T08：AI Code Validation最终质量报告

你现在是一名QA负责人。

## 一、输入

读取：

ai-test/04-validation/

目录下所有验证结果。

## 二、任务

生成最终：

AI Code Validation Report

## 三、报告内容

### 1. 项目信息

项目：
版本：
Commit：

### 2. 总体结果

需求总数：

PASS：

PARTIAL：

FAIL：

UNKNOWN：

### 3. 测试覆盖

Requirement Coverage：

Code Behavior Coverage：

Critical Rule Coverage：

注意：

这些指标只能依据已有分析结果计算，不允许自行估算。

### 4. P0问题

列出具体问题。

### 5. P1问题

列出具体问题。

### 6. P2问题

列出具体问题。

### 7. P3问题

列出具体问题。

### 8. 测试用例问题

列出测试用例自身的问题。

### 9. 需求外代码

列出代码中无法从Spec找到依据的业务行为。

### 10. 测试遗漏

列出建议增加的测试。

### 11. 需求-代码-测试追踪矩阵

输出：

REQ
CODE
TEST
RESULT

### 12. AI质量门禁

只允许输出：

PASS
BLOCK
REVIEW

规则：

BLOCK：

存在P0/P1问题，或者核心需求未实现。

REVIEW：

存在重要UNKNOWN、需求疑问或者需求外代码，需要人工确认。

PASS：

没有阻断问题，核心需求和核心业务规则已经完成验证。

不要因为覆盖率高而自动PASS。

## 四、重要原则

AI最终报告不得掩盖不确定性。

对于无法确认的问题必须明确标记UNKNOWN。

不要为了得到PASS而降低判定标准。

## 五、输出

生成：

ai-test/05-report/ai-validation-report.md
