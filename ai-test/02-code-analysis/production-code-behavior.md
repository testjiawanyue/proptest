# Code Behavior Model（产品生产模块 production）

分析时间：2026-10-22（CST）。
分析范围：`prop_new` 提交 `5c609fc`；后端 `PropProductionController`、`PropProductionServiceImpl`、`PropProductionMapper.java/.xml`、production 域实体、`sql/c02_product_production_and_traceability.sql`；前端 `ruoyi-ui/src/views/prop/production/{intake,assembly,inspection}/index.vue`、`ruoyi-ui/src/api/prop/production.js`、`ruoyi-ui/src/utils/propProduction.mjs`。
分析方法：依据实际代码判断；不根据需求、注释或方法名反推。

## 1. 系统业务模块

产品生产模块（菜单目录「产品生产」，`sql/c02_product_production_and_traceability.sql:147-153` 菜单 2010～2013）覆盖产品从衣体入库到首次质检通过的生产阶段，含三个页面级子模块：

- 衣体入库（`prop:intake:page`）：衣体编号批量建档入库，一次入库同时完成衣体个体建档、产品成立、衣体与产品绑定三件事。
- 部件组装（`prop:assembly:page`）：Spreadsheet 方式一行一台录入气囊/传感器/发生器位置1/位置2 编号并建立绑定，录入即保存；支持更换、行内资料更正、传感器固件更新、解除绑定。
- 质检工作台（`prop:inspection:page`）：登记线下质检通过事实，产品由待质检转为已完成质检；不可撤回。

同一 `PropProductionController` 还承载产品管理（`prop:product:page`）与部件追溯（`prop:part:page`）接口。本文仅将其与生产阶段直接相关的行为（产品/部件删除阻断、阶段派生）作为支撑行为记录；产品列表、生命周期、部件追溯完整体归其他模块文档。

## 2. API清单

| 方法 | 路径 | Controller 方法 | 权限表达式 | 主要结果 |
|---|---|---|---|---|
| POST | /prop/production/intake/range | range (L41) | prop:intake:page | 生成连续编号清单 |
| POST | /prop/production/intake/check | check (L45) | prop:intake:page | 逐编号返回是否已有档案及部件类型 |
| POST | /prop/production/intake | intake (L50) | prop:intake:page | 批量入库，返回成功/跳过/失败计数与明细 |
| GET | /prop/production/products | products (L54) | prop:assembly:page 或 prop:product:page | 工作台产品筛选（≤100 行） |
| PUT | /prop/production/assembly | assembly (L81) | prop:assembly:page 或 prop:product:page | 单元格保存：建档/绑定/更换/资料更正确认 |
| DELETE | /prop/production/products/{productId}/bindings/{slotType} | removeBinding (L86) | 同上 | 解除槽位绑定 |
| PUT | /prop/production/products/{productId}/bindings/{slotType}/firmware | firmware (L92) | 同上 | 传感器固件更新 |
| PUT | /prop/production/products/{productId}/bindings/{slotType}/profile | profile (L98) | 同上 | 行内资料更正 |
| GET | /prop/production/inspection/candidates | inspectionCandidates (L103) | prop:inspection:page | 待质检清单（仅满足最低构成，≤100） |
| GET | /prop/production/inspection/eligibility | inspectionEligibility (L109) | prop:inspection:page | 单件质检资格判定 |
| POST | /prop/production/inspection | inspect (L115) | prop:inspection:page | 批量质检通过登记，逐台独立结果 |
| GET | /prop/production/products/{productId} | product (L76) | assembly/product page | 产品详情（当前绑定+事件历史） |
| GET | /prop/production/products/{productId}/delete-blockers | blockers (L168) | prop:product:page | 删除阻断原因清单 |
| DELETE | /prop/production/products/{productId} | deleteProduct (L173) | prop:product:page | 删除产品（含衣体，受阻断规则约束） |
| DELETE | /prop/production/parts/{partId} | deletePart (L154) | prop:part:page | 删除未绑定部件 |

其余接口（product-list、storage-path、replace-body、parts 查询/导出）属产品管理与部件追溯范围，本文不展开。

## 3. 业务功能

### 功能001：衣体入库-范围生成与编号查重

#### 入口
衣体入库页「加入」按钮（单个编号模式直接取输入；连续范围模式调用范围生成）。

#### Controller
`PropProductionController.range`（L39-41，`prop:intake:page`）→ `service.generateRange`；`check`（L43-45）→ `service.checkNumbers`。

#### Service
- `generateRange`（PropProductionServiceImpl L51-78）：校验资料（`requiredProfile` 要求启用且 part_type=jacket）；资料有前缀时强制使用资料前缀（忽略入参前缀），无前缀时用入参前缀或空串；起止必须全数字、位数一致、开始≤结束、数量≤500（RANGE_LIMIT L37）；按起始宽度补零生成；每个完整编号经 `validateCompleteNumber`（≤64 Unicode 码点，L36）。
- `checkNumbers`（L81-98）：规范化去重后查 `selectActiveNumbers`，逐编号返回 `existing` 与 `existingPartType`。

#### 数据访问
- `selectEnabledProfile`（XML L5-10）：`prop_part_profile` join 当前版本，`status='0'` 且类型匹配。
- `selectActiveNumbers`（XML L15-19）：`prop_part_item.active_part_no IN (...)`，跨全部部件类型匹配当前有效编号。

#### 正常流程
选择启用衣体资料 → 范围参数合法 → 生成补零连续编号 → 查重标记已有档案 → 前端将新编号加入待确认列表（已在列表的前端去重并提示）。

#### 异常流程
未选资料（"请选择衣体资料"）；资料停用/不存在/类型不符（"所选部件资料已停用、不存在或类型不符"）；非数字、位数不一致、开始>结束、超 500 件、编号超 64 码点均抛 ServiceException 由全局异常返回错误消息。

#### 条件分支
资料前缀存在与否决定前缀来源（BR-008/BR-009）；编号是否已有档案决定列表标记（BR-011）。

#### 参数校验
数字格式、位数一致、大小关系、500 上限、64 码点上限；前端另做单编号非空、64 码点前置校验（intake/index.vue）。

#### 权限校验
`prop:intake:page` 页面级权限。

#### 数据变化
无（纯查询/生成，不落库）。临时前缀不回写部件资料、不产生资料新版本。

#### 第三方依赖
无。

#### 错误处理
ServiceException 消息直传前端 message 提示；范围生成整体失败不产生任何列表数据。

#### 涉及代码文件
- `ruoyi-admin/.../prop/PropProductionController.java`
- `ruoyi-prop/.../production/service/impl/PropProductionServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/production/PropProductionMapper.xml`
- `ruoyi-ui/src/views/prop/production/intake/index.vue`

#### 涉及方法
`range`、`check`、`generateRange`、`checkNumbers`、`requiredProfile`、`validateCompleteNumber`、`selectActiveNumbers`、`selectEnabledProfile`

### 功能002：衣体入库-确认全部入库

#### 入口
待确认列表「确认全部入库」→ 前端 Modal 二次确认 → POST /intake。

#### Controller
`intake`（L47-50，`prop:intake:page`，操作日志 INSERT）→ `service.intake(command, username)`。

#### Service
`intake`（L101-137）：校验资料与待入库列表非空；`selectActiveNumbers` 查重，全部已存在时抛"没有可入库的新编号"；先建批次记录（`insertIntakeBatch`，记录资料 ID 与版本 ID、总数、确认人）；逐编号处理：已存在 → skip"当前已有档案"；否则单编号独立事务执行 `intakeOne`，异常记 failure（`friendlyConflict` 转换消息）；最后 `updateIntakeBatch` 回写成功/跳过/失败计数。

`intakeOne`（L139-158）：
1. `lockSequence` 行锁读取 M番号序列（>999999 抛容量异常）→ `advanceSequence` 递增；
2. `insertPart` 建衣体个体（part_type=jacket、source_type=intake、记录资料 ID 与版本 ID）；
3. `insertProduct` 建产品（manufacturing_no=衣体编号、M番号=M+6 位补零流水）；
4. `insertBinding` 建立 body 槽位绑定（active_slot_key=产品:body、active_part_key=部件）；
5. `insertIntakeItem` 登记批次明细；
6. `event("PRODUCT_CREATED")` 写生产事件。

#### 数据访问
`prop_product_sequence`（FOR UPDATE）、`prop_part_item`、`prop_product`、`prop_product_binding`、`prop_intake_batch`、`prop_intake_item`、`prop_production_event`；唯一键 `uk_part_active_no`、`uk_product_active_manufacturing_no`、`uk_product_m_no`、`uk_binding_active_slot/part`（DDL c02 L29-74）。

#### 正常流程
新编号逐台完成三件事，返回 `PropBatchResult`（成功/跳过/失败计数+逐条消息）；前端将成功与跳过行移除、失败行保留并显示原因，提示"成功 N，跳过 N，失败 N"。

#### 异常流程
空列表（"待确认衣体不能为空"）；全部已有档案（"没有可入库的新编号"，前端 canConfirm 同时为 false 置灰按钮）；单编号并发冲突（DuplicateKeyException→"编号、槽位或绑定已被并发占用"）仅影响该编号。

#### 条件分支
existing→skip / 成功 / 失败三分支（BR-013、BR-017）。

#### 参数校验
资料 ID 必填且启用；编号非空、去重、64 码点。

#### 权限校验
`prop:intake:page`。

#### 数据变化
新增衣体个体、产品、绑定、入库批次与明细、PRODUCT_CREATED 事件；M番号序列单调递增，删除产品后不复用（软删仅置空 active 编号，不回退序列）。

#### 第三方依赖
无。

#### 错误处理
批次记录先落库；单编号事务独立回滚不影响其他编号；计数最终回写批次。

#### 涉及代码文件
同功能001，另含 `domain/PropBatchResult.java`、`domain/PropProduct.java`、`domain/PropPartItem.java`、`domain/PropBinding.java`、`domain/PropProductionEvent.java`。

#### 涉及方法
`intake`、`intakeOne`、`lockSequence`、`advanceSequence`、`insertPart`、`insertProduct`、`insertBinding`、`insertIntakeBatch`、`insertIntakeItem`、`updateIntakeBatch`、`event`、`friendlyConflict`

### 功能003：组装工作台-产品筛选查询

#### 入口
部件组装页范围筛选（前缀+起止）或编号筛选（完整製造番号）。

#### Controller
`products`（L52-58，`prop:assembly:page` 或 `prop:product:page`）→ `service.products(...)`。

#### Service
`products`（L161-167）：`validateQueryRange`（L175-186）校验范围成对填写、全数字、位数一致、开始≤结束、前缀+起止拼接≤64 码点；结果经 `requireWorkbenchLimit`（L169-173）超过 100 行抛"匹配数量超过100件，请缩小范围"。

#### 数据访问
`selectProducts`（XML L103-115）：`productProjection`（XML L48-94）聚合当前绑定槽位编号、资料名、固件、`inspectionTime`，并派生 `productionStage`：有质检记录=inspected；气囊+传感器+发生器位置1 三槽位齐=ready；否则 in_progress。`manufacturingRange`（L95-102）严格匹配：长度一致+前缀 binary 匹配+数字段 regexp+binary 区间。仅排除 deleted_time，不排除报废产品（报废产品在列表可见但写操作被 `requireMutable` 拦截）。`limit 101`。

#### 正常流程
进入页面表格为空（前端 a-empty 提示"请通过制造番号范围或编号筛选产品"）；筛选后返回全部阶段（在制/待质检/已质检）产品行，前端渲染四列可编辑单元格与资料/固件 Tag。

#### 异常流程
范围参数非法抛 ServiceException；结果>100 抛错；查询失败前端保留原清单并提示"新筛选未生效，原清单保留"。

#### 条件分支
stage 参数存在时 `having productionStage=#{stage}`（组装页不传，产品列表页传）。

#### 参数校验
范围成对、数字、位数一致、大小关系、64 码点；编号筛选要求非空完整编号（前端）。

#### 权限校验
`prop:assembly:page` 或 `prop:product:page` 任一。

#### 数据变化
无。

#### 第三方依赖
无。

#### 错误处理
查询异常由前端 catch 保留旧数据。

#### 涉及代码文件
Controller、ServiceImpl、XML、`ruoyi-ui/src/views/prop/production/assembly/index.vue`

#### 涉及方法
`products`、`selectProducts`、`validateQueryRange`、`requireWorkbenchLimit`、`manufacturingRange`、`productProjection`

### 功能004：部件组装-单元格保存（录入/更换/自动建档）

#### 入口
组装页单元格 Enter/Tab/离开（blur）触发 `saveCell`；存在待确认时 Enter 触发 `confirmCell`（确认条确认）。

#### Controller
`assembly`（L78-81，`prop:assembly:page` 或 `prop:product:page`，操作日志 UPDATE）→ `service.saveAssembly`。

#### Service
`saveAssembly`（L306/310-426）主流程：
1. 校验槽位（`validateSlot` 仅允许 airbag/sensor/inflator_1/inflator_2）；非传感器槽位禁止带固件 ID；
2. `requireMutable`（L749-754）行锁产品，不存在/已删除/已报废拦截；
3. 编号规范化；`discoverBinding`+`selectActivePartByNo` 定位相关部件并 `lockPart` 行锁（"部件已变化，请重读"）；
4. `sameBinding`/`verifyTarget` 并发一致性核对（4603 错误码）；
5. `requiredProfile` 校验默认资料启用且类型匹配；传感器必须有固件 ID 且 `selectEnabledFirmware` 启用（prop_base_data data_type=sensor_firmware_version）；
6. 并发下编号被改（"部件编号已变化，请重读"）；
7. 槽位已有旧绑定且未确认 → 返回 `confirmation_required/replacement`；已确认则结束旧绑定（`endBinding`）建新绑定，事件 PART_REPLACED；
8. 新编号 → 自动建档新部件（source_type=assembly，`uk_part_active_no` 冲突提示"部件编号已被并发建档占用，请刷新后重试"）；
9. 已有部件：类型不符拦截；已绑定其他产品/其他槽位拦截（"部件当前已绑定产品X，请先显式解除原绑定"）；同产品同槽位同编号：资料与固件均一致 → 直接返回 saved（无操作）；资料不一致且未确认 → 返回 `confirmation_required/profile`，确认后 `updatePartProfile`+PROFILE_CORRECTED 事件；
10. 插入新绑定（`uk_binding_active_slot/part` 冲突分别提示槽位/部件被并发占用）；事件 PART_INSTALLED 或 PART_REPLACED；
11. 传感器：按前后固件写 FIRMWARE_SET（首次）/FIRMWARE_ADOPTED（同版本采用）/FIRMWARE_UPDATED（变更），必要时 `updatePartFirmware`；
12. 返回 `savedAssembly`（编号、资料名、资料版本、固件版本供 Tag 显示）。

#### 数据访问
`prop_product`（FOR UPDATE）、`prop_part_item`（FOR UPDATE）、`prop_product_binding`、`prop_part_profile(+version)`、`prop_base_data`、`prop_production_event`。

#### 正常流程
录入编号 → 按默认资料建档/绑定 → 返回资料/固件 Tag → 前端单元格落为已保存态，Enter 下移同列、Tab 右移一格。

#### 异常流程
未选默认资料（前端行内"请先在上方选择默认部件资料"；后端 requiredProfile 拦截）；传感器未选固件（"请选择传感器固件版本"）；固件停用（"所选固件版本已停用或不存在"）；类型不符；他产品占用；并发身份变化（4603"绑定已变化，请重读核对"等）。

#### 条件分支
更换确认（replacement）、资料更正确认（profile）、同编号同资料无操作、自动建档 vs 复用已有部件、固件三态事件。

#### 参数校验
槽位枚举、资料启用、固件启用、编号非空与 64 码点。

#### 权限校验
`prop:assembly:page` 或 `prop:product:page` 任一（写操作为页面级权限，无按钮级细分）。

#### 数据变化
部件个体（可新建）、绑定（新建/结束）、资料版本归属（追加式更正）、固件版本、生产事件（历史只增不改）。

#### 第三方依赖
无。

#### 错误处理
整体 @Transactional 回滚；确认流不写入只返回 confirmation_required；前端 `executeAssemblySave` 处理确认挂起与失败行内红字。

#### 涉及代码文件
Controller、ServiceImpl、XML、assembly/index.vue、`utils/propProduction.mjs`

#### 涉及方法
`saveAssembly`、`requireMutable`、`lockSlot`、`verifyTarget`、`sameBinding`、`requiredProfile`、`selectEnabledFirmware`、`discoverBinding`、`selectActiveBindingBySlot/ByPart`、`endBinding`、`insertBinding`、`updatePartProfile`、`updatePartFirmware`、`savedAssembly`、`confirmation`、`executeAssemblySave`、`resolveAssemblyConfirmation`

### 功能005：部件组装-解除绑定

#### 入口
DELETE /products/{productId}/bindings/{slotType}（产品详情/组装相关入口调用）。

#### Controller
`removeBinding`（L83-87，操作日志 UPDATE）。

#### Service
`removeBinding`（L429-442）：校验槽位（不允许 body）；`requireMutable`；`lockSlot`（发现绑定与锁定结果不一致抛"绑定已变化，请重读"）；无绑定抛"该槽位当前未安装部件"；锁定部件后 `endBinding`（条件更新 ended_time is null，影响行数≠1 抛错）；写 PART_REMOVED 事件。

#### 数据访问
`prop_product_binding`、`prop_part_item`。

#### 正常流程
结束当前有效绑定（保留历史行，置空 active_slot_key/active_part_key，记录 ended_by/ended_time）。

#### 异常流程
产品不存在/报废、槽位无部件、并发变化均抛 ServiceException。

#### 条件分支
无。

#### 参数校验
槽位枚举（body 不允许经此入口解除）。

#### 权限校验
`prop:assembly:page` 或 `prop:product:page`。

#### 数据变化
绑定结束 + PART_REMOVED 事件；部件个体保留可再绑定。

#### 第三方依赖
无。

#### 错误处理
@Transactional 回滚；条件更新行数校验防并发丢失。

#### 涉及代码文件
Controller、ServiceImpl、XML

#### 涉及方法
`removeBinding`、`lockSlot`、`endBinding`、`event`

### 功能006：部件组装-行内固件更新

#### 入口
已保存传感器格固件 Tag 下拉选择其他版本 → Modal 确认 → PUT firmware。

#### Controller
`firmware`（L89-93，操作日志 UPDATE）。

#### Service
`updateFirmware`（L445/449-469）：仅 sensor 槽位；`lockExpectedBinding`（L498-511）核对 expectedBindingId/expectedPartId 与当前绑定一致；锁部件并校验类型；目标版本与当前相同 → 无操作直接返回；固件须启用；`updatePartFirmware` 条件更新（deleted_time is null，行数≠1 抛错）；写 FIRMWARE_SET（旧版本为空）或 FIRMWARE_UPDATED 事件；返回最新 Tag 数据。

#### 数据访问
`prop_product_binding`、`prop_part_item`、`prop_base_data`、`prop_production_event`。

#### 正常流程
版本变化追加固件记录（旧→新），不覆盖历史；其他产品不受影响。

#### 异常流程
非传感器槽位、绑定身份不符（4603）、部件不存在/类型不符、固件停用/不存在、并发状态变化。

#### 条件分支
同版本无操作；首次设定 vs 更新两种事件。

#### 参数校验
版本 ID 启用校验；绑定身份校验。

#### 权限校验
`prop:assembly:page` 或 `prop:product:page`。

#### 数据变化
`prop_part_item.current_firmware_id` 更新 + 事件追加。

#### 第三方依赖
无。

#### 错误处理
@Transactional 回滚；前端 `executeAssemblyMetadataUpdate` 校验返回身份一致性。

#### 涉及代码文件
Controller、ServiceImpl、XML、assembly/index.vue、propProduction.mjs

#### 涉及方法
`updateFirmware`、`lockExpectedBinding`、`updatePartFirmware`、`selectEnabledFirmware`、`executeAssemblyMetadataUpdate`

### 功能007：部件组装-行内资料更正

#### 入口
已保存格资料 Tag 下拉选择其他资料 → Modal 确认 → PUT profile。

#### Controller
`profile`（L95-99，操作日志 UPDATE）。

#### Service
`updateProfile`（L472/476-497）：`lockExpectedBinding` 核对绑定身份；锁部件；目标资料与当前相同 → 无操作；`requiredProfile` 校验启用与类型；`updatePartProfile` 条件更新；写 PROFILE_CORRECTED 事件（旧版本 ID→新版本 ID）。

#### 数据访问
同功能006。

#### 正常流程
追加资料更正记录，仅该部件归属变化，不覆盖旧值（历史在事件表）。

#### 异常流程
绑定身份不符、资料停用/类型不符、并发变化。

#### 条件分支
同资料无操作。

#### 参数校验
资料启用；绑定身份。

#### 权限校验
`prop:assembly:page` 或 `prop:product:page`。

#### 数据变化
`current_profile_id/current_profile_version_id` 更新 + PROFILE_CORRECTED 事件。

#### 第三方依赖
无。

#### 错误处理
@Transactional 回滚。

#### 涉及代码文件
Controller、ServiceImpl、XML、assembly/index.vue

#### 涉及方法
`updateProfile`、`lockExpectedBinding`、`updatePartProfile`、`requiredProfile`

### 功能008：质检工作台-候选清单与单件资格检查

#### 入口
质检页进入默认加载；连续入力（前缀+起止）/番号入力（完整製造番号）筛选。

#### Controller
`inspectionCandidates`（L101-105）、`inspectionEligibility`（L107-110），均 `prop:inspection:page`。

#### Service
- `inspectionCandidates`（L513-520）：无参数=默认全量；有范围时同 `validateQueryRange`；结果>100 抛错（默认查询提示"待检产品超过100件，请按编号范围筛选"）。
- `inspectionEligibility`（L523-543）：编号必填与 64 码点校验；按编号查产品：无 → not_found"未找到该製造番号"；已报废 → scrapped"产品已报废，不能质检"；阶段 inspected → "该产品已质检通过"；in_progress → incomplete 并列出缺失部件名；ready → eligible 返回 productId。

#### 数据访问
`selectInspectionCandidates`（XML L229-238）：排除删除/报废/已有质检记录，`having` 要求 body+airbag+sensor+inflator_1 四槽位当前有效绑定齐全（=4），`limit 101`。`missingRequiredParts` 按 REQUIRED_INSPECTION_SLOTS（L38）计算缺失并映射中文标签（SLOT_LABELS L39-41）。

#### 正常流程
默认显示全部满足最低构成的待质检产品；筛选后清单标题切换为"筛选结果"；番号入力先经 eligibility 判定，非 eligible 不刷新清单并显示原因。

#### 异常流程
范围非法、超 100、编号不存在、不满足构成、已质检、已报废分别对应消息；查询失败保留原清单与勾选。

#### 条件分支
eligibility 五态（not_found/scrapped/inspected/incomplete/eligible）。

#### 参数校验
范围校验同功能003；番号必填。

#### 权限校验
`prop:inspection:page`。

#### 数据变化
无。

#### 第三方依赖
无。

#### 错误处理
前端 queryError 行内提示"新查询未生效"。

#### 涉及代码文件
Controller、ServiceImpl、XML、inspection/index.vue

#### 涉及方法
`inspectionCandidates`、`inspectionEligibility`、`selectInspectionCandidates`、`missingRequiredParts`、`validateQueryRange`

### 功能009：质检工作台-确认质检通过

#### 入口
勾选产品 →「确认质检通过（N 台）」→ Modal 列出全部製造番号并提示"确认后无法撤回"→ POST /inspection。

#### Controller
`inspect`（L112-116，`prop:inspection:page`，操作日志 INSERT）→ `service.inspect(productIds, username)`。

#### Service
`inspect`（L545-559）：ID 列表非空校验；去重后逐台独立事务 `inspectOne`，单台失败记 failure 不影响其他；返回 PropBatchResult。
`inspectOne`（L561-573）：`requireMutable`（不存在/删除/报废拦截）；`hasInspection>0` 抛"该产品已质检通过"；重新核对最低构成（缺件抛"产品不满足最低构成，缺少X"）；`insertInspection`（`uk_inspection_product` 并发冲突抛"该产品已被并发质检"）；写 INSPECTION_PASSED 事件。

#### 数据访问
`prop_inspection`（唯一键 uk_inspection_product，DDL c02 L134-141）、`prop_product`、`prop_product_binding`、`prop_production_event`。

#### 正常流程
每台建立质检通过事实（product_id、confirmed_by、confirmed_time）；阶段经 SQL 派生为 inspected；前端成功行从清单移除、失败行保留红字原因，提示"成功 N 台，失败 M 台"。

#### 异常流程
重复质检、构成不齐、产品报废/删除、并发质检；单台失败仅保留该行。

#### 条件分支
成功/失败逐台分支。

#### 参数校验
ID 列表非空。

#### 权限校验
`prop:inspection:page`（页面级；误录更正由管理员在数据层处理，系统无撤回入口）。

#### 数据变化
仅新增 `prop_inspection` 行与 INSPECTION_PASSED 事件；不产生其他业务记录、不生成新编号。

#### 第三方依赖
无。

#### 错误处理
逐台独立事务；失败消息经 `friendlyConflict` 转换。

#### 涉及代码文件
Controller、ServiceImpl、XML、inspection/index.vue、`utils/propProduction.mjs`（`applyInspectionResults`）

#### 涉及方法
`inspect`、`inspectOne`、`hasInspection`、`insertInspection`、`applyInspectionResults`

### 功能010：产品/部件删除与删除阻断（支撑行为）

#### 入口
产品管理/部件追溯页面的删除操作（与生产阶段规则直接相关，在此记录）。

#### Controller
`blockers`（L166-168）、`deleteProduct`（L170-173）、`deletePart`（L151-154）。

#### Service
- `productDeleteBlockers`（L636-645）：返回阻断原因：寄送准备或正式历史清单引用（`retainedShipmentProduct`）、仍绑定非衣体部件、已存在质检记录（`hasInspection`）、已存在受付记录（`retainedReception`）。
- `deleteProduct`（L648-665）：行锁产品；受付/寄送引用、非衣体绑定、质检记录均拦截；结束衣体绑定 → 软删衣体部件（active_part_no 置空）→ 软删产品（active_manufacturing_no 置空）。删除后同编号可重新入库并配发新 M番号（旧号不复用）。
- `deletePart`（L599-609）：行锁部件；当前有有效绑定拦截（"部件当前绑定产品X，请先解除绑定"）；软删置空 active_part_no。

#### 数据访问
`prop_shipment_product`、`prop_reception`、`prop_inspection`、`prop_product_binding`、`prop_part_item`、`prop_product`。

#### 正常流程
无阻断时删除产品连同衣体；部件仅在未绑定时可删。

#### 异常流程
四类阻断各自消息；并发状态变化。

#### 条件分支
阻断检测分支。

#### 参数校验
无入参。

#### 权限校验
`prop:product:page` / `prop:part:page`。

#### 数据变化
软删除（保留历史原值，置空 active 编号）；绑定结束。

#### 第三方依赖
无。

#### 错误处理
@Transactional 回滚；条件更新行数校验。

#### 涉及代码文件
Controller、ServiceImpl、XML

#### 涉及方法
`productDeleteBlockers`、`deleteProduct`、`deletePart`、`retainedShipmentProduct`、`retainedReception`、`hasInspection`

### 功能011：组装页前端交互行为（键盘保存、确认条、页面级门禁）

#### 入口
`ruoyi-ui/src/views/prop/production/assembly/index.vue` + `ruoyi-ui/src/utils/propProduction.mjs`。

#### Controller
无（前端行为，经功能004-007 的 API 落库）。

#### Service
无。

#### 数据访问
经 API：listProducts、saveAssembly、updateFirmware、updateProfile、listEnabledPartProfiles、listEnabledBaseData。

#### 正常流程
- Enter：保存并下移同列；最后一行不跳格并提示"Enter で保存"。
- Tab：保存并右移一格（行尾换行首列）。
- ↑：带出上一行同槽位编号进入当前输入。
- blur：自动保存。
- 保存成功格下方显示资料 Tag（含版本号）与固件 Tag；页脚显示"三部件齐全 N/M 台"（completeCount 统计气囊+传感器+发生器1 三格均有值的行）。

#### 异常流程
保存失败行内红字保留；待确认（confirmation_required）显示行内确认条，Enter 确认、Esc 放弃还原；输入变化使挂起确认失效（"输入已变化，请重新保存当前编号"）。

#### 条件分支
- 默认资料切换：无未保存输入直接切换；有未保存输入 Modal 二次确认（"确认后，未保存的新录入将按新的默认值保存；已保存部件不会改变"）；切换后已保存行不变，仅影响之后新录入，并使相关槽位挂起确认失效。
- 页面级门禁 `hasIssues`：存在未保存/保存中/失败/待确认时拦截重新筛选与重置（提示"有未保存、保存中、失败或待确认数据，请先处理或取消输入"）。

#### 参数校验
前端单格 64 码点、默认资料/固件必选前置校验。

#### 权限校验
页面级（菜单 prop:assembly:page）。

#### 数据变化
见功能004-007。

#### 第三方依赖
无。

#### 错误处理
失败格保留可重试；查询失败保留原清单。

#### 涉及代码文件
assembly/index.vue、propProduction.mjs

#### 涉及方法
`saveCell`、`confirmCell`、`onKeydown`、`hasIssues`、`requestDefaultChange`、`executeAssemblySave`、`resolveAssemblyConfirmation`、`invalidateAssemblyConfirmation`

## 4. 代码行为分支清单

| BR-ID | 行为分支 | 证据位置 |
|---|---|---|
| BR-001 | 未选衣体资料时范围生成/入库被拦截 | ServiceImpl L57/L103 |
| BR-002 | 资料停用、不存在或类型不符拦截 | requiredProfile L772-776 |
| BR-003 | 范围起止非数字拦截 | generateRange L62-63 |
| BR-004 | 起止位数不一致拦截 | generateRange L64 |
| BR-005 | 开始>结束拦截 | generateRange L67 |
| BR-006 | 单次超 500 件拦截 | generateRange L70 |
| BR-007 | 按起始宽度补零生成编号 | generateRange L72-77 |
| BR-008 | 资料有前缀时强制使用资料前缀（前端只读带出） | generateRange L59；intake/index.vue prefixReadonly |
| BR-009 | 资料无前缀时允许临时前缀或留空（纯数字编号）；不回写资料 | generateRange L59；无资料写操作 |
| BR-010 | 完整编号超 64 Unicode 码点拦截 | validateCompleteNumber L826-830；前端同名校验 |
| BR-011 | 当前有效编号全系统跨类型查重（active_part_no） | selectActiveNumbers XML L15-19 |
| BR-012 | 待确认列表前端去重（重复加入提示不新增） | intake/index.vue addCandidates |
| BR-013 | 确认入库时已有档案编号跳过（skip 不计失败） | intake L124 |
| BR-014 | 全部已有档案时确认拦截/按钮置灰 | intake L110-111；canConfirm |
| BR-015 | 入库三件事：衣体建档+产品成立+body 绑定+PRODUCT_CREATED 事件 | intakeOne L139-158 |
| BR-016 | M番号行锁序列单调递增、删除不复用、超 999999 容量拦截 | intakeOne L141-143；XML L20-21 |
| BR-017 | 单编号独立事务，失败不影响其他，失败行保留 | intake L121-134 |
| BR-018 | 入库批次记录创建与成功/跳过/失败计数回写 | intake L113-136 |
| BR-019 | 产品删除后同编号可重新入库并配发新 M番号 | deleteProduct L648-665 + intake |
| BR-020 | 工作台范围筛选参数校验（成对/数字/位数/大小/64 码点） | validateQueryRange L175-186 |
| BR-021 | 工作台/候选清单结果超 100 拦截 | requireWorkbenchLimit L169-173 |
| BR-022 | 组装页初始为空，须先筛选 | assembly/index.vue a-empty |
| BR-023 | 未选默认资料录入行内拦截 | assembly saveCell；requiredProfile |
| BR-024 | 传感器必须选择固件版本 | saveAssembly L335；saveCell |
| BR-025 | 新编号自动建档（来源：组装建档）；并发占用提示 | saveAssembly L350-362 |
| BR-026 | 部件类型与槽位不符拦截 | saveAssembly L365 |
| BR-027 | 部件已绑定其他产品/槽位拦截（提示先解除原绑定） | saveAssembly L367-368 |
| BR-028 | 同槽位已有绑定→更换确认；确认后结束旧绑定建新绑定（PART_REPLACED） | saveAssembly L343-344、L392-409 |
| BR-029 | 资料与默认不一致→行内确认条；确认后 PROFILE_CORRECTED 追加 | saveAssembly L375-389 |
| BR-030 | 同产品同槽位同编号且资料/固件一致→无操作 | saveAssembly L369-372、L392-393 |
| BR-031 | 传感器固件三态事件 FIRMWARE_SET/ADOPTED/UPDATED | saveAssembly L410-423 |
| BR-032 | 同产品同槽位/同部件唯一有效绑定（数据库唯一键+冲突提示） | uk_binding_active_slot/part；saveAssembly L398-404 |
| BR-033 | 解除绑定（PART_REMOVED，槽位无部件报错，body 不允许） | removeBinding L429-442 |
| BR-034 | 行内固件更新：仅传感器、同版本无操作、停用固件拦截、事件追加 | updateFirmware L449-469 |
| BR-035 | 行内资料更正：同资料无操作、PROFILE_CORRECTED、绑定身份校验 | updateProfile L476-497 |
| BR-036 | 已删除部件不可安装/更正/升级（锁不到即拦截） | lockPart XML L180-183；多处判空 |
| BR-037 | 已报废产品禁止任何部件变更/质检 | requireMutable L749-754 |
| BR-038 | Enter 保存下移/Tab 右移/↑带出/离开保存 | assembly onKeydown/blur |
| BR-039 | 默认资料切换仅影响之后新录入，有未保存输入二次确认 | requestDefaultChange L486-516 |
| BR-040 | 有未保存/失败/待确认时拦截重新筛选与重置；无翻页控件、无路由离开守卫 | hasIssues L357-364；全文件无 onBeforeRouteLeave |
| BR-041 | 行内确认条 Enter 确认、Esc 放弃还原；上下文变化确认失效 | resolveAssemblyConfirmation mjs L99-118 |
| BR-042 | 并发身份核对（绑定/部件/资料/固件变化报"请重读"，错误码 4603） | verifyTarget L763-767；lockExpectedBinding L498-511 |
| BR-043 | 三部件齐全计数与待质检阶段派生（ready/inspected/in_progress） | completeCount L293-297；productProjection XML L56-58 |
| BR-044 | 待质检候选仅含最低构成齐全且未质检、未删除、未报废产品 | selectInspectionCandidates XML L229-238 |
| BR-045 | 质检页默认加载全部待检产品 | inspectionCandidates L513-520；onMounted load() |
| BR-046 | 单件资格五态：not_found/scrapped/inspected/incomplete/eligible | inspectionEligibility L523-543 |
| BR-047 | 重复质检拦截（预检+uk_inspection_product 并发兜底） | inspectOne L564、L569-570 |
| BR-048 | 登记时服务端复核最低构成 | inspectOne L565-567 |
| BR-049 | 批量质检逐台独立事务、部分成功、失败行保留红字 | inspect L545-559；applyInspectionResults |
| BR-050 | 质检不可撤回（无撤回 API）；有质检记录产品禁止删除 | 全 Controller 无撤回端点；deleteProduct L657 |
| BR-051 | 质检仅写 prop_inspection 事实与事件，不产生其他记录/编号 | inspectOne L561-573 |
| BR-052 | 切换筛选经确认后清空勾选（不保留跨清单勾选） | inspection/index.vue load L131-159 |
| BR-053 | 页面级权限：intake/assembly/inspection 各自 page 权限；组装写接口 assembly 或 product 任一即可 | Controller L39-116 |

## 5. 无法确认的代码行为

- 入库记录（prop_intake_batch/item）仅写入，全工程无查询/展示 API 与界面：有效成员口径、无有效成员记录的展示规则无法通过代码确认（无实现载体）。
- 「产品生产」目录点击后是否默认进入衣体入库页：菜单 SQL 仅建目录与三个页面菜单，未配置重定向；属前端路由运行时行为，静态代码无法确认。
- 未登录访问的前端跳转登录页行为属 RuoYi 框架通用拦截，模块代码内无独立实现。
- 菜单按角色隐藏入口依赖 sys_role_menu 授权数据，代码仅定义权限标识。
- 质检通过后"获得出货资格"在出货模块如何校验（寄送是否检查质检记录）属下游模块证据，本文不判定。
- 范围筛选 binary 比较依赖数据库字符集/排序规则的实际表现（大小写敏感性），静态无法完全确认运行时行为。

## 6. 总体行为结论

- 产品生产三段业务（衣体入库→部件组装→质检登记）在代码中完整闭环：入库三件事原子到单编号、绑定受数据库唯一键约束、质检为单向事实且不可撤回。
- 并发与一致性控制严谨：产品/部件行锁、绑定身份核对（4603）、唯一键冲突友好提示、逐台独立事务的批量处理。
- 历史只增不改：所有变更走 prop_production_event 事件流，资料更正与固件更新均为追加式。
- 与需求存在两处明确偏差（详见验证文档）：①更换且资料不一致时服务端为两次顺序确认，非合并一次确认；②组装页无翻页控件也无路由离开守卫，仅拦截页内筛选/重置。
- 质检页切换筛选时清空已勾选（经确认弹窗），与部分用例"保留跨清单勾选"的预期相反。
