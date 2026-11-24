# G2 影子门禁结果

- 运行号：`G2-20261123-153435-W1-08-DRYRUN-02`
- 变更号：`W1-08-DRYRUN-02`
- 模式：`shadow`
- 提交：`7e28ef9639ef4562341c58d6bc5de3630d60cb95`
- 环境指纹：`22b04e2e67dbabd47ef7e121f033d15f3ba16315ddb9d185fa86cd49b18115ce`
- 总体结果：`fail`
- 影子本应阻断：`True`

| 检查 | 分类 | 结果 | 耗时 | 失败分类 | 日志 |
|---|---|---|---:|---|---|
| 后端构建 | build | pass | 17.34s | - | `backend-build.log` |
| 后端单元与集成测试 | test | fail | 56.59s | test/failure | `backend-test.log` |
| 前端类型检查 | static | pass | 31.81s | - | `frontend-typecheck.log` |
| 前端 Lint | static | fail | 29.49s | code/static | `frontend-lint.log` |
| 前端 Node Test | test | fail | 51.0s | test/failure | `frontend-test.log` |
| 前端生产构建 | build | pass | 73.77s | - | `frontend-build.log` |
| Secret 扫描 | security | pass | 0.22s | - | `secret-scan.json` |

> shadow 模式下本结果不直接阻断开发；失败项必须由责任人分类、修复或进入例外流程。
