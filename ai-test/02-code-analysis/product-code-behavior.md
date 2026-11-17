# Code Behavior Model（产品管理模块 product）

分析时间：2026-10-23（CST）。
分析范围：`prop_new` 提交 `5c609fc`；后端 `PropProductionController`（产品/部件相关端点）、`PropProductionServiceImpl`、`PropProductionMapper.java/.xml`、`PropPartExportRow`、`sql/c02_product_production_and_traceability.sql`、`sql/c02_product_management_menu_increment.sql`、`sql/c03_shipment_wp2.sql`；前端 `ruoyi-ui/src/views/prop/product/{index,detail}.vue`、`ruoyi-ui/src/views/prop/part/index.vue`、`ruoyi-ui/src/utils/propProduction.mjs`。
分析方法：依据实际代码判断；不根据需求、注释或方法名反推。
关联文档：产品生产行为见 `production-code-behavior.md`（BR 编号各自独立）。

## 1. 系统业务模块

产品管理模块（菜单目录「产品管理」2017，`c02_product_management_menu_increment.sql`；页面：产品列表 2014/产品详情 2015 隐藏路由/部件追溯 2016）覆盖正式产品的查询、详情、删除与部件追溯：

- 产品列表（`prop:product:page`）：范围/单件/部件反查三种查询，生产阶段与首次出货筛选，分页展示，行内删除入口。
- 产品详情（`prop:product:page` 隐藏路由 `/products/:productId`）：基本信息、生命周期日程、当前部件及部件操作（更换/补录/拆除/版本升级/更换衣体）、资料存放路径、相关业务历史时间线。
- 部件追溯（`prop:part:page`）：当前有效部件筛选查询、详情履历、Excel 导出、删除。

后端接口与产品生产模块共用 `PropProductionController`/`PropProductionServiceImpl`；绑定写入逻辑（saveAssembly/removeBinding/updateFirmware/updateProfile）行为详见 production 文档，本文仅记录产品管理侧入口与展示行为。

## 2. API清单

| 方法 | 路径 | Controller 方法 | 权限表达式 | 主要结果 |
|---|---|---|---|---|
| GET | /prop/production/product-list | productList (L61) | prop:product:page | 分页产品列表（总数+行） |
| GET | /prop/production/products/{productId} | product (L76) | prop:assembly:page 或 prop:product:page | 产品详情（含绑定、缺件、事件历史） |
| PUT | /prop/production/products/{productId}/storage-path | storage (L158) | prop:product:page | 保存资料存放路径 |
| POST | /prop/production/products/{productId}/replace-body | replaceBody (L164) | prop:product:page | 登记更换衣体事件 |
| GET | /prop/production/products/{productId}/delete-blockers | blockers (L168) | prop:product:page | 删除阻断原因清单 |
| DELETE | /prop/production/products/{productId} | deleteProduct (L173) | prop:product:page | 删除产品（含随删衣体） |
| PUT | /prop/production/assembly | assembly (L81) | prop:assembly:page 或 prop:product:page | 详情页更换/补录部件（复用组装保存） |
| DELETE | /prop/production/products/{productId}/bindings/{slotType} | removeBinding (L86) | 同上 | 拆除部件 |
| PUT | /prop/production/products/{productId}/bindings/{slotType}/firmware | firmware (L92) | 同上 | 传感器版本升级 |
| GET | /prop/production/parts | parts (L120) | prop:part:page | 部件追溯分页查询 |
| GET | /prop/production/parts/{partId} | part (L149) | prop:part:page | 部件详情与履历 |
| POST | /prop/production/parts/export | exportParts (L135) | prop:part:page | 按当前筛选导出 Excel |
| DELETE | /prop/production/parts/{partId} | deletePart (L154) | prop:part:page | 删除未绑定部件 |

## 3. 业务功能

### 功能001：产品列表查询与筛选

#### 入口
产品列表页（product/index.vue）：范围查询（默认页签）/单件查询/部件反查三种模式。

#### Controller
`productList`（L59-72，`prop:product:page`）：构建分页参数，页大小经 `boundedPageSize` 限制 ≤100，默认 20。

#### Service
`productList`（ServiceImpl L188-236，`@Transactional(readOnly, REPEATABLE_READ)`）：`validateQueryRange` 校验范围（required=false：起止均空放行；只填一个抛「范围筛选需同时填写开始和结束编号」）；`firstShipment` 仅允许 pending/shipped 否则抛「首次出货筛选值不正确」；先 `countProductList`，再 `selectProductPageIds` 取页内 ID，最后 `selectProductListRows` 取行并按页内 ID 顺序重排；`productListStage`（L238-244）按行派生阶段：有 inspectionTime=inspected；body/airbag/sensor/inflator1 任一缺=in_progress；否则 ready。`reasonablePage` 处理 reasonable 分页。

#### 数据访问
`productListFilters`（XML L116-152）：排除 deleted_time；製造番号等值；manufacturingRange 严格区间；partNo 反查当前绑定（exists 未结束绑定）；firstShipment：`first_shipment_date IS [NOT] NULL`；stage：inspected=存在质检记录、ready=无质检且四槽位齐、in_progress=无质检且缺任一必需槽位。`selectProductPageIds` 排序为 `create_time desc, product_id desc`（非製造番号数字升序）。

#### 正常流程
- 默认加载：前端初始 stage='inspected'（已完成质检），firstShipment 空=全部。
- 阶段/首次出货下拉 change 即触发 search；范围需成对填写。
- 单件/部件反查：命中恰好 1 行直接跳转详情；0 行提示「未找到该产品编号」/「未找到绑定该部件的产品」留在列表。
- 重置：清空起止、单件、部件输入与首次出货；保留生产阶段、前缀与查询模式（前端 reset）。
- 列展示：製造番号粗体、阶段标签（在制 default/待质检 orange/已完成质检 green）、对外名称（无值「未命名」灰显）+衣体规格、当前业务归属（订单号+类型标签+订购方名，已取消标注（已取消），无关系「无当前订单」）、产品状态（已报废 red/已关联订单/未关联订单）、当前组成（气囊、传感器/固件、发生器1/2 斜杠）、首次质检通过日、首次出货（无值「待首次出货」）、操作（查看详情+···删除产品）。
- 分页：默认 20 条/页，显示「共 N 台」，页大小可改（10/20/50/100）。

#### 异常流程
范围只填一个/非数字/位数不一致/开始>结束 → 前端 productionRangeError 警告，不发请求；查询失败保留上次成功列表并提示「新查询未生效」。

#### 条件分支
三种查询模式参数互斥（params() 按 mode 组参）；stage/firstShipment 的 choose 分支（XML）。

#### 参数校验
范围格式（前后端双重）；firstShipment 枚举（后端）。

#### 权限校验
`prop:product:page`。

#### 数据变化
无。

#### 第三方依赖
无。`first_shipment_date/lifecycle_base_month/external_product_name` 由出货模块写入（c03_shipment_wp2.sql 加列），本模块只读展示。

#### 错误处理
查询异常保留旧数据；分页越界 reasonable 回调。

#### 涉及代码文件
- `PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`
- `ruoyi-ui/src/views/prop/product/index.vue`、`ruoyi-ui/src/api/prop/production.js`

#### 涉及方法
`productList`、`countProductList`、`selectProductPageIds`、`selectProductListRows`、`productListStage`、`reasonablePage`、`validateQueryRange`

### 功能002：产品详情聚合（基本信息+当前部件+缺件+历史事件）

#### 入口
列表「查看详情」或单件/反查直达，路由 `/products/:productId`。

#### Controller
`product`（L74-76，`prop:assembly:page` 或 `prop:product:page`）。

#### Service
`productDetail`（L255-277）：`selectProductDetail`（含 deleted_time is null，查无抛「产品不存在」）；`selectCurrentBindings` 当前绑定（按槽位固定顺序）；`missingRequiredParts` 计算缺件中文名；合并三类事件：`selectProductEvents`（生产事件）+ `selectProductFulfillmentEvents`（出货/订单履约事件，PRODUCT_NAME_CHANGED 若同源已记录则跳过）+ `selectProductReceptionEvents`（受付/处置/返送事件），`sortHistory` 按业务时间（Asia/Tokyo 比较键）+eventId 倒序。

#### 数据访问
`productProjection`（XML L48-94）：productId、manufacturingNo、mNo（界面不渲染）、storagePath、createTime、scrappedTime、firstShipmentDate、lifecycleBaseMonth、externalProductName、baselineShipmentId/No、nameAdoptedShipmentId、当前订单号/类型/状态/订购方名（有效订单关系子查询）、各槽位编号/资料/固件、bodySpecification、inspectionTime。

#### 正常流程
详情页展示：基本信息 7 项（製造番号、对外产品名称（无值「未命名（首次正式发货时按订单采用）」）、衣体规格、首次质检通过日、首次出货（含基准来源运单号）、生命周期基准月、资料存放路径+编辑）；阶段提示条（在制=「产品仍在制，缺少：X」info、待质检=「已满足最低构成，请前往质检工作台完成登记」warning、已质检/已报废不显示）；当前部件 5 行（body 行操作=更换衣体；已装部件=更换/拆除（传感器加版本升级）；未装部件=补录（仅 stage≠inspected 显示）；报废产品全部不显示操作）；相关业务历史时间线。

#### 异常流程
产品不存在/已删除 → ServiceException「产品不存在」→ 前端 a-result 错误页（返回/重试）。非法 ID（非正整数或超 Long 上限）→ 前端 load() 直接返回不发请求，页面停留加载态（无错误提示）。

#### 条件分支
阶段提示条按 productionStage/scrappedTime 分支；部件操作按槽位/是否已装/阶段分支。

#### 参数校验
前端 ID 格式校验（正整数、≤19 位、≤Long 上限）。

#### 权限校验
`prop:assembly:page` 或 `prop:product:page`。

#### 数据变化
无。

#### 第三方依赖
无。

#### 错误处理
detailError 提示+重试按钮；并发跳转时旧响应作废（loadSequence）。

#### 涉及代码文件
- `PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`
- `ruoyi-ui/src/views/prop/product/detail.vue`

#### 涉及方法
`productDetail`、`selectProductDetail`、`selectCurrentBindings`、`missingRequiredParts`、`selectProductEvents`、`selectProductFulfillmentEvents`、`selectProductReceptionEvents`、`sortHistory`

### 功能003：生命周期日程展示

#### 入口
产品详情「生命周期」区块（前端派生，无独立 API）。

#### Controller
无（数据取自功能002 详情事件流）。

#### Service
无。

#### 数据访问
`product.lifecycleBaseMonth`（prop_product 列，出货模块写入）；`events` 中 eventType='SERVICE_RECEPTION' 且 inspectionYear=N 的事件（受付模块产生）。

#### 正常流程
- 有基准月：固定 5 行表格；年次=1年目～5年目；目标年月=基准月年份+N、月份不变（`${base.year+N}-${base.month}`）；内容=1～4 年「定期点检」、第 5 年「报废计划」；受付实绩=匹配到对应 inspectionYear 的 SERVICE_RECEPTION 事件显示「已计入 · 日期」，否则显示「—」。
- 无基准月：a-empty「首次出货后生成生命周期日程」。

#### 异常流程
无。

#### 条件分支
基准月有无。

#### 参数校验
无。

#### 权限校验
随详情页。

#### 数据变化
无（派生展示）。

#### 第三方依赖
基准月与实际记录依赖出货/受付模块写入。

#### 错误处理
无。

#### 涉及代码文件
`ruoyi-ui/src/views/prop/product/detail.vue`（lifecycleRows L329-345）

#### 涉及方法
`lifecycleRows`

### 功能004：相关业务历史时间线

#### 入口
产品详情「相关业务历史」页签（前端过滤，无独立 API）。

#### Controller
无。

#### Service
无（事件由功能002 聚合返回）。

#### 数据访问
`productionEventDisplay`（mjs L250-268）：PROFILE_CORRECTED 展示字段级差异（名称/规格/厂商/编号前缀 旧→新）；FIRMWARE_SET/UPDATED/ADOPTED 展示版本变化；PART_INSTALLED/REMOVED/REPLACED 展示编号流向；PART_REGISTERED 显示首次登记；其余显示 eventContent。
`productHistoryCategory`（L281-289）：production 类（PRODUCT_CREATED、PRODUCT_NAME_CHANGED、INSPECTION_PASSED、PART_*、PROFILE_CORRECTED、FIRMWARE_*、BODY_PHYSICAL_REPLACED）；shipment 类（SHIPMENT_/ORDER_ 前缀）；service 类（SERVICE_/INSPECTION_SERVICE_ 前缀）；return 类（RETURN_/RECOVERED/SCRAPPED 前缀）。

#### 正常流程
页签 5 个：全部（默认，四类合集）/生产与部件/出货与订单/点检与维修/返送与最终去向；时间线倒序，每条显示事件描述、操作人（createBy，空值显 system）、业务时间；空分类显示「尚无相关记录」。

#### 异常流程
无。

#### 条件分支
页签过滤（productHistoryIncludes）。

#### 参数校验
无。

#### 权限校验
随详情页。

#### 数据变化
无。

#### 第三方依赖
无。

#### 错误处理
无。

#### 涉及代码文件
`ruoyi-ui/src/views/prop/product/detail.vue`、`ruoyi-ui/src/utils/propProduction.mjs`

#### 涉及方法
`productHistoryIncludes`、`productHistoryCategory`、`productionEventDisplay`、`productHistoryActor`、`visibleEvents`

### 功能005：产品资料存放路径录入

#### 入口
详情基本信息「资料存放路径」→ 编辑按钮 → Modal 输入 → 保存。

#### Controller
`storage`（L156-159，`prop:product:page`）。

#### Service
`updateStoragePath`（L610-618）：>500 字符抛「资料存放路径不能超过500个字符」；`updateStoragePath`（XML L322）条件更新（deleted_time is null），行数≠1 抛「产品不存在或已删除」；空串归一为 null。

#### 数据访问
`prop_product.storage_path`。

#### 正常流程
Modal 保存成功提示「资料存放路径已保存」，仅作记录展示，不打开不校验；前端保存后直接更新本地值并防止旧读覆盖（loadSequence++）。

#### 异常流程
超长、产品删除分别报错；保存失败 Modal 内红字可重试。

#### 条件分支
空值归一。

#### 参数校验
长度 ≤500。

#### 权限校验
`prop:product:page`。

#### 数据变化
storage_path 更新（update_by/time 记录）。

#### 第三方依赖
无。

#### 错误处理
@Transactional 回滚。

#### 涉及代码文件
`PropProductionController.java`、`PropProductionServiceImpl.java`、`detail.vue`

#### 涉及方法
`updateStoragePath`、`savePath`

### 功能006：更换衣体事件

#### 入口
详情当前部件 body 行「更换衣体」→ Modal 确认。

#### Controller
`replaceBody`（L161-164，`prop:product:page`，操作日志 UPDATE）。

#### Service
`replaceBody`（L619-634）：`requireMutable`（不存在/删除/报废拦截）；`lockSlot(productId,'body')` 无衣体绑定抛「衣体绑定不存在」；`verifyTarget` 并发核对；仅写 `BODY_PHYSICAL_REPLACED` 事件（内容「更换衣体」，不含新旧编号）；返回当前绑定信息。不建衣体、不解绑、不改资料。

#### 数据访问
`prop_product`、`prop_product_binding`、`prop_production_event`。

#### 正常流程
确认弹窗文案「请确认线下已完成实物更换。产品、製造番号、系统衣体身份与绑定保持不变。」→ 确认登记事件，提示「已登记更换衣体」，详情刷新。

#### 异常流程
取消不产生事件；报废/删除产品拦截。

#### 条件分支
无。

#### 参数校验
无入参。

#### 权限校验
`prop:product:page`。

#### 数据变化
仅追加事件。

#### 第三方依赖
无。

#### 错误处理
@Transactional 回滚；登记成功但刷新失败时提示重试。

#### 涉及代码文件
`PropProductionController.java`、`PropProductionServiceImpl.java`、`detail.vue`

#### 涉及方法
`replaceBody`、`lockSlot`、`verifyTarget`、`askBody`

### 功能007：产品详情-部件操作（更换/补录/拆除/版本升级）

#### 入口
详情当前部件行操作按钮（更换/补录共用部件弹窗；拆除确认弹窗；版本升级弹窗）。

#### Controller
复用 `assembly`（L81）、`removeBinding`（L86）、`firmware`（L92），权限 `prop:assembly:page` 或 `prop:product:page` 任一。

#### Service
复用 `saveAssembly`（更换/补录，含资料不一致 profile 确认与更换 replacement 确认）、`removeBinding`、`updateFirmware`，行为见 production 文档功能004-006。详情侧差异：弹窗资料默认旧部件当前资料（partForm.profileId=row.profileId）、编号与固件必填校验（a-form rules）、发生器位置 1/2 为独立行独立按钮（弹窗内不选位置）。

#### 数据访问
同 production 功能004-006。

#### 正常流程
- 更换：弹窗（标题「更换部件」）选资料+输编号（传感器选固件）→ 提交 → 服务端如需确认返回 confirmation_required（弹窗内 warning 确认区）→ 再提交完成；成功提示「部件信息已保存」并刷新。
- 补录：未安装槽位（stage≠inspected）显示「补录」，弹窗标题「补录部件」，同一保存链路。
- 拆除：确认弹窗（「确认后结束当前安装关系，部件恢复未绑定，历史继续保留。」）→ removeBinding。
- 版本升级：弹窗（标题「版本升级」）选新版本 → updateFirmware 追加记录。

#### 异常流程
编号空（表单必填拦截）；他产品占用、类型不符、固件停用、并发变化（4603）弹窗内错误提示；取消不产生变化。

#### 条件分支
确认分支（replacement/profile）、操作可用性（partOptionsAvailable：报废/选项缺失/传感器无固件选项时禁用）。

#### 参数校验
表单必填（资料、编号、传感器固件）。

#### 权限校验
`prop:assembly:page` 或 `prop:product:page`。

#### 数据变化
绑定新建/结束、资料更正追加、固件追加、事件流（见 production 文档）。

#### 第三方依赖
无。

#### 错误处理
`executePartModalSubmission` 统一处理确认/保存/错误三态。

#### 涉及代码文件
`PropProductionController.java`、`PropProductionServiceImpl.java`、`detail.vue`、`propProduction.mjs`

#### 涉及方法
`saveAssembly`、`removeBinding`、`updateFirmware`、`submitPart`、`askRemove`、`openFirmware`、`executePartModalSubmission`

### 功能008：产品删除与阻断

#### 入口
列表行内 ···「删除产品」。

#### Controller
`blockers`（L166-168）→ `deleteProduct`（L170-173），`prop:product:page`。

#### Service
- `productDeleteBlockers`（L635-645）：产品不存在抛错；依次收集阻断：寄送准备或正式历史清单引用（retainedShipmentProduct>0）、当前仍绑定非衣体部件、已存在质检记录、已存在受付记录。
- `deleteProduct`（L647-665）：行锁产品；受付/寄送引用、非衣体绑定、质检记录逐一拦截；结束衣体绑定→软删衣体部件（active_part_no 置空）→软删产品（active_manufacturing_no 置空）。

#### 数据访问
`prop_shipment_product`、`prop_reception`、`prop_inspection`、`prop_product_binding`、`prop_part_item`、`prop_product`。

#### 正常流程
无阻断 → 确认弹窗（「产品及衣体将退出当前范围；原身份与历史保留，非衣体部件不删除，M番号不复用，制造编号可重新入库。」）→ 删除成功列表刷新行消失；取消无变化。

#### 异常流程
有阻断 → Modal.error 一次性列出全部命中原因（join '；'），不执行删除。

#### 条件分支
四类阻断分支。

#### 参数校验
无。

#### 权限校验
`prop:product:page`。

#### 数据变化
产品与随删衣体软删（历史原值保留、active 编号释放）；衣体绑定结束；非衣体部件不动；M番号不复用、编号可重新入库。

#### 第三方依赖
无。

#### 错误处理
@Transactional 回滚；并发条件更新行数校验。

#### 涉及代码文件
`PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`、`product/index.vue`

#### 涉及方法
`productDeleteBlockers`、`deleteProduct`、`retainedShipmentProduct`、`retainedReception`、`hasInspection`、`askDelete`

### 功能009：部件追溯查询

#### 入口
部件追溯页（part/index.vue）：部件类型/关键词/部件资料/当前归属四条件。

#### Controller
`parts`（L118-130，`prop:part:page`）：PageHelper 分页（页大小 ≤100）。

#### Service
`parts`（L574-577）透传 `selectParts`。

#### 数据访问
`selectParts`（XML L240-252）：仅 deleted_time is null 当前有效部件；类型等值；编号 like %关键词%；资料等值；bound=true 当前有有效绑定/false 无；join 当前绑定与产品取归属製造番号；按 part_id desc。

#### 正常流程
默认加载全部当前有效部件，显示「共 N 件」；条件下拉 change 即时查询；重置恢复默认；列：编号（等宽）、类型、当前资料（资料名）、当前归属（产品 编号/未绑定）、首次登记（建档来源+日期）、操作（详情+···删除）；分页 20/页可改。

#### 异常流程
无匹配空表；查询失败保留上次条件与列表并提示。

#### 条件分支
bound 三态（true/false/不筛）。

#### 参数校验
无。

#### 权限校验
`prop:part:page`。

#### 数据变化
无。

#### 第三方依赖
无。

#### 错误处理
前端 catch 保留旧数据。

#### 涉及代码文件
`PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`、`part/index.vue`

#### 涉及方法
`parts`、`selectParts`

### 功能010：部件详情履历

#### 入口
部件行「详情」→ 弹窗。

#### Controller
`part`（L147-149，`prop:part:page`）。

#### Service
`partDetail`（L578-597）：`selectPartDetail`（deleted_time is null，查无抛「部件不存在」）；`selectPartEvents`（partId 或 relatedPartId 命中的事件，含被更换）；合成一条 PART_REGISTERED 首次登记事件（来源 衣体入库/组装建档）；`sortHistory` 倒序。

#### 数据访问
`prop_part_item`、`prop_production_event`、当前绑定与产品、资料版本、固件字典。

#### 正常流程
弹窗：基础信息一行三列（编号、类型、当前资料、当前归属、首次登记）+ 履历时间线（倒序、限高 420px 滚动），事件含安装/拆除/更换/被更换/资料更正（从哪份到哪份）/固件变更/首次登记，操作人有记录时显示；编号与归属纯文本无跳转。

#### 异常流程
部件不存在/已删除 → 弹窗内 a-result 错误+重试。

#### 条件分支
无。

#### 参数校验
无。

#### 权限校验
`prop:part:page`。

#### 数据变化
无。

#### 第三方依赖
无。

#### 错误处理
detailSequence 防止旧响应覆盖。

#### 涉及代码文件
`PropProductionController.java`、`PropProductionServiceImpl.java`、`part/index.vue`、`propProduction.mjs`

#### 涉及方法
`partDetail`、`selectPartDetail`、`selectPartEvents`

### 功能011：部件导出 Excel

#### 入口
部件追溯「导出」按钮（有成功查询条件后可点）。

#### Controller
`exportParts`（L132-145，`prop:part:page`，操作日志 EXPORT）：按同一 `service.parts` 查询结果逐行 `PropPartExportRow.from` 转换，`ExcelUtil.exportExcel` 输出「部件追溯」。

#### Service
复用 `parts`（不分页，全量当前筛选结果）。

#### 数据访问
同功能009。

#### 正常流程
导出列与页面列一致：编号、类型（中文）、当前资料、当前归属（产品 编号/未绑定）、首次登记（来源+yyyy-MM-dd）；前端下载文件名 `部件追溯_日期.xlsx`。

#### 异常流程
无（查询异常由全局处理）。

#### 条件分支
无。

#### 参数校验
同功能009。

#### 权限校验
`prop:part:page`。

#### 数据变化
无（仅输出文件）。

#### 第三方依赖
RuoYi ExcelUtil（POI）。

#### 错误处理
导出 IO 异常由框架处理。

#### 涉及代码文件
`PropProductionController.java`、`PropPartExportRow.java`、`part/index.vue`

#### 涉及方法
`exportParts`、`PropPartExportRow.from`

### 功能012：部件删除

#### 入口
部件行 ···「删除」。

#### Controller
`deletePart`（L151-154，`prop:part:page`，操作日志 DELETE）。

#### Service
`deletePart`（L598-609）：`lockPart` 行锁（查无抛「部件不存在或已删除」）；`selectActiveBindingByPart` 有当前有效绑定抛「部件当前绑定产品X，请先解除绑定」；`softDeletePart`（active_part_no 置空、记录删除人/时间）条件更新行数校验。

#### 数据访问
`prop_part_item`、`prop_product_binding`。

#### 正常流程
前端先以行数据 productId 预检：已绑定 → Modal.error 阻断弹窗；未绑定 → 确认弹窗（「删除后不再可用；原身份及历史保留。编号可重新登记，但新档案不继承原历史。」）→ 删除成功列表刷新；取消无变化。

#### 异常流程
绑定阻断（前后端双重）；并发状态变化报错。

#### 条件分支
绑定与否。

#### 参数校验
无。

#### 权限校验
`prop:part:page`。

#### 数据变化
部件软删退出当前有效范围；历史（事件流）保留；编号解除唯一占用，可重新登记为独立新身份（uk_part_active_no 只约束当前有效）。

#### 第三方依赖
无。

#### 错误处理
@Transactional 回滚。

#### 涉及代码文件
`PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`、`part/index.vue`

#### 涉及方法
`deletePart`、`lockPart`、`selectActiveBindingByPart`、`softDeletePart`

## 4. 代码行为分支清单

| BR-ID | 行为分支 | 证据位置 |
|---|---|---|
| BR-001 | 列表默认生产阶段=已完成质检（前端初始 stage=inspected） | product/index.vue query 默认值 |
| BR-002 | 范围筛选严格匹配；起止只填一个前后端均报错（非静默清除） | manufacturingRange XML L95-102；productionRangeError mjs L322-329 |
| BR-003 | 单件查询命中 1 条直达详情；0 条提示「未找到该产品编号」 | product/index.vue search() |
| BR-004 | 部件反查当前绑定，命中 1 条直达详情；0 条提示「未找到绑定该部件的产品」 | productListFilters partNo exists；search() |
| BR-005 | 生产阶段/首次出货下拉 change 即时查询 | product/index.vue @change="search" |
| BR-006 | 首次出货筛选=first_shipment_date IS NULL/NOT NULL | productListFilters XML L124-129 |
| BR-007 | 重置清空起止/单件/部件/首次出货，保留阶段/前缀/模式 | product/index.vue reset() |
| BR-008 | 列表排序为创建时间+ID 降序（非製造番号数字后缀升序） | selectProductPageIds XML L158-161 |
| BR-009 | 分页默认 20 条/页、显示总数、页大小可改、页大小变更回第 1 页 | product/index.vue pagination/pageChange |
| BR-010 | 列表列派生展示（阶段三色、未命名、无当前订单、（已取消）、待首次出货、组成斜杠） | product/index.vue bodyCell |
| BR-011 | 当前业务归属=有效订单关系（订单号+类型+订购方快照名） | productProjection XML L51-55 |
| BR-012 | 产品状态标签：已报废红色；已关联/未关联订单同为默认色 | product/index.vue status 模板 |
| BR-013 | 列表只读 REPEATABLE_READ 事务+两阶段分页（先 ID 后行） | productList L188-236 |
| BR-014 | 生产阶段三态派生；已有质检记录后拆件不回退 | productListStage L238-244；XML stage choose |
| BR-015 | M番号接口返回但界面不渲染、不作为查询键 | productProjection mNo；前端无 mNo 渲染 |
| BR-016 | 非法产品 ID 前端静默不发请求（停留加载态）；产品不存在后端抛错 | detail.vue load() L379-389；productDetail L258 |
| BR-017 | 已删除产品详情不可见（deleted_time is null） | selectProductDetail XML L166-169 |
| BR-018 | 详情基本信息 7 项；无业务类型字段 | detail.vue L30-59；prop_product 无 business_type 列 |
| BR-019 | 阶段提示条：在制缺件清单/待质检引导/已质检与报废不显示 | detail.vue L21-28 |
| BR-020 | 生命周期 5 行（基准月+N 年、第 5 年报废计划）；无基准月空状态 | detail.vue lifecycleRows L329-345 |
| BR-021 | 实际记录=SERVICE_RECEPTION 按 inspectionYear 匹配显示「已计入 · 日期」，否则「—」；无「已报废」分支 | detail.vue L332-343 |
| BR-022 | 历史事件多源聚合并按业务时间+eventId 倒序；名称变更事件按来源运单去重 | productDetail L262-273；sortHistory L279-293 |
| BR-023 | 历史页签 5 个（全部/生产与部件/出货与订单/点检与维修/返送与最终去向） | detail.vue historyTabs L316-322 |
| BR-024 | 操作人=createBy，空值显 system；无按页签统一 system 的规则 | productHistoryActor mjs L295-297 |
| BR-025 | PROFILE_CORRECTED 展示字段级差异（名称/规格/厂商/前缀 旧→新） | profileDifferences mjs L299-320 |
| BR-026 | 存放路径 ≤500 字符、空值归一、Modal 保存、仅记录不校验不打开 | updateStoragePath L610-618；detail.vue savePath |
| BR-027 | 更换衣体仅追加 BODY_PHYSICAL_REPLACED 事件，不建衣体/不解绑/无新旧编号 | replaceBody L619-634 |
| BR-028 | 部件操作按钮按槽位/是否已装/阶段/报废显示；已质检不显示补录 | detail.vue L84-116 |
| BR-029 | 更换/补录弹窗资料默认旧部件当前资料；编号必填、传感器固件必选 | detail.vue partForm/a-form rules |
| BR-030 | 资料不一致确认区与组装工作台共用 saveAssembly 确认逻辑 | detail.vue submitPart；saveAssembly L375-389 |
| BR-031 | 拆除二次确认后结束绑定（PART_REMOVED），部件恢复未绑定 | detail.vue askRemove；removeBinding L429-442 |
| BR-032 | 版本升级追加 FIRMWARE_UPDATED，不覆盖历史 | updateFirmware L449-469 |
| BR-033 | 并发身份核对（4603）与唯一键兜底（uk_binding_active_part/slot） | verifyTarget/lockExpectedBinding；saveAssembly L398-404 |
| BR-034 | 无对外名称设定/更正按钮；无解除订单关系入口 | detail.vue 全文无相关入口 |
| BR-035 | 产品删除四类阻断一次性列出（非衣体绑定/质检/出货含准备中/受付） | productDeleteBlockers L635-645；index.vue askDelete |
| BR-036 | 删除=结束衣体绑定+软删衣体+软删产品；非衣体部件保留 | deleteProduct L647-665 |
| BR-037 | 删除后编号可重新入库、M番号不复用 | softDeleteProduct/softDeletePart XML L320-321；序列不回退 |
| BR-038 | 部件筛选四条件（类型等值/编号 like/资料等值/归属 bound） | selectParts XML L240-252 |
| BR-039 | 仅查询当前有效部件（deleted_time is null） | selectParts where |
| BR-040 | 部件详情含合成首次登记事件（PART_REGISTERED，来源文案区分） | partDetail L584-594 |
| BR-041 | 履历倒序限高滚动、操作人显示、编号归属纯文本无跳转 | part/index.vue timeline |
| BR-042 | 导出按当前筛选全量，列与页面一致（编号/类型/当前资料/当前归属/首次登记） | exportParts L132-145；PropPartExportRow |
| BR-043 | 部件删除唯一阻断=当前有效绑定（前端预检+后端行锁复检） | part/index.vue askDelete；deletePart L603-604 |
| BR-044 | 部件软删置空 active_part_no，同编号可重新登记独立身份 | softDeletePart XML L320；uk_part_active_no |
| BR-045 | 已删除部件不可详情/更正/升级/安装（查询与行锁均过滤 deleted_time） | selectPartDetail/lockPart XML |
| BR-046 | 页面级权限：prop:product:page（列表/详情/删除/路径/更换衣体）、prop:part:page（追溯/导出/删除）；部件写操作 assembly 或 product 任一 | Controller L52-173 |

## 5. 无法确认的代码行为

- 产品排序需求口径「製造番号数字后缀升序」与代码「create_time desc, product_id desc」不一致；代码实际排序已按现状记录，需求符合性判定见验证文档。
- 「业务类型（销售/租赁/未确定，首次发货确认时写入）」：prop_product 全 DDL 无 business_type 列，代码无该字段读写，判定为未实现（非 UNKNOWN）。
- first_shipment_date/lifecycle_base_month/external_product_name 的写入时点与口径由出货模块代码决定，本模块只读展示；「未确认草稿发货不计入首次出货」需出货模块证据。
- 生命周期实际记录的「已报废·日期」展示：代码无该分支；报废事实是否应进入日程展示无代码证据。
- 入库记录有效成员口径（删除衣体不计入、无有效成员不展示）：全工程无入库记录查询实现，无实现载体。
- 未登录跳转登录页、菜单按角色隐藏依赖框架与角色授权数据。
- 订单关系并发一致性（权限类用例）属订单模块代码范围。

## 6. 总体行为结论

- 产品列表/详情/删除/部件追溯四类业务闭环完整，查询口径（当前有效、当前绑定、有效订单关系）在 SQL 层统一；删除为软删+active 编号释放，历史经事件流保留可读。
- 与需求的明确偏差：①列表排序为创建时间降序而非製造番号数字升序；②详情基本信息无「业务类型」；③历史页签为 5 个，缺「部件与版本」页签及其操作人统一 system 规则；④生命周期无记录年度显示「—」而非「尚无实际记录」，且无「已报废·日期」分支；⑤存放路径为弹窗保存而非失焦/回车即存；⑥「已关联订单」标签与「未关联订单」同为默认色（需求要求蓝色）。
- 部件导出已在代码中实现（REQ-039 边界注明 2026-09-21 时未实施，当前已实现且列一致）。
- 跨模块依赖（首次出货/基准月/对外名称写入、受付实绩、订单关系并发）均只读消费，需对应模块证据回补。
