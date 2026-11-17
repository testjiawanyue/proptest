# PROP 端到端自动探索测试（Playwright + Agent）

阶段 0 工程骨架：三路探针 + 五类 Agent + 护栏 + 任务单 + 报告。

## 目录结构

- `src/probes/` 页面探针（无障碍树/控制台）、网络探针（业务接口采集）、数据探针（MySQL 前后快照）
- `src/actions/` 语义化动作（登录、客户模块示例）
- `src/agents/` Planner / Explorer / Oracle / Reporter + LLM 客户端接口
- `src/guardrails/` 环境指纹校验、危险操作拦截、测试库名校验
- `src/state-graph/` 探索状态图（JSON 持久化，去重与新颖度）
- `charters/` 探索任务单（JSON，按优先级排序执行）
- `scripts/` smoke（登录冒烟）、explore（批量跑任务单）、report（汇总最新批次）、selftest、db-query（通用脚本，位于根目录）
- `scripts/customer/` 客户管理模块验证脚本（含公共工具 `customer-runtime-utils.ts`）
- `scripts/masterdata/` 基础设置模块验证脚本（基础数据/作业选项/部件资料）
- `scripts/order/` 订单管理模块验证脚本
- `scripts/product/` 产品管理模块验证脚本
- `scripts/production/` 产品生产模块验证脚本（含 DB 探针脚本）
- `scripts/debug/` 调试辅助脚本
- `scripts/case-tools/` V5 用例 Excel 处理 Python 工具（一次性/临时脚本）

## 快速开始

1. `npm install`
2. `npx playwright install chromium`
3. 复制 `.env.example` 为 `.env`，填写测试环境地址、账号、测试库信息
4. `npm run smoke` 验证登录 + 三路探针可用
5. `npm run explore` 按优先级执行 `charters/` 下全部任务单
6. 查看 `reports/` 下的批次报告（JSON + Markdown）与 Trace 回放（`npx playwright show-trace reports/traces/<id>.zip`）

> 测试问题统一登记见 测试问题记录.md：按时间/模块分类，含飞书 RecordId、裁定结论与防重复规则。

## 接入真实 LLM

`HttpLlmClient` 已实现：OpenAI 兼容接口（`POST {LLM_API_BASE}/chat/completions`），
提示词自动组装任务单目标/约束、页面无障碍树摘要、动作历史与状态新颖度，
要求模型输出结构化 JSON 动作，解析失败自动重试一次。

在 `.env` 配置 `LLM_API_BASE/LLM_API_KEY/LLM_MODEL` 即可启用。未配置或连续失败
3 次时，`ResilientDecider` 自动降级为宽度优先启发式探索，流程不中断。
运行 `npm run selftest` 可离线验证解析、提示词组装与降级逻辑。

## 安全约束

- 仅允许连接 localhost / 内网地址，外网地址直接拒绝运行
- 数据库名必须包含 `test` 或 `prop`
- 系统管理区域（用户/角色/代码生成）与批量删除类操作默认拦截

