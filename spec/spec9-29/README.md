# PROP V2.1 Spec 基线

本目录是 V2.1 唯一业务规则基线（2026-09-23 起）。原 `V2.1/01-正式需求/` 已按二级导航粒度重组为 `docs/features/FEAT-NN-*`，旧目录仅作历史保留，不再更新。

## 结构

```text
docs/features/
├─ FEAT-00-dashboard/          首页看板
├─ FEAT-01-customer/           客户管理
├─ FEAT-02-part-profile/       基础设置·部件资料
├─ FEAT-03-base-data/          基础设置·基础数据
├─ FEAT-04-work-options/       基础设置·作业选项
├─ FEAT-05-intake/             产品生产·衣体入库
├─ FEAT-06-assembly/           产品生产·部件组装
├─ FEAT-07-inspection/         产品生产·质检工作台
├─ FEAT-08-product/            产品管理·产品列表（含产品详情）
├─ FEAT-09-part-tracing/       产品管理·部件追溯
├─ FEAT-10-order/              订单管理
├─ FEAT-11-shipment/           寄送（订单详情寄送抽屉）
├─ FEAT-12-periodic/           点检管理·定期管理
├─ FEAT-13-notice/             点检管理·通知管理
├─ FEAT-14-reception/          受付工作台
├─ FEAT-15-reception-history/  受付履历
├─ FEAT-16-work/               作业管理
├─ FEAT-17-return/             点检管理·返送
├─ FEAT-18-return-batch-print/ 点检管理·返送批量打印
└─ FEAT-19-order-batch-print/  订单管理·批量打印
```

每个 feature 目录：`spec.md`（业务规则，状态：Current Truth）+ `validation.md`（验收用例）+ `assets/`（图表附件）。

早期格式示例包在 `spec/_example/`（位于 docs 之外，非正式需求拆解，仅供撰写格式参照）。

## 使用约定

- 本目录规定业务需求与验收结果，不预设技术架构或实现方式。后续开发根据需求进行技术方案选型与设计；现有领域模型、初版数据库设计及相关图表仅作分析参考，不构成技术选型约束。

- 业务规则以对应 FEAT 的 spec.md 为准；撰写纪律见 `V2.1/01-正式需求/_template/spec.md` 文件头与根 AGENTS.md。
- 打印与报告的 PDF 版式/内容统一标注「待正式需求」；报告字段规则章节标「目标稿（待转正）」。
- 功能改动流程：裁决写 `V2.1/修改记录.md` → 改 demo → 验证 → 回写对应 FEAT 的 spec/validation。
- 开发某个 Feature 时按需加载对应 spec/validation 与相关代码，不要默认一次性加载全部文档。

## 2026-09-25 跨模块规则修订

删除、编号复用、历史身份、正常更换衣体及保障确认书归属的现行规则与引用见 [规则摘要](docs/baseline/identity-history-rules.md)。对应验收用例已同步为要求，本次未执行业务验收；历史 demo 结论和冲突原型不代表当前规则已实现。
