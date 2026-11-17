# Code Behavior Model：订单管理（order）

分析时间：2026-10-26（CST）。
分析范围：prop_new 提交 89bc（工作区存在任务前既有未提交修改：ruoyi-ui 下 4 个前端构建产物文件）；后端 `ruoyi-prop/order`、`ruoyi-prop/shipment` 包，`ruoyi-admin/web/controller/prop/PropOrderController.java`、`PropOrderRelationController.java`、`PropShipmentController.java`、`PropShipmentDocumentController.java`；Mapper XML `mapper/prop/order`、`mapper/prop/shipment`；DDL `sql/c03_order_wp1.sql`、`c03_shipment_wp2.sql`、`c03_order_relation_wp3.sql`、`c03_shipment_documents_wp4.sql`；前端 `ruoyi-ui/src/views/prop/order`、`views/prop/shipment`、`api/prop/order.js`、`api/prop/shipment.js`。
分析方法：依据实际代码判断；不根据需求、注释或方法名反推。需求范围对应 FEAT-10（订单管理）、FEAT-11（寄送）、FEAT-19（订单批量打印），REQ-041～REQ-056、REQ-103。

## 1. 系统业务模块

订单管理模块由三个子域组成：

- 订单（order 包）：订单列表/详情/新建/编辑/取消、订单就地维护客户地址与联系人、对外产品名称字典查询、操作记录。
- 寄送（shipment 包）：订单详情内的寄送准备、产品清单、字段保存、确认寄出、寄送通知邮件。
- 寄送文件（shipment.document 包）：面单（waybill/xlsx）、纳品书（deliveryNote/pdf）、保障确认书（guarantee/pdf）与订单批量打印面单。

关联外部域：客户主档（`prop_customer_*`，本模块仅读写地址/联系人、读取主体并做快照）、产品（`prop_product`，寄送添加时校验资格并占用）、基础数据字典（`prop_base_data` 对外产品名称）。

## 2. API清单

| 方法 | 路径 | Controller 方法 | 权限 | 主要结果 |
|---|---|---|---|---|
| GET | /prop/order/list | PropOrderController.list | prop:order:page | 订单分页列表（固定每页 10） |
| GET | /prop/order/{orderId} | PropOrderController.detail | prop:order:page | 订单详情聚合（行、寄送、关系、快照） |
| GET | /prop/order/{orderId}/operations | PropOrderController.operations | prop:order:page | 操作记录分页（每页 10，倒序） |
| POST | /prop/order | PropOrderController.create | prop:order:page | 新建订单（幂等） |
| PUT | /prop/order/{orderId} | PropOrderController.update | prop:order:page | 编辑订单（乐观锁） |
| POST | /prop/order/{orderId}/cancel | PropOrderController.cancel | prop:order:page | 取消订单 |
| GET | /prop/order/product-names | PropOrderController.productNames | prop:order:page | 启用对外产品名称字典 |
| POST | /prop/order/customer/{subjectId}/addresses | PropOrderController.createAddress | prop:order:page | 就地新增地址（幂等） |
| PUT | /prop/order/customer/{subjectId}/addresses/{addressId} | PropOrderController.updateAddress | prop:order:page | 就地编辑地址 |
| POST | /prop/order/customer/{subjectId}/addresses/{addressId}/contacts | PropOrderController.createContact | prop:order:page | 就地新增联系人（幂等） |
| PUT | /prop/order/customer/{subjectId}/addresses/{addressId}/contacts/{contactId} | PropOrderController.updateContact | prop:order:page | 就地编辑联系人 |
| GET | /prop/order/{orderId}/relations/{relationId} | PropOrderRelationController.detail | prop:order:page | 单条产品订单关系 |
| POST | /prop/order/{orderId}/relations/{relationId}/release | PropOrderRelationController.release | prop:order:page | 解除产品关联 |
| POST | /prop/order/{orderId}/shipments | PropShipmentController.create | prop:order:page | 新建寄送准备（幂等，SH 编号） |
| GET | /prop/shipment/{shipmentId} | PropShipmentController.detail | prop:order:page 或 prop:orderBatchPrint:page | 寄送聚合详情 |
| PUT | /prop/shipment/{shipmentId} | PropShipmentController.save | 同上 | 字段保存（auto/explicit） |
| POST | /prop/shipment/{shipmentId}/products | PropShipmentController.add | 同上 | 添加产品（单个/连续） |
| DELETE | /prop/shipment/{shipmentId}/products/{productId} | PropShipmentController.remove | 同上 | 移除产品 |
| DELETE | /prop/shipment/{shipmentId} | PropShipmentController.delete | 同上 | 删除准备中寄送 |
| POST | /prop/shipment/{shipmentId}/confirm | PropShipmentController.confirm | 同上 | 确认寄出 |
| POST | /prop/shipment/{shipmentId}/files | PropShipmentController.generate | 同上 | 生成寄送通知邮件新版本 |
| GET | /prop/shipment/{shipmentId}/files/{fileId} | PropShipmentController.file | 同上 | 文件版本元数据 |
| GET | /prop/shipment/{id}/documents/prepare | PropShipmentDocumentController.prepare | 同上 | 文件生成准备（默认值+sourceToken） |
| POST | /prop/shipment/{id}/documents | PropShipmentDocumentController.create | 同上 | 生成面单/纳品书/保障确认书版本 |
| GET | /prop/shipment/{id}/documents/result | PropShipmentDocumentController.result | 同上 | 生成结果查询（saved/unknown） |
| GET | /prop/shipment/{id}/files/{fileId}/content | PropShipmentDocumentController.content | 同上 | 文件内容下载（xlsx/pdf） |
| GET | /prop/shipment/batch-preparations | PropShipmentDocumentController.preparations | prop:orderBatchPrint:page | 批量打印候选列表 |
| POST | /prop/shipment/batch-labels/prepare | PropShipmentDocumentController.batchPrepare | prop:orderBatchPrint:page | 批量打印准备 |
| POST | /prop/shipment/batch-labels | PropShipmentDocumentController.batchCreate | prop:orderBatchPrint:page | 批量生成面单并回写快递公司 |
| POST | /prop/shipment/batch-labels/result | PropShipmentDocumentController.batchResult | prop:orderBatchPrint:page | 批量结果查询 |
| POST | /prop/shipment/batch-labels/content | PropShipmentDocumentController.batchContent | prop:orderBatchPrint:page | 批量面单 xlsx 下载 |

权限特征：订单与寄送读写共用单一权限 `prop:order:page`；批量打印菜单及接口使用 `prop:orderBatchPrint:page`（`sql/c03_shipment_documents_wp4.sql:62`）；寄送抽屉接口对两种权限任一放行（hasAnyPermi）。服务端未区分“只读角色”。

## 3. 业务功能

### 功能001：订单列表查询

#### 入口
订单管理列表页（`views/prop/order/index.vue`）。

#### Controller
`PropOrderController.list`：PageHelper 固定 pageSize=10；调用 `service.list(query)`。

#### Service
`PropOrderServiceImpl.list`（PropOrderServiceImpl.java:73）：先 `normalizeQuery`（:456）校验枚举与日期范围，再 `mapper.selectOrderList`，逐行 `loadAggregate(order,false)` 补充行信息。

#### 数据访问
`PropOrderMapper.xml selectOrderList`（:37）：关键词 LOWER 模糊匹配 `order_no`、`customer_order_no`、下单方/納品先快照 JSON 的 `$.name` 四项；制造番号用 EXISTS 子查询匹配未删除寄送（含准备中）的 `prop_shipment_product.manufacturing_no` 部分匹配；履约进度三态按 `delivery_valid=1` 关系数与订单行总数比较；受注日 `>=`/`<=` 含边界；预计发货日范围对 NULL 行自然排除。排序 `create_time DESC, order_id DESC`。派生列：`total_quantity`（订单行 SUM）、`fulfilled_quantity`（有效关系数）、`historical_quantity`（已寄出寄送产品数）。

#### 正常流程
组合条件查询 → 派生数量列随主查询计算 → 分页返回。

#### 异常流程
非法 orderType/customerType/status/fulfillment 或日期起>止 → ServiceException（orderTypeInvalid 等）；无匹配返回空列表。

#### 条件分支
履约进度 unshipped（有效交付=0）/partial（0<交付<订购）/completed（交付>=订购，含 0 行订单边界）；status active/cancelled。

#### 参数校验
枚举白名单校验；日期范围先后校验；关键词 trim。

#### 权限校验
`prop:order:page`。

#### 数据变化
无（纯查询）。

#### 第三方依赖
无。

#### 错误处理
ServiceException 由框架转错误响应。

#### 涉及代码文件
- `ruoyi-admin/.../prop/PropOrderController.java`（list）
- `ruoyi-prop/.../order/service/impl/PropOrderServiceImpl.java:73,456`
- `ruoyi-prop/src/main/resources/mapper/prop/order/PropOrderMapper.xml:37-58`

#### 涉及方法
list、normalizeQuery、selectOrderList

### 功能002：订单详情与操作记录

#### 入口
列表“查看详情”或保存成功后跳转（`views/prop/order/detail.vue`）。

#### Controller
`detail`（`/{orderId}`）、`operations`（`/{orderId}/operations`，先 `requireOrderExists`，再分页 10 条）。

#### Service
`detail`（:82）：`requireOrder` 不存在抛 `prop.order.notFound`；`loadAggregate(order,true)` 追加订单行、寄送列表（`shipments.orderShipments`）、产品关系（`shipments.orderRelations`，含 current/ended/unlink/recovery 文案）。

#### 数据访问
寄送列表 `PropShipmentMapper.xml listOrder`：`deleted_time IS NULL AND status IN ('preparing','shipped')`，按 `COALESCE(confirmed_time,create_time) DESC` 排序（已删准备不回显）。操作记录 `selectOperations` 按 `operation_time DESC, operation_id DESC`。

#### 正常流程
返回订单+行+寄送+关系+快照解析后的聚合对象。

#### 异常流程
订单不存在 → notFound（业务异常文案）。

#### 涉及代码文件
- `PropOrderServiceImpl.java:82,95`
- `PropShipmentService.java`（orderShipments/orderRelations）
- `mapper/prop/shipment/PropShipmentMapper.xml`（listOrder、orderRelations）

#### 涉及方法
detail、operations、requireOrderExists、orderShipments、orderRelations

### 功能003：新建订单（含编号与幂等）

#### 入口
列表“新建订单” → `views/prop/order/form.vue`。

#### Controller
`POST /prop/order`，`businessWrite` 捕获 ServiceException 返回 error(code 默认 409)。

#### Service
`create`（:102）→ `createInTransaction`（:120）：
1. `normalizeCommand(create=true)`（:380）：requestId 必须为小写 UUID；受注日/订单类型（sale|rental|replacement）/客户区分（direct|agency）必填；客户订单号≤100、备注≤1000；订单行非空；逐行产品名称必填、数量校验（`hasInvalidSubmittedQuantity` 拦截非数字/小数，null → quantityRequired，<=0 → quantityPositive）；名称集合必须唯一（sameProductName）；行 lineId 去重。
2. `validateEnabledProductName`（:449，:131 调用）：第一行名称必须在启用字典项内且 productNameId 匹配。
3. `applyCommand`（:287）：三方主体/地址/联系人应用与快照（keep/select/copyOrdering 模式），`validateDeliverySnapshot`。
4. `assignNumber`（:466）：按当前年 `prop_fulfillment_sequence`（scope='order'）FOR UPDATE 锁序列；未配置且无序列行报错 sequenceUnconfigured；lastUsed>=9999 报错 sequenceExhausted；前缀 sale→I、rental→R、replacement→D，格式 `前缀+YY+NNNN`；同年共用序列。
5. 插入订单（status=active、revision=1）、逐行插入订单行、写 `create` 操作记录（含总数量）。
6. `completeCreateRequest` 登记幂等结果，失败报错回滚。

幂等：requestId 已存在时 `replayOrderCommand`——payloadHash 一致返回原结果；不一致 → 4601；原结果缺失 → 4602；处理中 → 4603。并发 DataIntegrityViolationException 后重读胜者重放。

#### 数据访问
prop_order、prop_order_line、prop_order_operation、prop_order_create_request、prop_fulfillment_sequence。

#### 异常流程
必填缺失/数量非法/名称不一致/名称停用/主体缺失/地址归属不符/序列耗尽，均抛 ServiceException 并回滚，不建立订单。

#### 数据变化
新增订单（active）+订单行+创建操作记录+幂等登记；编号取得后终身不变（编辑/取消不更换）。

#### 涉及代码文件
- `PropOrderServiceImpl.java:102-145,287-455,466-483`
- `mapper/prop/order/PropOrderMapper.xml`（insertOrder、insertLine、lockSequence、updateSequence）

#### 涉及方法
create、createInTransaction、normalizeCommand、validateEnabledProductName、applyCommand、assignNumber、saveNewLines、insertOperation

### 功能004：编辑订单

#### 入口
详情“编辑订单”（仅有效订单显示入口，前端 detail.vue）。

#### Controller/Service
`PUT /prop/order/{orderId}` → `update`（:147，@Transactional）：
1. normalizeCommand(create=false)；`selectOrderForUpdate` 行锁。
2. 订单不存在 → notFound；非 active → cancelledCannotEdit；revision 不一致 → revisionConflict。
3. `validateEditedProductNames`（:417）：行归属校验；历史多名称订单（legacy）禁止改名、禁止删行、新增行名称必须在旧名称集合内；单名称订单要求新名称集合唯一，名称变化时校验启用字典项。
4. 订单总数量 < 当前有效交付数（`selectValidDeliveryForUpdate` 计数）→ quantityBelowFulfilled（按订单总量校验，非按行）。
5. `applyCommand` 覆盖快照字段；`updateOrder` 条件更新（revision 乐观锁，影响行!=1 → revisionConflict）。
6. `saveLineDiff`：新增行 insert、保留行 update（影响行!=1 → lineDeleted）、移除行 deleteLines（数量不符 → lineDeleteIncomplete）。
7. 写 `edit` 操作记录；总数量变化时描述含前后数量。

#### 异常流程
revision 冲突、订单已取消、数量低于有效交付、行被并发删除等，均回滚。

#### 数据变化
更新订单当前资料与行，revision+1，新增编辑操作记录；不改写已确认寄送与既有文件。

#### 涉及代码文件
- `PropOrderServiceImpl.java:147-172,417-447,486-505`

#### 涉及方法
update、validateEditedProductNames、saveLineDiff

### 功能005：取消订单

#### 入口
详情“取消订单”弹窗（detail.vue:423-451，要求填写取消原因；`fulfilledQuantity>0` 时显示警告 `order.feedback.cancelShippedImpact`）。

#### Service
`cancel`（:174，@Transactional）：
1. 原因 trim 后为空 → cancelReasonRequired；长度>1000 → cancelReasonTooLong。
2. 行锁读订单；不存在 → notFound；已 cancelled → 幂等返回 alreadyCancelled=true；revision 不一致 → revisionConflict。
3. `shipments.releaseCancelledOrder(orderId)`（PropShipmentService.java:343）：锁定该订单全部准备中寄送及其产品，释放产品占用（reservation）；不删除寄送、不动已寄出与关系。
4. `cancelOrder` 条件更新状态为 cancelled（写原因/操作人/时间），影响行!=1 → revisionConflict。
5. 写 `cancel` 操作记录（含原因）。

#### 数据变化
订单状态 active→cancelled；准备中寄送产品占用释放；历史出货与产品关系保留。

#### 边界
取消后新建寄送（active 校验）、确认寄出、文件生成（preparing 或 batch 需 active）、编辑均被服务端拒绝。

#### 涉及代码文件
- `PropOrderServiceImpl.java:174-195`
- `PropShipmentService.java:343-349`

#### 涉及方法
cancel、releaseCancelledOrder

### 功能006：订单就地维护客户地址/联系人

#### 入口
订单表单納品先下地址卡/联系人卡弹窗（form.vue）。

#### Service
- `createAddress`（:197）：requestId 幂等（prop_order_customer_create_request，payloadHash 含资源类型+主体+字段）；`validateAddress`（:673）：邮编必填且必须 7 位数字、地址 1 必填（≤500）、地址 2 ≤500；锁主体（requireSubjectForUpdate）；sortOrder=max+1；插入 prop_customer_address。
- `updateAddress`（:231）：锁主体与地址；地址不属于该主体 → addressSubjectMismatch；同样 validateAddress。
- `createContact`（:243）：幂等；`validateContact`（:674）：姓名必填（≤200）、职称≤200、电话/FAX≤100、邮箱≤320、备注≤500；要求地址归属该主体（requireOwnedAddress）；插入 prop_customer_contact。
- `updateContact`（:277）：归属校验+validateContact。

#### 数据变化
直接更正客户主档（地址/联系人），与订单表单是否最终提交无关。

#### 涉及代码文件
- `PropOrderServiceImpl.java:197-285,673-674`

#### 涉及方法
createAddress、updateAddress、createContact、updateContact、validateAddress、validateContact

### 功能007：解除产品关联

#### 入口
订单详情产品关联当前行“解除关联”（detail.vue:387-396 弹窗要求选择基准处理方式 keep/clear）。

#### Controller/Service
`POST /prop/order/{orderId}/relations/{relationId}/release` → `PropOrderRelationService.release`（PropOrderRelationService.java:34）：
1. 事务内锁订单；读关系（owned 校验：不存在 404、不属本订单 409）。
2. 锁来源寄送：必须属本订单、status=shipped、未删除，否则 relationSourceInvalid。
3. `lockOrderQuantities`+`lockValidRelations` 后锁关系行；productId/shipmentId 与初读不一致 → 4601 relationIdentityChanged；关系已结束 → 4601 relationAlreadyEnded。
4. 锁产品：不存在或已删除 → productMissingOrDeleted；该产品当前关系必须恰为本条且 deliveryValid=1，否则 relationInconsistent；产品基准三字段（firstShipmentDate/lifecycleBaseMonth/baselineShipmentId）必须全有或全无，否则 productBaselineIncomplete。
5. `command.baselineAction` 必须为 keep 或 clear，否则 baselineActionRequired。
6. `relations.end`：结束关系（记录结束时间/操作人/原因 unlink，delivery_valid 置 0）；clear 时 `clearBaseline` 清产品基准三字段。

#### 异常流程
见上；全部回滚。

#### 数据变化
关系结束（历史保留）；有效交付数随之减少（派生）；clear 时清除产品首次出货/基准月。

#### 涉及代码文件
- `ruoyi-prop/.../order/service/PropOrderRelationService.java:34-75`
- `mapper/prop/order/PropOrderRelationMapper.xml`

#### 涉及方法
release、owned、currentForRecovery（供受付回收复用）、lockRecoverySource、endForRecoveryInTransaction

### 功能008：新建寄送准备

#### 入口
订单详情“发货” → 寄送抽屉（`views/prop/shipment/ShipmentDrawer.vue`）。

#### Service
`PropShipmentService.create`（PropShipmentService.java:70）：
1. requestId 必须 UUID；已存在同 requestId → `replay`（内容哈希不符 4601；原准备已删 4602；处理中 4603）。
2. 先插入身份行（仲裁先于业务校验），锁订单：不存在 → notFound；非 active → orderCancelled；刷新订购/履约数量后，总量<=已履约 → orderFullyShipped（已发足订单禁止新建寄送）；订单 revision 不一致 → orderRevisionChanged。
3. `validateCreate`：orderRevision>=1、shipDate 必填、adoptedProductName≤200。
4. 采用产品名称：未提交且订单行名称唯一时自动取该行名称。
5. 快照：订单号、下单方快照、收货快照（recipient+address+contact 来自订单快照）。
6. SH 编号：`prop_fulfillment_sequence` scope='shipment' 独立序列（与订单 scope='order'、返送序列互不共用），格式 `SH+YY+NNNN`，年内连号、年度重置；used>=9999 → sequenceExhausted。

#### 数据变化
新增 prop_shipment（status=preparing）+快照+序列推进。

#### 涉及代码文件
- `PropShipmentService.java:70-145`
- `mapper/prop/shipment/PropShipmentMapper.xml`（initializeSequence/lockSequence/advanceSequence，:39-41）

#### 涉及方法
create、replay、validateCreate、createHash

### 功能009：寄送字段保存

#### Service
`save`（:147）：锁上下文（订单+寄送）；准备中要求订单 active（writable）；revision 校验；saveMode 必须 auto/explicit；fields 非空、无重复且⊆{carrier,shipDate,boxCount,trackingNumbers}；explicit 且清单为空 → productRequired（auto 模式允许无产品保存）。
- carrier：仅 yamato/sagawa，可暂缺；已寄出时含 carrier 字段且结果为空 → carrierRequired（已寄出不可清空快递公司）。
- shipDate：提交值必填；已寄出且改 shipDate 时逐产品 `correctBaseline` 更正首次出货/基准月（先 requireBaselineConsistent）。
- boxCount：null 允许；否则必须正整数。
- trackingNumbers：`tracking`（:422）trim、去空、重复 → trackingDuplicate。

#### 数据变化
更新寄送字段+revision+1；只记录最后修改人/时间，无修改历史。

#### 涉及代码文件
- `PropShipmentService.java:147-186`

#### 涉及方法
save、applyFields、tracking

### 功能010：寄送产品添加/移除

#### Service
`addProducts`（:188）：准备中+revision；`numbers`（:412）解析：单个编号（≤64 字符）或连续范围（前缀+起止；起止必填纯数字、等长、总长≤64；起>止 → rangeReversed；数量>100 → rangeTooLarge）。逐编号资格校验 `productReason`（:373）：不存在/已删除 → manufacturingNoMissing；已报废 → productScrapped；首次质检标记=0 → initialInspectionNotPassed、非 1 → inspectionMarkerInvalid；存在当前订单关系 → productAlreadyLinked；已在清单 → productAlreadyListed；被其他寄送占用 → productReservedElsewhere；超出订单剩余可发 → quantityExceedsRemaining。合格产品写入 `prop_shipment_reservation` 占用 + `prop_shipment_product`（含规格快照与采用产品名称）。部分失败不整体回滚：返回 added 列表与 failures（编号+原因）。
`removeProduct`（:230）：准备中+revision；产品必须属本寄送；`mapper.release` 释放占用后删除清单行。

#### 数据变化
准备中清单与占用增删；不产生寄出事实。

#### 涉及代码文件
- `PropShipmentService.java:188-240,373-384,412-421`

#### 涉及方法
addProducts、removeProduct、numbers、productReason

### 功能011：删除准备中寄送

#### Service
`delete`（:242）：非 preparing → shippedCannotDelete（服务端禁止已寄出删除）；revision 校验；锁全部产品后：`clearFiles`（删除全部文件/邮件版本）、`release`（释放占用）、`clearProducts`、`tombstone`（deleted_time 软删）。

#### 数据变化
准备记录软删除，其清单、占用、全部文件版本（含保障确认书）一并删除，不保留业务历史。

#### 涉及代码文件
- `PropShipmentService.java:242-253`

#### 涉及方法
delete

### 功能012：确认寄出

#### Service
`confirm`（:255，REQUIRES_NEW 邮件事务上下文 mailTransactions）：
1. 锁上下文；已 shipped → 直接返回现状（幂等，先于 revision/内容校验）。
2. preparing+revision；清单为空 → productRequired；清单数量>剩余可发 → quantityExceedsRemaining。
3. 收货快照完整性：收货单位名、邮编、地址 1 任一缺失 → deliveryIncomplete。
4. carrier 为空 → selectCarrierInSettings；shipDate 为空 → shipDateRequired；保存本次运单号（去重）。
5. 逐产品：资格复核、reservation 必须属本寄送（reservationMismatch）、基准一致性校验。
6. 逐产品 `insertRelation` 建立产品订单关系（delivery_valid=1）+ `adoptFirst` 写产品首次出货日/生命周期基准月/基准寄送。
7. 寄送置 shipped、确认人/时间；`createMail` 生成邮件 v1（冻结正文、快照 JSON、模板 order-shipment-mail-v1）；释放占用。

#### 数据变化
寄送事实+产品订单当前关系+邮件 v1+履约数（派生）增加+首次出货基准写入；清单冻结。

#### 涉及代码文件
- `PropShipmentService.java:255-291,318-342`

#### 涉及方法
confirm、createMail

### 功能013：寄送通知邮件再生成

#### Service
`generateMail`（:293）：requestId 幂等（同 requestId 重放原版本）；必须已寄出（confirmBeforeMail）；生成新版本号（nextFileVersion）的 mail 文件，快照含运单号、产品、颜色、模板正文；历史版本不覆盖。

#### 涉及方法
generateMail、createMail

### 功能014：寄送文件生成（面单/纳品书/保障确认书）

#### 入口
寄送抽屉文件区（ShipmentDrawer.vue:266-286）与文件弹窗（ShipmentDocumentModal.vue）。

#### Service
`PropShipmentDocumentService`（PropShipmentDocumentService.java）：
- `prepare`（:108）：类型校验；`qualify`（:90）：寄送须属订单、状态 preparing/shipped；preparing 要求订单 active（已取消订单的准备中寄送不可生成文件；已寄出不受此限）；返回默认值+sourceToken。
- `create`（:139）：requestId 幂等重放；`command` 校验提交字段集合与 sourceToken（内容已变 → “印刷内容が変更されています”）；`products`（:58-63）要求清单非空且无重复产品；PDF（deliveryNote/guarantee）份数强制 1；waybill 份数 1-99（`copies`）；版本号按类型递增（documentNextVersion）；渲染后保存 prop_shipment_file 版本行（快照冻结）。
- `result`（:152）：按 requestId 查 saved/unknown。
- `content`（:154）：按冻结快照重渲染输出 xlsx（waybill）/pdf。

#### 数据变化
仅新增文件版本；不登记寄出、不改关系与履约。

#### 涉及代码文件
- `ruoyi-prop/.../shipment/document/PropShipmentDocumentService.java:58-159`
- 渲染器：OrderDeliveryNoteRenderer、OrderGuaranteeRenderer、OrderWaybillWorkbookWriter、OrderShipmentMailRenderer

#### 涉及方法
prepare、create、result、content、products、command、snapshot

### 功能015：订单批量打印面单

#### 入口
订单列表“批量打印面单” → `views/prop/order/batchPrint.vue`（菜单 perms prop:orderBatchPrint:page）。

#### Service
- `preparations`（:156）：`batchPreparations` SQL 仅取 `status='preparing' AND deleted_time IS NULL AND o.order_status='active'` 的订单来源寄送；附收货快照与产品。
- `batchPrepare`（:165）：carrier 必须 yamato/sagawa；逐笔 qualify(batch=true)（必须 preparing 且订单 active）。
- `batchCreate`（:178）：requestId+批次清单 manifest 幂等；逐笔按 items[i].copies 生成一个 waybill 版本（一笔一版本，N 张为复印）；`documentCarrier` 以 revision 条件更新把每笔快递公司改写为所选公司（影响行!=1 → 报错）；批次内容不符 → 4601；部分结果缺失 → 4603。
- `batchResult`（:192）/`batchContent`（:194）：按 manifest 重放查询与打包下载（order-waybills-{fileId}.xlsx）。

#### 数据变化
为每笔所选准备中寄送各新增一个面单版本并回写快递公司；不登记寄出、不改清单、不建关系。

#### 涉及代码文件
- `PropShipmentDocumentService.java:156-195`
- `mapper/prop/shipment/PropShipmentMapper.xml`（batchPreparations、documentCarrier）

#### 涉及方法
preparations、batchPrepare、batchCreate、batchResult、batchContent

## 4. 代码行为分支清单

| BR-ID | 行为描述 | 依据 |
|---|---|---|
| BR-001 | 关键词仅匹配注文管理番号/客户订单号/下单方/納品先快照名，不匹配产品名称与颜色 | PropOrderMapper.xml:41-46 |
| BR-002 | 制造番号部分匹配反查，覆盖未删除寄送（含准备中）产品 | PropOrderMapper.xml:47 |
| BR-003 | 履约进度三态筛选按 delivery_valid=1 关系数与订购总数比较 | PropOrderMapper.xml:51-53 |
| BR-004 | 查询枚举非法/日期起>止 → 业务异常 | PropOrderServiceImpl.java:456-464 |
| BR-005 | 预计发货日范围排除未填（NULL）订单；受注日含边界 | PropOrderMapper.xml:54-57 |
| BR-006 | 列表与操作记录固定每页 10 条 | PropOrderController.java（list、operations） |
| BR-007 | 订单不存在 → prop.order.notFound | PropOrderServiceImpl.java:95-98 |
| BR-008 | 创建幂等：requestId+payloadHash 重放，4601/4602/4603 冲突语义 | PropOrderServiceImpl.java:102-118 |
| BR-009 | 注文管理番号 [I/R/D]+YY+NNNN 年度共用序列，行锁；耗尽/未配置报错 | PropOrderServiceImpl.java:466-483 |
| BR-010 | 三方主体/地址/联系人以 JSON 快照保存，主档变更不影响订单 | PropOrderServiceImpl.java:317-379 |
| BR-011 | 配送地址必须属納品先、联系人必须属配送地址，不符 409 | PropOrderServiceImpl.java:343-378 |
| BR-012 | 产品名称必须为启用字典项（新建及编辑更名时） | PropOrderServiceImpl.java:131,445,449-453 |
| BR-013 | 新建强制行名称一致；历史多名称订单禁止改名/删行/异名新增 | PropOrderServiceImpl.java:412-447 |
| BR-014 | 数量校验：非数字/小数/空/<=0 分类报错；总量 addExact 溢出保护 | PropOrderServiceImpl.java:396-410 |
| BR-015 | 字段长度限制（客户订单号100/颜色500/备注1000/地址/联系人各限长） | PropOrderServiceImpl.java:388-389,673-674 |
| BR-016 | 编辑乐观锁 revision；已取消不可编辑；总量≥有效交付（按订单总量非按行） | PropOrderServiceImpl.java:147-160 |
| BR-017 | 编辑行差异保存；数量变化写前后数量操作记录 | PropOrderServiceImpl.java:161-171,486-505 |
| BR-018 | 取消原因必填≤1000；重复取消幂等返回；乐观锁 | PropOrderServiceImpl.java:174-195 |
| BR-019 | 取消同事务释放准备中寄送产品占用，不删寄送/关系/历史 | PropShipmentService.java:343-349 |
| BR-020 | 已取消订单禁止编辑/新建寄送/确认/准备中文件生成 | PropOrderServiceImpl.java:151；PropShipmentService.java active/writable；PropShipmentDocumentService.java:90-97 |
| BR-021 | 就地新增地址：邮编必填且 7 位数字、地址 1 必填；幂等；sortOrder 递增 | PropOrderServiceImpl.java:197-230,673 |
| BR-022 | 就地编辑地址：主体归属校验（addressSubjectMismatch） | PropOrderServiceImpl.java:231-241 |
| BR-023 | 就地新增/编辑联系人：姓名必填、地址归属校验、幂等 | PropOrderServiceImpl.java:243-285,674 |
| BR-024 | 解除关联必须选择 baselineAction=keep/clear（代码要求输入，Spec 未定义） | PropOrderRelationService.java:62-63 |
| BR-025 | 解除：已结束→4601；多当前关系/不一致→409；身份变化→4601 | PropOrderRelationService.java:48-61 |
| BR-026 | 解除效果：delivery_valid=0、结束原因 unlink、记录结束时间/人；clear 清产品基准三字段 | PropOrderRelationService.java:64-68 |
| BR-027 | 寄送创建幂等重放；4601 内容不符/4602 原准备已删/4603 处理中 | PropShipmentService.java:70-90,123-133 |
| BR-028 | SH+YY+NNNN 独立年度序列（scope=shipment，与订单/返送互不共用） | PropShipmentService.java:104-113；PropShipmentMapper.xml:39-41 |
| BR-029 | 新建寄送前置：订单有效、revision 匹配、剩余可发>0（已发足拒绝）、shipDate 必填 | PropShipmentService.java:84-94,140-144 |
| BR-030 | 寄送创建时快照订单收货资料（单位/地址/联系人），后续主档变更不影响 | PropShipmentService.java:95-103 |
| BR-031 | 字段保存白名单+saveMode；explicit 需≥1 台产品；auto 允许无产品 | PropShipmentService.java:147-161 |
| BR-032 | carrier 仅 yamato/sagawa；已寄出不可清空 carrier | PropShipmentService.java:163-167,159 |
| BR-033 | 已寄出修改 shipDate 同步更正产品首次出货/基准月（correctBaseline） | PropShipmentService.java:168-175 |
| BR-034 | boxCount 可空或正整数；运单号可空/多个/去重 | PropShipmentService.java:169-175,422-426 |
| BR-035 | 产品录入：单个≤64 字符或连续范围（纯数字等长、起≤止、≤100） | PropShipmentService.java:412-421 |
| BR-036 | 产品资格：存在未删/未报废/首检通过/无当前订单关系；逐条失败原因返回，部分成功不回滚 | PropShipmentService.java:188-229,373-384 |
| BR-037 | 产品占用 reservation 机制，准备中独占 | PropShipmentService.java:215,373-384 |
| BR-038 | 移除产品：准备中+revision+属本寄送，释放占用 | PropShipmentService.java:230-240 |
| BR-039 | 删除准备：软删+级联清文件/清单/占用；已寄出服务端禁止删除 | PropShipmentService.java:242-253 |
| BR-040 | 确认前置：≥1 台、不超剩余、收货快照完整、carrier 已选、shipDate 必填 | PropShipmentService.java:262-269,388-391 |
| BR-041 | 确认幂等：已寄出重复确认直接返回现状 | PropShipmentService.java:259-260 |
| BR-042 | 确认效果：shipped+关系建立+首次出货/基准月写入+清单冻结+释放占用 | PropShipmentService.java:275-290 |
| BR-043 | 确认自动生成寄送通知邮件 v1（冻结正文与快照） | PropShipmentService.java:283-287,318-342 |
| BR-044 | 邮件再生成：仅已寄出、requestId 幂等、版本递增不覆盖 | PropShipmentService.java:293-316 |
| BR-045 | 文件生成需清单非空且不重复；PDF 仅 1 部；waybill 份数 1-99 一版本 | PropShipmentDocumentService.java:58-63,121-123 |
| BR-046 | sourceToken 防内容过期；prepare/create/result/content 四段式 | PropShipmentDocumentService.java:108-159 |
| BR-047 | 文件版本按类型递增、快照冻结、历史不覆盖；准备删除时随删 | PropShipmentDocumentService.java:139-151；PropShipmentService.java:249 |
| BR-048 | 已取消订单：准备中寄送不可生成文件；已寄出仍可生成 | PropShipmentDocumentService.java:90-97 |
| BR-049 | 批量打印候选仅准备中+未删除+有效订单来源寄送 | PropShipmentMapper.xml（batchPreparations） |
| BR-050 | 批量打印：carrier 必选；逐笔一版本；revision 条件回写快递公司；manifest 幂等 | PropShipmentDocumentService.java:178-189 |
| BR-051 | 权限：订单/寄送共用 prop:order:page；批量打印 prop:orderBatchPrint:page；无只读角色区分 | 各 Controller @PreAuthorize |
| BR-052 | 并发控制：订单行锁→寄送锁→产品升序锁的固定锁序；序列行锁；关系锁 | PropShipmentService.java lockContext/release；PropOrderRelationService.java:34-75 |

## 5. 无法确认的代码行为

1. 前端列表“剩余可发”是否对负数做防负展示：后端派生列可能出现 fulfilled>total（解除前追加发货等场景），`detail.vue/index.vue` 未逐行确认取 max(0,...)（UNKNOWN）。
2. 前端“請求書先与下单方不同”提示的实际文案与触发时机（form.vue:149-155 存在 alert，文案以 i18n 资源为准，未核对日/中文案文件）。
3. 批量打印页面“修改工作单”打开抽屉后的刷新时机属纯前端行为，未逐行核对。
4. 邮件模板配置来源（`configuration(mapper, PARAMETER)` 读取的模板配置表）内容属部署数据，无法确认实际正文。
5. 看板统计（REQ-002 等）对订单派生列的消费属看板模块范围，本文不判定。
6. 历史 SHP 形态寄送号“按原值保留”：代码不做迁移/重编号，但历史数据是否存在未确认（UNKNOWN）。

## 6. 总体行为结论

1. 订单管理实现了订单全生命周期（新建→编辑→取消）与寄送全流程（准备→产品清单→文件→确认寄出→有限维护/删除准备），并有完整幂等（requestId+payloadHash）、乐观锁（revision）与行级锁序设计。
2. 编号体系与需求一致：订单 [I/R/D]+YY+NNNN 年度共用序列，寄送 SH+YY+NNNN 独立年度序列。
3. 客户/配送资料全程快照化，主档变更不回写历史单据；就地维护直接写客户主档。
4. 履约口径由数据库派生（订单行总数、delivery_valid=1 关系数、已寄出产品数），无冗余状态字段。
5. 与 Spec 的显著差异：解除产品关联要求选择基准处理方式（keep/clear），Spec（REQ-047）声明“不要求选择原因”且未定义该输入；已发足订单禁止直接新建寄送（需先编辑增加数量）。
6. 权限模型为单权限页面级（prop:order:page）+批量打印权限，无细粒度操作权限与只读角色。
