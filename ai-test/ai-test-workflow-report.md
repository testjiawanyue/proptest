# ai-test 测试验证体系报告

> 报告日期：2026-10-19（CST）
> 对象：E:\proptest\ai-test 现有测试验证资料
> 目的：整理验证体系的实现流程、各阶段产出、可验证的问题类型与当前执行状态

---

## 1. 体系定位

ai-test 是一套 AI 驱动的三方静态验证体系，围绕 PROP 气囊管理系统 V2.1 建立三条证据链：

    Spec（需求基线）──→ Code（代码实际行为）
         │                    │
         └──────→ Test（测试用例）←──────┘

核心思想：不运行系统、不执行测试，而是分别对需求、代码、测试用例建立三个独立模型，再做两两比对和三方交叉，找出实现缺口、覆盖缺口和不一致。

判定纪律（贯穿全部阶段）：

- 只依据已记录证据判定，不按方法名、注释、行业常识推测。
- 不允许根据 Spec 反推代码已实现，也不允许根据代码反推需求。
- 证据不足一律标记 UNKNOWN / 无法确认，不外推为通过。
- 所有验证均为静态判定，不替代测试执行。

---

## 2. 实现流程（8 个阶段）

流程由 ai-test/prompts/ 下 8 个提示词（T01～T08）定义：

### T01 需求结构化分析
- 提示词：prompts/T01-requirement.md
- 产出：01-requirement/requirement-baseline.md（约 180KB）
- 内容：将 FEAT-00～FEAT-19 共 20 个 Feature 的 Spec 结构化为 REQ-001～REQ-106，每条含正常流程、异常流程、业务规则、数据变化、接口/权限/边界、验收标准，并附需求疑问清单与依赖关系。

### T02 代码业务行为分析
- 提示词：prompts/T02-code-analysis.md
- 产出：02-code-analysis/ 下按模块拆分的 Code Behavior Model
  - masterdata-architecture.md、masterdata-code-behavior.md（基础设置，BR-001～BR-050）
  - customer-code-behavior.md（客户管理，BR-001～BR-079）
- 内容：沿 Controller → Service → Mapper → 数据状态变化的链路记录代码实际行为，重要分支分配 BR-ID。

### T03 测试用例质量分析 + T03.1 定点修复
- 提示词：prompts/T03-testcase-analysis.md
- 产出：
  - 03-testcase/testcase-analysis.md（原始用例 1188 条的分析）
  - 03-testcase/testcase-analysis-repaired.md（修复后用例集）
  - 03-testcase/testcase-repair-log.md（修复日志）
- 内容：检查用例完整性/一致性/可执行性；随后按 Spec Current Truth 定点修复 106 条用例行，原则为最小修改、不增删合并用例。用例最终汇总于 case/outputs/测试用例汇总/测试用例汇总_V5.xlsx（1257 条唯一用例）。

### T04 Spec → Code 验证
- 提示词：prompts/T04-spec-code.md
- 产出（按模块拆分，替代原 spec-code.md 占位文件）：
  - 04-validation/masterdata-spec-code.md（REQ-018～REQ-024）
  - 04-validation/customer-spec-code.md（REQ-009～REQ-017）
- 内容：逐条 REQ 对照代码行为，按正常流程/异常流程/业务规则给出 PASS / PARTIAL / FAIL，并列出涉及文件与方法。

### T05 Spec → Test 覆盖验证
- 提示词：prompts/T05-spec-test.md
- 产出：
  - 04-validation/spec-test.md：REQ-001～REQ-106 全覆盖矩阵，判定 FULL / PARTIAL / MISSING / NOT_TESTABLE
  - 04-validation/spec-test-mainflow-gap.md：主流程缺口专项复核

### T06 Code → Test 行为支撑验证
- 提示词：prompts/T06-code-test.md
- 产出（按模块拆分，替代原 code-test.md 占位文件）：
  - 04-validation/masterdata-code-test-v5.md（基础设置 106 条用例）
  - 04-validation/customer-code-test-v5.md（客户管理 115 条用例）
- 内容：逐条用例对照 BR 证据，判定 支撑 / 部分支撑 / 冲突 / 无法确认。

### T07 三方交叉验证
- 提示词：prompts/T07-cross-validation.md
- 产出：04-validation/cross-validation.md —— 当前为空文件，尚未执行
- 计划识别四类问题：A 需求无代码、B 需求有代码无测试、C 有代码无需求依据、D 测试与代码不一致，并按 P0～P3 分级。

### T08 最终质量报告
- 提示词：prompts/T08-final-report.md
- 产出：05-report/ai-validation-report.md —— 当前为空文件，尚未执行
- 计划输出覆盖率统计、P0～P3 问题清单、REQ→CODE→TEST 追踪矩阵和 AI 质量门禁（PASS / BLOCK / REVIEW）。

### 辅助设施
- ai-test/_work/：约 60 个 Python 脚本和中间数据（cases.json、catalog.json、flagged.txt 等），用于大规模用例的提取、映射、覆盖核对、版本差异比对和报告生成，是 T03/T05 阶段处理上千条用例的工具层。

---

## 3. 已执行状态总览

| 阶段 | 状态 | 覆盖范围 |
|---|---|---|
| T01 需求基线 | 已完成 | REQ-001～REQ-106，20 个 Feature |
| T02 代码行为 | 部分完成 | 基础设置、客户管理两个模块；其余 18 个 Feature 模块未建模型 |
| T03 用例分析+修复 | 已完成 | 1188 条分析，106 行修复，输出 V5（1257 条） |
| T04 Spec→Code | 部分完成 | REQ-009～REQ-024（客户+基础设置） |
| T05 Spec→Test | 已完成 | REQ-001～REQ-106 全覆盖 + 主流程专项复核 |
| T06 Code→Test | 部分完成 | 基础设置 106 条、客户管理 115 条用例 |
| T07 交叉验证 | 未执行 | 空占位文件 |
| T08 最终报告 | 未执行 | 空占位文件 |

---

## 4. 可以验证哪些方面的问题

### 4.1 需求侧问题（Spec 自身）
- 需求歧义与缺口：Spec 未明确、相互矛盾的条目进入「需求疑问清单」。
- 需求依赖关系：跨 Feature 的依赖梳理。
- 用例与需求脱节：T03 识别无对应需求、无 REQ-ID、目的不明确的用例；T03.1 依据 Spec 修正了 106 行用例错误/存疑内容。

### 4.2 实现缺口（Spec → Code）
- 需求未实现或只实现一部分，例如：
  - REQ-009 PARTIAL：历史导入客户沿用原编号缺少导入流程证据。
  - 公司/支店名称唯一性检查在代码中不存在。
- 需求外代码：代码中存在但 Spec 未定义的行为（T07 类型 C，待执行后系统汇总）。

### 4.3 测试覆盖缺口（Spec → Test）
- 106 条 REQ 的覆盖矩阵：FULL 88、PARTIAL 17、MISSING 1。
- 缺口按维度定位：权限场景不足（看板类 REQ-002/005/006/007）、边界值不足（REQ-004）、主流程映射不足（REQ-011/012/094）。
- 主流程专项复核识别出唯一真实主流程缺口：REQ-070 受付工作台操作（缺受付履歴跳转位置恢复与端到端主链路用例）。
- 纠正误判：REQ-032、REQ-095 原报“主流程缺失”经复核为误判。

### 4.4 测试点与代码行为冲突（Code → Test）
- 客户管理 115 条用例：支撑 93（80.9%）、冲突 15（13.0%）、部分支撑 3、无法确认 4。
- 基础设置 106 条用例：支撑 50、部分支撑 27、冲突 6、无法确认 23。
- 典型冲突（用例预期与代码行为相反）：
  - 传感器规格留空可保存（代码实际拒绝）。
  - 同类型部件名称重复保存失败（代码无重复检查）。
  - 被引用资料停用拦截、订单引用删除拦截（代码不检查引用）。
  - 并发编辑“他人已修改”提示（代码只有行锁、无版本比较）。
  - 历史编号独立展示字段（代码只有 customer_no）。
  - 邮箱格式校验（代码不做校验）。
- 用例内部口径冲突：基础数据-011-错误、作业选项-016-错误 标题/测试点与预期结果方向相反。

### 4.5 无法静态确认的风险
- 前端交互行为（弹窗置灰、取消不写数据、浏览器缓存）。
- 登录态、角色授权实际配置、菜单展示。
- 下游模块联动、历史单据展示、引用计数。
- 这些被显式标记为“无法确认”，保留为人工/运行时验证项，不会被静默判过。

---

## 5. 当前体系不能验证的问题

- 运行时行为：全部为静态判定，不执行系统、不跑接口，性能、并发实际表现、第三方真实调用不在范围内。
- 测试执行结果：V5 用例的“测试结果”列为空，体系只判断“代码是否支撑测试点”，不判断“测试是否通过”。
- 非功能需求：除边界/权限的场景覆盖外，无专项性能、安全渗透验证。
- 尚未建模的模块：生产、订单、寄送、受付、作业、报告等 18 个 Feature 尚无 Code Behavior Model，T04/T06 在这些模块无法开展。

---

## 6. 建议的后续动作

1. 补齐 T07 交叉验证与 T08 最终报告：当前 cross-validation.md、ai-validation-report.md 为空，无法得到统一的 REQ→CODE→TEST 追踪矩阵和质量门禁结论。
2. 扩展 T02 代码行为建模到其余 Feature 模块，解除 T04/T06 的模块范围限制。
3. 处理已发现的 15+6 条冲突用例：区分“改代码”与“改用例”两类，逐条闭环。
4. 落实 REQ-070 主流程用例补充（受付履歴跳转位置恢复 + 工作台端到端主链路）。
5. 将“无法确认”项转为运行时验证清单，作为测试执行阶段的输入。

---

## 7. 关键文件索引

| 内容 | 路径 |
|---|---|
| 需求基线 | ai-test/01-requirement/requirement-baseline.md |
| 代码行为模型 | ai-test/02-code-analysis/ |
| 用例分析与修复日志 | ai-test/03-testcase/ |
| Spec→Code 验证 | ai-test/04-validation/masterdata-spec-code.md、customer-spec-code.md |
| Spec→Test 覆盖 | ai-test/04-validation/spec-test.md、spec-test-mainflow-gap.md |
| Code→Test 支撑判定 | ai-test/04-validation/masterdata-code-test-v5.md、customer-code-test-v5.md |
| 流程提示词 | ai-test/prompts/T01～T08 |
| 用例工作簿 | case/outputs/测试用例汇总/测试用例汇总_V5.xlsx |
