# Spec → Code Validation（产品生产模块 production）

- 分析时间：2026-10-22（CST）
- 需求依据：`ai-test/01-requirement/requirement-baseline.md` REQ-025～REQ-028（FEAT-05 衣体入库、FEAT-06 部件组装、FEAT-07 质检工作台）
- 代码依据：`ai-test/02-code-analysis/production-code-behavior.md`（BR-001～BR-053），`prop_new` 提交 `5c609fc`
- 判定标准：PASS=代码明确实现且行为一致；PARTIAL=实现部分但存在缺失；FAIL=明确未实现或与需求冲突；UNKNOWN=资料不足无法确认

## REQ-025

需求：

衣体入库-建档与产品成立。选择衣体资料后按单个编号或连续范围加入待确认列表，确认全部入库后每个新编号同时完成衣体个体建档、产品成立（製造番号=衣体编号、配发单调递增 M番号且不显示）、衣体与产品绑定，本批生成一条入库记录；已有档案编号标记红色并跳过；范围非法（非数字、位数不一致、开始>结束、超 500 件）拦截；临时前缀不回写资料；同制造编号删除后可重新入库、M番号不复用。

代码实现：

- `generateRange`（PropProductionServiceImpl L51-78）实现范围生成：资料前缀强制带出、临时前缀仅用于本次生成、补零保位、非数字/位数不一致/开始>结束/超 500 件/超 64 码点全部拦截（BR-003～BR-010）。
- `checkNumbers`（L81-98）+ `selectActiveNumbers`（XML L15-19）实现跨部件类型的当前有效编号全系统查重，前端红色「已有档案」标记（BR-011）。
- `intake`/`intakeOne`（L101-158）：已有档案跳过（skip 不计失败）、单编号独立事务、失败行保留；逐编号完成衣体建档（source_type=intake、记录资料版本）+产品成立（製造番号=衣体编号、M+6 位序列）+body 绑定+批次记录+PRODUCT_CREATED 事件；M番号行锁序列单调递增不复用（BR-013～BR-018）。
- `deleteProduct`（L648-665）软删置空 active 编号，同编号可重新入库配发新 M番号（BR-019）。
- 前端 intake/index.vue：资料下拉仅列启用项、前缀只读/可编辑切换、待确认列表增删清空、二次确认、成功/跳过/失败提示。

涉及文件：

- `ruoyi-admin/.../prop/PropProductionController.java`
- `ruoyi-prop/.../production/service/impl/PropProductionServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/production/PropProductionMapper.xml`
- `sql/c02_product_production_and_traceability.sql`
- `ruoyi-ui/src/views/prop/production/intake/index.vue`

涉及方法：

`generateRange`、`checkNumbers`、`intake`、`intakeOne`、`lockSequence`、`advanceSequence`、`selectActiveNumbers`、`insertIntakeBatch/Item`、`deleteProduct`

验证：

正常流程：PASS

选择资料→单个/范围加入→确认入库→三件事+批次记录完整实现（BR-008、BR-009、BR-012、BR-015）。

异常流程：PASS

已有档案跳过（BR-013）、范围非法四类拦截（BR-003～BR-006）、空列表/全部已有档案拦截（BR-014）、单项失败保留（BR-017）。

业务规则：PARTIAL

编号唯一、M番号单调不复用、500 上限、临时前缀不回写、资料版本随入库快照、删除后可重新入库均已实现（BR-011、BR-016、BR-019）。但需求规则「已删除衣体不计入入库记录有效成员；无有效成员的入库记录不作为有效记录展示」无法确认：`prop_intake_batch/item` 全工程仅有写入（insertIntakeBatch/Item、updateIntakeBatch），无任何查询/展示 API 与界面，该展示口径无实现载体。

最终结果：

PARTIAL

问题说明：

入库记录（批次）只写不读，需求关于入库记录展示口径的子规则在当前代码中无对应实现，无法判定 PASS 或 FAIL；其余行为与需求一致。M番号「不进入任何界面显示」：产品查询投影包含 m_no 字段返回前端，但是否展示由产品管理界面决定，本模块三个页面均未渲染 M番号。

---

## REQ-026

需求：

部件组装-录入与绑定。进入页面表格为空须先筛选；Spreadsheet 一行一台录入气囊/传感器/发生器位置1/2 编号，Enter/Tab/离开触发保存（Enter 下移、Tab 右移、↑带出上一台同槽位编号）；新编号按默认资料自动建档（来源：组装建档，传感器记录默认固件）；保存后显示资料/固件 Tag；类型不符、他产品占用、产品不存在行内报错；改号识别更换并确认（取消还原）；资料与默认不一致行内确认（Enter 更正、Esc 放弃；更换且资料不一致合并为一次确认）；未选默认资料行内报错；同槽位唯一有效绑定；历史只增不改；发生器位置2 可空不影响筛选；默认资料切换不回改已保存行、有未保存输入二次确认；翻页/筛选/重置前有失败或待确认格子提示先处理；同编号重复提交且资料一致视为无操作；已删除部件不可操作。

代码实现：

- 筛选：`products`（ServiceImpl L161-167）+ `validateQueryRange` + 100 行上限；前端初始为空（BR-020～BR-022），发生器位置2 空不影响行显示（查询按产品聚合，槽位可空）。
- 保存：`saveAssembly`（L306-426）覆盖自动建档（BR-025）、类型校验（BR-026）、他产品占用（BR-027）、更换确认（BR-028）、资料更正确认（BR-029）、同号同资料无操作（BR-030）、固件三态事件（BR-031）、唯一有效绑定（BR-032）、已删除部件拦截（BR-036）。
- 前端：Enter/Tab/↑/blur 保存导航（BR-038）、确认条 Enter/Esc（BR-041）、默认资料切换二次确认且不回改已保存行（BR-039）、失败/待确认时拦截筛选与重置（BR-040）。

涉及文件：

- `PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`
- `ruoyi-ui/src/views/prop/production/assembly/index.vue`、`ruoyi-ui/src/utils/propProduction.mjs`

涉及方法：

`products`、`saveAssembly`、`validateQueryRange`、`requireMutable`、`lockSlot`、`endBinding`、`insertBinding`、`saveCell`、`confirmCell`、`onKeydown`、`hasIssues`、`requestDefaultChange`、`executeAssemblySave`、`resolveAssemblyConfirmation`

验证：

正常流程：PASS

筛选定位→录入即保存→自动建档→Tag 显示→键盘导航完整实现（BR-022、BR-024、BR-025、BR-038）。

异常流程：PARTIAL

类型不符、他产品占用、未选默认资料、更换确认取消还原、资料不一致确认/放弃均实现（BR-023、BR-026～BR-029、BR-041）。但「更换且资料不一致合并为一次确认」未实现：服务端先返回 replacement 确认（saveAssembly L343-344），确认后再返回 profile 确认（L375-376），为两次顺序确认而非合并一次。

业务规则：PARTIAL

同槽位唯一绑定、事件只增、位置2 可空、默认资料不回改、重复提交无操作、已删除部件拦截均实现（BR-030～BR-032、BR-036、BR-039）。「翻页前门禁」无实现载体：组装页为整表渲染（服务端限 100 行），不存在翻页控件，翻页门禁无法实现；筛选/重置门禁已实现（hasIssues L357-364），但路由离开页面无守卫（全文件无 onBeforeRouteLeave/beforeunload）。

最终结果：

PARTIAL

问题说明：

两处偏差：①更换+资料不一致为两次顺序确认，需求要求合并一次（交互差异，不影响数据正确性）；②翻页门禁无实现载体（无分页）、离开组装页无拦截，仅页内筛选/重置有门禁。

---

## REQ-027

需求：

部件组装-行内更正与固件更新。点击已保存格资料 Tag 下拉选择其他资料追加资料更正记录；点击传感器固件 Tag 下拉选择其他版本追加固件版本记录（旧→新）；仅作用于该部件、不覆盖旧值、历史只增；版本未变化不产生记录；仅可更正当前有效部件，已删除部件不可更正。

代码实现：

- `updateFirmware`（ServiceImpl L445/449-469）：仅 sensor 槽位；绑定身份核对（expectedBindingId/expectedPartId，4603）；同版本无操作；固件须启用；条件更新+FIRMWARE_SET/FIRMWARE_UPDATED 事件（BR-034）。
- `updateProfile`（L472/476-497）：绑定身份核对；同资料无操作；资料须启用且类型匹配；条件更新+PROFILE_CORRECTED 事件（BR-035）。
- 已删除部件：`lockPart`（XML L180-183，deleted_time is null FOR UPDATE）锁不到即拦截（BR-036）。
- 前端：Tag 下拉+Modal 确认+`executeAssemblyMetadataUpdate` 身份一致性校验（propProduction.mjs L180-203）。

涉及文件：

- `PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`
- `assembly/index.vue`、`propProduction.mjs`

涉及方法：

`updateFirmware`、`updateProfile`、`lockExpectedBinding`、`updatePartFirmware`、`updatePartProfile`、`selectEnabledFirmware`

验证：

正常流程：PASS

Tag 下拉→确认→追加记录完整实现（BR-034、BR-035）。

异常流程：PASS

版本/资料未变化无操作直接返回不产记录（updateFirmware L459、updateProfile 同资料分支）；绑定身份不符、固件停用、部件删除均拦截。

业务规则：PASS

仅该部件变化（按 partId 更新）、旧值不覆盖（历史在 prop_production_event）、已删除部件不可更正（BR-036）。

最终结果：

PASS

问题说明：

无。固件首次设定旧版本为空的口径（FIRMWARE_SET）与需求一致。

---

## REQ-028

需求：

质检通过登记。待质检清单默认显示全部满足最低构成（衣体+气囊×1+传感器×1+发生器位置1×1，位置2 可选）的产品；支持连续入力/番号入力筛选；勾选后确认质检（N 台），每台建立质检通过事实（产品、确认人、确认时间），阶段转为已完成质检；单件筛选不满足构成/已质检/编号不存在分别提示；批量单台失败不影响其他、失败行保留红字并提示成功/失败台数；质检不可撤回；有质检记录产品禁止删除；质检不产生其他业务记录。

代码实现：

- 候选：`selectInspectionCandidates`（XML L229-238）排除删除/报废/已质检，having 四槽位齐全，limit 101+超量拦截；默认无参全量加载（BR-044、BR-045）。
- 资格：`inspectionEligibility`（L523-543）五态消息：未找到该製造番号/产品已报废，不能质检/该产品已质检通过/不满足最低构成缺少X/eligible（BR-046）。
- 登记：`inspect`/`inspectOne`（L545-573）逐台独立事务、重复质检预检+唯一键并发兜底、服务端复核构成、仅写 prop_inspection+INSPECTION_PASSED 事件（BR-047～BR-051）。
- 不可撤回：Controller 无任何撤回端点；`deleteProduct` 对有质检记录产品拦截（BR-050）。
- 前端：勾选、确认弹窗列番号提示无法撤回、成功移除/失败红字、"成功 N 台，失败 M 台"（inspection/index.vue、applyInspectionResults）。

涉及文件：

- `PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`
- `sql/c02_product_production_and_traceability.sql`
- `inspection/index.vue`、`propProduction.mjs`

涉及方法：

`inspectionCandidates`、`inspectionEligibility`、`inspect`、`inspectOne`、`hasInspection`、`insertInspection`、`deleteProduct`

验证：

正常流程：PASS

默认清单→筛选→勾选→确认→逐台建档→阶段派生 inspected 完整实现（BR-044、BR-045、BR-049、BR-051）。

异常流程：PASS

不满足构成/已质检/未找到分别提示（BR-046），登记端重复质检与构成复核（BR-047、BR-048），单台失败保留（BR-049）。

业务规则：PASS

不可撤回（无端点）、唯一进入动作（仅 insertInspection 一处写入质检事实）、有质检记录禁止删除（BR-050）、不产生其他记录/编号（BR-051）。

最终结果：

PASS

问题说明：

「产品必须已完成质检才能进入出货流程」属下游寄送/出货模块校验，需出货模块代码证据，本模块不判定（记 UNKNOWN 待下游回补）。`inspectionEligibility` 额外实现的需求未列举分支：产品已报废时提示"产品已报废，不能质检"（需求未写但行为合理）。

---

## 问题汇总

### P0

无。

### P1

无。

### P2

- REQ-026：更换且资料不一致时服务端为两次顺序确认（replacement→profile），需求要求合并为一次确认；交互与需求不符（数据结果一致）。证据：`PropProductionServiceImpl.saveAssembly` L343-344 与 L375-376。

### P3

- REQ-025：入库记录（prop_intake_batch/item）仅写入无查询/展示实现，「无有效成员的入库记录不作为有效记录展示」子规则无实现载体，无法确认。
- REQ-026：组装页无翻页控件（服务端限 100 行整表渲染），翻页门禁无实现载体；路由离开组装页无守卫，仅页内筛选/重置有 hasIssues 门禁。
- REQ-028：「已完成质检才能进入出货流程」需出货模块证据回补，暂记 UNKNOWN。
