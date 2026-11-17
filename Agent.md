# Agent 工作规则

1. 所有生成内容必须使用中文显示。
2. 禁止修改 `E:\proptest\prop_new` 目录下的任何文件、目录或元数据。后续产物必须输出到 `E:\proptest` 下且位于 `prop_new` 之外。
3. 代码分析文档必须按业务模块命名，避免不同模块产物混淆：
   - 架构分析：`ai-test/02-code-analysis/<模块名>-architecture.md`
   - 代码行为模型：`ai-test/02-code-analysis/<模块名>-code-behavior.md`
   - 基础设置模块统一使用模块名 `masterdata`。
