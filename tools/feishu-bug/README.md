# 飞书「测试问题跟踪」bug 记录工具

通过飞书开放平台 Open API 读写多维表格，供测试问题录入反复使用。
目标表：知识库 wiki `B8ICw5eQWigY9KkFNSjcK4cBnZd` → 电子表格内嵌多维表格
（appToken/tableId 已缓存于 config.json，无需每次解析）。

## 文件

- `config.json`：应用凭证（appId/appSecret）、表定位、默认值（类型=BUG、提出方=AI自动探索、状态=新增）
- `feishu-bug.ps1`：主脚本（token 自动缓存到 `.token-cache.json`，2 小时有效自动刷新）

## 用法（在 tools\feishu-bug 目录下）

```powershell
# 新增一条 bug（最常用：只要描述和优先级）
powershell -NoProfile -ExecutionPolicy Bypass -File .\feishu-bug.ps1 add -Description "问题描述" -Priority P1

# 完整字段
.\feishu-bug.ps1 add -Description "..." -Priority P0 -Type BUG -Reporter "人工测试" -Remark "复现步骤/证据"

# 查看全部记录（含 RecordId）
.\feishu-bug.ps1 list

# 更新（如状态流转）
.\feishu-bug.ps1 update -RecordId recXXXX -Status 修复中
.\feishu-bug.ps1 update -RecordId recXXXX -Priority P0 -Remark "补充说明"

# 删除
.\feishu-bug.ps1 delete -RecordId recXXXX

# 批量导入（JSON 数组）
.\feishu-bug.ps1 batch -FromJson .\bugs.json

# 查看表字段与选项
.\feishu-bug.ps1 fields
```

batch JSON 元素字段：`description`(必填)、`priority`(P0/P1/P2)、`type`、`reporter`、`status`、`remark`、`date`。

## 字段说明

- 类型：BUG/优化/新需求/建议（单选）；优先级：P0/P1/P2（单选）
- 当前状态：新增/修复中/待验收/验收通过，待上线/已上线（多选字段，脚本自动按数组传）
- 反馈时间：默认今天；log/截图 为附件字段，API 暂不支持，需在网页端补传

## 注意

- Windows PowerShell 5.1 兼容（文件为 UTF-8 BOM；严格模式 2.0，哈希表取值需用 ContainsKey）
- 凭证泄露处理：如 config.json 外泄，到飞书开放平台重置 appSecret 并更新本文件
