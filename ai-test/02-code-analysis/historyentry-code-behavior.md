# Code Behavior Model

- 分析时间：2026-10-29（CST）。
- 分析范围：`E:\proptest\prop_new` 当前工作树，HEAD `321d461`；重点为 FEAT-20 历史客户与订单补录，以及其订单、寄送、文件、通知、生命周期、前端保护边界。
- 分析方法：只依据实际 Java、MyBatis XML、SQL、Vue、前端规则模块与测试文件判断；不根据方法名、注释或需求反推实现。
- 需求基线注意事项：本模块只使用 `E:\proptest\spec\spec10-28\spec\docs\features\FEAT-20-history-entry\spec.md`，并同时核对同目录 `validation.md`（H01～H92）、`product-judgment-rules.md`，以及 `E:\proptest\spec\spec10-28\spec\docs\baseline\business-time\spec.md`。以下简称“spec10-28 最新需求”。
- 旧基线说明：`E:\proptest\ai-test\01-requirement\requirement-baseline.md` 的 REQ-001～REQ-106 不包含 FEAT-20，本次不以该旧清单作为本模块需求条目。
- 一致性核对：上述 spec10-28 文件与 `prop_new\docs\spec` 对应文件逐行一致；本文判断仍以 spec10-28 为需求来源。

## 1. 系统业务模块

历史补录不是一条新的“正常订单/寄送”链路，而是一套受限的补录闭环：

1. **历史客户补录**：客户管理页新增“过去客户公司/支店”入口，原编号必填，单次只保存一个主体及其地址、联系人。
2. **历史订单建立**：独立页面填写原订单号、受注日、三方客户、产品明细与每台出货日；服务端生成内部订单 ID，不消费年度订单号序列。
3. **历史产品与部件**：可新建产品或引用已有产品；新建产品同时建立 body（衣体）绑定，其他四槽位可选；未知部件/固件允许为空。
4. **出货日与首次基准**：按每台真实出货日分组生成 historical 寄送；首次/再次出租分别建立、前移或保留首次日期、基准月和首次来源。
5. **历史质检与下游识别**：无既有质检时，销售、首次租赁、代替品自动写 historical 质检并置产品首检标记；生命周期、通知、生产履历识别历史来源。
6. **幂等与结果恢复**：订单请求使用 `requestId + payloadHash` 固定结果；并发同请求重放胜者；结果未知时只能在当前页查询或原样重试。
7. **批量粘贴与统一工具**：前端规则模块负责制造编号粘贴、批量补衣体规格、批量补空白出货日。
8. **历史来源保护**：历史订单/寄送不得走普通物流写、删除、文件/邮件生成和取消；订单编辑只开放白名单字段。
9. **正常业务回归边界**：历史客户编号参与现有编号空间；正常新增、生产、质检、寄送沿用原逻辑，历史补录不写旧受付、旧作业、旧文件。

## 2. API 清单

| 方法 | 路径 | Controller 方法 | 权限表达式 | 主要结果 |
|---|---|---|---|---|
| GET | `/prop/history-entry/catalog` | `PropHistoryEntryController.catalog` | `prop:historyEntry:page`（类级） | 对外产品名称、部件资料及版本、传感器固件字典 |
| GET | `/prop/history-entry/products/lookup` | `product` | 同上 | 按制造编号查产品、当前绑定、质检、当前关系、基准前后预览及问题 |
| GET | `/prop/history-entry/parts/lookup` | `part` | 同上 | 按部件号查唯一部件及详情；重复/删除返回 409 |
| GET | `/prop/history-entry/requests/{requestId}` | `result` | 同上 | 返回 `notFound` 或 `completed + result`；哈希版本/结果缺失返回 4601/4602 |
| POST | `/prop/history-entry/orders` | `create` | 同上 | 原子创建历史订单；业务拒绝统一 409 + `errors[]` |
| POST | `/prop/customer/history/company` | `PropCustomerController.createHistoricalCompany` | `prop:customer:page` | 保存历史公司，返回 `subjectId/customerNo/subjectType` |
| POST | `/prop/customer/history/company/{companyId}/site` | `createHistoricalSite` | `prop:customer:page` | 在已保存公司下保存历史支店 |
| GET | `/prop/customer/selector/tree` | `selectorTree` | `prop:customer:page`、`prop:order:page`、`prop:historyEntry:page` 任一 | 客户选择树；历史订单页可只凭历史页权限读取 |
| GET | `/prop/customer/selector/{subjectId}/preview` | `selectorPreview` | 同上 | 客户地址/联系人选择数据；历史订单页可只凭历史页权限读取 |
| GET | `/prop/customer/list`、`/{subjectId}` | `list`、`detail` | `prop:customer:page` | 客户列表/完整详情；历史结果未知时按原号人工核对 |
| PUT | `/prop/customer/{subjectId}` | `update` | `prop:customer:page` | 完整编辑；服务端强制沿用原客户编号 |
| GET | `/prop/order/{orderId}` | 订单详情 | `prop:order:page` | 历史订单详情、历史寄送/关系只读展示 |

说明：历史订单页面本身不提供客户创建接口；客户创建仍走 `prop:customer:page`。历史订单用户即使没有客户页权限，也能通过 selector 读取已有客户，但不能调用客户新增/修改接口。

## 3. 业务功能

### 功能001：历史客户公司与支店补录

#### 入口

客户管理列表工具栏“历史公司新增”；公司行/详情内“历史支店新增”。路由与组件为 `views/prop/customer/index.vue`、`components/CustomerEditor.vue`。

#### Controller

`PropCustomerController.createHistoricalCompany`、`createHistoricalSite`。两者均为 `prop:customer:page`，不新增按钮权限。

#### Service

`PropCustomerServiceImpl.createHistoricalCompany`（L97-105）、`createHistoricalSite`（L109-123）、`validateHistoricalCreate`（L125-164）、`validateHistoricalSubject`（L166-170）。

#### 数据访问

`insertAggregateWithNumber` 插入主体、地址、联系人；`lockCustomerNumber` 锁定客户编号序列；数据库客户编号唯一约束兜底。

#### 正常流程

1. 公司：接收无 `subjectId` 的单主体，强制 `subjectType=company`，原客户编号必填，保存公司及可选地址/联系人。
2. 支店：路径 `companyId` 必须指向已保存、类型为公司且有编号的主体；支店 `defaultCustomerType` 被置空，继承公司区分。
3. 地址可为零个或多个；每个地址邮编 7 位半角数字、地址 1 必填；联系人姓名必填，其余文本可空。
4. 保存成功返回主体 ID、原编号和类型；客户列表刷新后可进入同一详情/完整编辑。

#### 异常流程

- 主体为空、带 `subjectId`、类型不符、公司命令带 `companyId`、支店命令无 `companyId` 或路径与载荷父级冲突：400，字段定位。
- 历史创建携带 `sites`、已有地址 ID、已有联系人 ID：400，整次单主体请求拒绝。
- 客户编号为空、超过 64 码点、`C+数字` 超过 `Long.MAX_VALUE-1`：400。
- 支店父级不存在、非公司或父级无编号：400。
- 数据库同号唯一冲突：历史分支返回 409，提示原编号已存在，不自动合并/覆盖。

#### 条件分支

- `company` 与 `site` 分开校验父级字段。
- 历史创建与正常创建共用聚合插入，但历史分支保留手填编号，正常分支使用 `C%05d` 自动号。
- 普通编辑 `update` 在 L195 强制 `submitted.setCustomerNo(current.getCustomerNo())`，实现编号不可改。

#### 参数校验

- 编号必填、≤64；名称 ≤200；存储路径 ≤500；地址 1/2 ≤500；联系人姓名/职称 ≤200、电话/传真 ≤100、邮箱 ≤320、备注 ≤500。
- 邮编 `[0-9]{7}`；地址 1 非空；联系人姓名非空。

#### 权限校验

仅 `prop:customer:page`。历史订单页权限不能创建/维护客户。

#### 数据变化

插入 `prop_customer_subject`、`prop_customer_address`、`prop_customer_contact`；不写订单、不写历史请求登记。

#### 第三方依赖

无。

#### 错误处理

`ServiceException` 统一转为 HTTP 400/409；事务 `rollbackFor=Exception.class`，单主体失败不留下部分地址/联系人。

#### 涉及代码文件

- `prop_new\ruoyi-admin\src\main\java\com\ruoyi\web\controller\prop\PropCustomerController.java`
- `prop_new\ruoyi-prop\src\main\java\com\ruoyi\prop\customer\service\impl\PropCustomerServiceImpl.java`
- `prop_new\ruoyi-ui\src\views\prop\customer\index.vue`
- `prop_new\ruoyi-ui\src\views\prop\customer\components\CustomerEditor.vue`

#### 涉及方法

`createHistoricalCompany`、`createHistoricalSite`、`validateHistoricalCreate`、`validateHistoricalSubject`、`insertAggregateWithNumber`、`lockCustomerNumber`、`update`、`saveAddressDiff`、`saveContactDiff`。

### 功能002：历史订单页面与三方客户选择

#### 入口

订单管理菜单“過去の注文を登録”，组件 `views/prop/history-entry/index.vue`，API `src/api/prop/historyEntry.js`。

#### Controller

`PropHistoryEntryController` 类级 `prop:historyEntry:page`；客户选择读接口由 `PropCustomerController` 的 `selectorTree`、`selectorPreview` 提供。

#### Service

前端 `subjectSelected`、`useRecipient`、`customerTypeChanged`、`clearParty`、`clearAddress`、`openCandidates`；后端 `customerOrder`（L497-516）。

#### 数据访问

选择树读取客户主档；提交时对三个主体、配送地址、联系人分别 `select...ForUpdate`，并写入主体/地址/联系人 JSON 快照。

#### 正常流程

1. 下单方、納品先、請求書付款方可分别选公司/支店，允许三个不同主体。
2. 选择下单方时默认付款方同下单方；直贩默认納品先同下单方，代理则需另选。
3. 选择納品先后自动清除原地址/联系人；仅当納品先只有一个地址时自动选中该地址。
4. 提交时校验地址属于納品先、联系人属于地址，保存三方快照和配送地址/联系人快照。

#### 异常流程

- 三方主体任一为空/不存在：`CUSTOMER_INVALID`。
- 地址为空或不属于納品先：`order.deliveryAddressId`。
- 联系人不属于配送地址：`order.deliveryContactId`。
- 历史订单夹带客户创建内容/未保存客户：严格未知字段校验拒绝，不写客户。

#### 条件分支

- `customerType=direct` 时选择下单方会联带納品先；`agency` 时清空納品先等待另选。
- 变更納品先/地址分别清理失效地址、联系人，避免沿用旧选择。

#### 参数校验

主体 ID 必须 ≥1；地址/联系人必须存在；客户区分只允许 `direct/agency`。

#### 权限校验

历史页权限可读客户树与预览；客户创建仍要求客户页权限。前端客户管理跳转按钮仅在 `allowed('prop:customer:page')` 时显示。

#### 数据变化

订单写入三方主体 ID、三类快照、配送地址 ID/快照、可选联系人 ID/快照；不在本接口写客户主档。

#### 第三方依赖

无。

#### 错误处理

服务端错误定位到 `order`、`order.deliveryAddressId`、`order.deliveryContactId`；前端点击错误可聚焦对应区域。

#### 涉及代码文件

- `PropHistoryEntryController.java`
- `PropHistoryEntryService.java`
- `PropCustomerController.java`
- `ruoyi-ui\src\views\prop\history-entry\index.vue`

#### 涉及方法

`subjectSelected`、`useRecipient`、`openCandidates`、`selectCandidate`、`clearParty`、`clearAddress`、`customerOrder`、`subjectSnapshot`。

### 功能003：历史订单基础字段与产品明细校验

#### 入口

`POST /prop/history-entry/orders`。

#### Controller

`PropHistoryEntryController.create`；任何 `Rejected` 转为 409 + `errors` 数组。

#### Service

`PropHistoryEntryService.validate`（L453-495）、`preview`（L175-223）、`validateParts`（L405-423）。

#### 数据访问

产品名/资料/固件字典查询；产品、部件、绑定、订单、寄送、关系查询与锁定。

#### 正常流程

1. 原订单号必填 ≤64，允许重复，不写 `generated_no`。
2. 受注日必填且不晚于日本业务当天；类型 `sale/rental/replacement`；客户区分 `direct/agency`。
3. 订单行固定 1 行，颜色备注 ≤500；产品明细至少 1 台，`refKey` 与制造编号不重复。
4. 新建行必须无 `productId/expected` 且有 `body`；已有行必须带 `productId + expected` 且同一产品只出现一次。
5. 每台出货日必填且不晚于今天；制造编号 ≤64 码点。
6. 租赁行必须 `ongoing/ended`；非租赁不得携带 rentalState 或 `rental_repeat`。
7. 已结束必须填实际回收日，且 `shipDate <= actualRecoveryDate <= today`；仍在出租不得携带回收日。
8. 新建产品 body 不得带 `partId/firmwareId`；部件槽位只允许 `airbag/sensor/inflator_1/inflator_2`；部件号 ≤64，且不得与产品号或同单其他部件重复。

#### 异常流程

- 订单空、产品空、订单行数量不为 1：`FIELD_INVALID`。
- 受注日/出货日/回收日未来或缺失：`DATE_INVALID` / `RECOVERY_DATE_INVALID`。
- 受注日晚于出货日但未带 `dateOrderConfirmed=true`：`DATE_CONFIRM_REQUIRED`。
- 重复产品/重复 refKey/同号部件：`IDENTITY_CONFLICT`。
- 未知字段：`FIELD_INVALID`，用于拒绝前端夹带客户创建等内容。

#### 条件分支

- 新建/已有产品分支校验字段互斥。
- 租赁/非租赁、ongoing/ended、first/rental_repeat 分别进入不同校验。
- 出货日相同/不同由后续寄送分组处理。

#### 参数校验

所有长度按 Unicode 码点计算；日期为 `LocalDate`，不接受仅月份字符串；数量由服务端 `rows.size()` 计算，不接受手填。

#### 权限校验

`prop:historyEntry:page`。

#### 数据变化

此时仅校验，不写业务表；请求登记行在 `save` 开头先写，失败由事务回滚。

#### 第三方依赖

无。

#### 错误处理

一次可返回多条 `{path, rule, message}`；路径定位到 `order`、`order.lines[0]`、`products[refKey]` 或具体槽位。

#### 涉及代码文件

- `PropHistoryEntryService.java`
- `PropHistoryOrderCommand.java`、`PropHistoryProductCommand.java`
- `PropHistoryEntryMapper.xml`

#### 涉及方法

`validate`、`length`、`path`、`preview`、`validateParts`。

### 功能004：产品查号、采用与当前配置只读

#### 入口

历史订单页每行“查号/采用”按钮；`GET /products/lookup`。

#### Controller

`PropHistoryEntryController.product`。

#### Service

`lookup`（L131-147）、`expected`（L149-164）、`baselineBefore`（L166-173）、`preview`（L175-223）。

#### 数据访问

按制造编号查产品（含软删）、当前绑定、质检、当前关系；返回预期快照供提交时 `RECHECK`。

#### 正常流程

1. 查号返回 `found`、产品、`expected`、当前绑定、质检、当前关系、基准前后、预览动作与 issues。
2. 前端只有查号成功且无 issues 才能“采用”；采用后固定 `mode/productId/expected`。
3. 已有产品显示当前配置，不允许在本页提交 body/parts/storagePath，避免覆盖当前配置。
4. 新建产品只输入制造编号，body 号自动等于制造编号，另建产品身份与 M 号。

#### 异常流程

- 同号多条产品记录或已删除：`IDENTITY_CONFLICT`。
- 报废产品：返回 `PRODUCT_UNAVAILABLE` issue。
- 提交时 expected 快照不一致：`RECHECK`，要求重新查号。
- 已有产品携带 body/parts/storagePath：`CONFIG_READONLY`。

#### 条件分支

- `found=true` → 采用 `existing`；`found=false` → 采用 `create`。
- 改制造编号、改出货日、改交付方式、改出租状态会清除旧查号/采用结果，防止迟到响应回填。
- 查号请求带序号与页面 epoch，旧响应被丢弃。

#### 参数校验

制造编号必填 ≤64；查号可选 shipDate/deliveryMode/rentalState/externalDate，非法日期/模式由预览报错。

#### 权限校验

`prop:historyEntry:page`。

#### 数据变化

查号只读；采用仅改页面内存；保存时才写产品/绑定/关系。

#### 第三方依赖

无。

#### 错误处理

查号业务拒绝由 Controller 转 409；前端显示行级错误并阻止采用。

#### 涉及代码文件

- `PropHistoryEntryService.java`
- `PropHistoryEntryMapper.xml`
- `history-entry\index.vue`

#### 涉及方法

`lookup`、`expected`、`baselineBefore`、`numberChanged`、`invalidate`、`lookup`（前端）、`adopt`。
### 功能005：历史产品建档、部件绑定与占用校验

#### 入口

提交历史订单时，`mode=create` 的产品行进入产品/部件创建分支。

#### Controller

`POST /prop/history-entry/orders`。

#### Service

`save`（L266-398）、`creationParts`（L400-404）、`validateParts`（L405-423）。

#### 数据访问

`insertProduct`、`advanceSequence`、`insertPart`、`insertBinding`、`lockPart`、`selectActiveBindingByPart`、`productsByNumber`、`partsByNumber`。

#### 正常流程

1. 新建产品号/部件号全局不得已存在（包括软删记录）；同单产品号与部件号不得互相重复。
2. 产品生成 `M+6位` 序列号，`initialProductionInspectionPassed=0`，制造编号同时作为 active manufacturing no。
3. 产品 body 以制造编号建档，`partType=jacket`，建立产品 body 绑定。
4. 其他槽位可选：airbag→气囊、sensor→传感器、inflator_*→发生器；部件 `source_type='historical'`。
5. 资料/版本必须属于对应 `partType`；固件仅 sensor 允许且必须存在于字典。
6. 引用已有部件时必须与当前资料/版本/固件一致、未删除且无其他活动绑定。

#### 异常流程

- 新建号已存在：`IDENTITY_CONFLICT`，含软删记录。
- 资料/版本类型不匹配或固件用于非 sensor：`PROFILE_INVALID`。
- 已有部件资料不一致：`RECHECK`。
- 部件已被其他产品活动绑定：`PART_OCCUPIED`。
- 产品创建并发唯一键冲突：`writeAt` 识别约束后返回 `IDENTITY_CONFLICT`，整单回滚。

#### 条件分支

- `create` 分支创建产品；`existing` 分支只校验/引用，不允许 body/parts/storagePath。
- 已有部件与新建部件分支不同；未知部件/固件不创建占位记录。

#### 参数校验

槽位白名单；部件号必填 ≤64；body 禁止带 `partId/firmwareId`；同单部件号唯一。

#### 权限校验

`prop:historyEntry:page`。

#### 数据变化

写 `prop_product`、`prop_part_item`、`prop_binding`、生产事件；绑定 `active_slot_key`/`active_part_key` 保证活动槽位和部件唯一。

#### 第三方依赖

无。

#### 错误处理

创建/绑定唯一键失败映射到产品行或槽位路径；任何一次 `changed()!=1` 抛异常，事务整体回滚。

#### 涉及代码文件

- `PropHistoryEntryService.java`
- `PropHistoryEntryMapper.xml`
- `PropProductionMapper` / `PropProductionMapper.xml`

#### 涉及方法

`save`、`creationParts`、`validateParts`、`writeAt`、`insertProduct`、`insertPart`、`insertBinding`。

### 功能006：出货日分组、首次基准与租赁再次出租

#### 入口

每台产品填写 shipDate、deliveryMode；租赁填写 rentalState/actualRecoveryDate；需要时填写 externalFirstShipmentDate。

#### Controller

`POST /prop/history-entry/orders`；查询预览 `GET /products/lookup`。

#### Service

`preview`（L175-223）、`save` 的寄送/关系/基准分支（L363-393）、`discoverParents`（L425-436）。

#### 数据访问

锁定基准寄送订单/寄送、当前关系订单/寄送、订单量、有效关系、产品、部件；读写 `prop_product_first_shipment_fact`、`prop_product`、`prop_product_order_relation`。

#### 正常流程

1. 每台出货日必填且 ≤ 今天，不默认今天。
2. 同一 shipDate 的产品合并成一个 historical 寄送；不同日期生成多个寄送，仍同一订单事务。
3. **first**：本单出货日作为首次候选；无基准建立，基准更早则前移，同日保留原来源。
4. **rental_repeat**：本单不是首次；已有首次且本单不早于首次时保留原首次/月/来源；无首次或本单早于首次时，必须填真实外部首次日。
5. 外部首次日必须 ≤ 本单出货日且 ≤ 今天；只建立专用事实行，不伪造旧订单/旧寄送。
6. 基准动作由服务端计算：无基准 `establish`、候选早于现基准 `advance`、否则 `keep`。
7. ongoing 租赁/销售/代替品建立当前关系；ended 租赁保留 `delivery_valid=1` 但不占当前产品。

#### 异常流程

- shipDate 空/未来：`DATE_INVALID`。
- 基准四要素半缺：`BASELINE_INVALID`。
- 外部事实不存在、不属于本产品、日期不一致：`BASELINE_INVALID`。
- 寄送来源已删、非 shipped、日期不一致、`delivery_valid != 1`：`BASELINE_INVALID`。
- first 但已有更早首次：`FIRST_CONFLICT`。
- repeat 缺外部首次日、外部日 > 本单日或未来：`EXTERNAL_DATE_REQUIRED`。
- ongoing 但已有当前关系：`PRODUCT_OCCUPIED`；有阻断性在途作业：`PRODUCT_IN_OPERATION`。
- 已结束缺回收日/回收日早于出货/未来：`RECOVERY_DATE_INVALID`。

#### 条件分支

- 基准全空才允许 establish；非空必须完整一致。
- `current == candidate` 时 inherits 原来源，不换源。
- ended 跳过当前关系与在途作业拒绝，但仍拒绝删除/报废产品。
- 同单可混合 first 与 rental_repeat、ongoing 与 ended。

#### 参数校验

日期为具体日；非租赁禁止 repeat/rentalState；ongoing 禁止回收日；ended 必填回收日。

#### 权限校验

`prop:historyEntry:page`。

#### 数据变化

- `prop_shipment`：source_type=historical、status=shipped、无 SH 号、confirmed_by/confirmed_time=本次登记人/时刻。
- `prop_product_order_relation`：delivery_valid=1；ended 时 active_product_id=NULL、ended_reason=historical_recovery、baseline_action=keep、actual_recovery_date。
- `prop_product`：establish/advance 时写 first_shipment_date、lifecycle_base_month、baseline_shipment_id 或 external_first_shipment_fact_id。
- `prop_product_first_shipment_fact`：外部首次事实。
- 生产事件 `HISTORICAL_BASELINE_CHANGED`。

#### 第三方依赖

无。

#### 错误处理

所有写入在 `REQUIRES_NEW + READ_COMMITTED` 事务内；锁后重验失败整单回滚。历史寄送不调用普通寄送确认，不使用承运商/运单。

#### 涉及代码文件

- `PropHistoryEntryService.java`
- `PropHistoryEntryMapper.xml`
- `prop_new\sql\c06_history_entry.sql`
- `PropShipmentMapper.xml`

#### 涉及方法

`preview`、`baselineBefore`、`discoverParents`、`save`、`insertShipment`、`insertRelation`、`insertFact`、`setBaseline`。

### 功能007：历史质检、生命周期、通知与生产履历识别

#### 入口

历史订单保存成功后，产品首次/销售/代替品质检认定；后续产品详情、生命周期、通知、生产履历读取。

#### Controller/Service

无新增质检写入接口；由 `PropHistoryEntryService.save` 写历史质检。生命周期读取 `PropLifecycleMapper.historicalRecovered`；通知 `PropNoticeService`；生产履历 `PropProductionServiceImpl`。

#### 数据访问

`prop_inspection` 写 `source_type='historical'`、`historical_inspection_date`；产品 `initial_production_inspection_passed`；通知产品来源允许 `baseline_shipment_id` 或 `external_first_shipment_fact_id` 二选一。

#### 正常流程

1. 无既有质检且（新建产品 或 first 交付）时，写历史质检，业务日=真实首次日，确认人/时刻=本次登记审计。
2. 同步把产品首检标记置 1；与订单/基准/关系同一事务。
3. 已有质检不覆盖；已有产品 repeat 无质检不新建、不改产品标记。
4. 生命周期按 `first_shipment_date` 与 `lifecycle_base_month` 计算；historical_recovery 关系标记回收来源。
5. 通知支持外部首次事实来源，旧通知/PDF 快照不重写；生产履历显示 historical 来源与回收文案。

#### 异常流程

- 产品标记非 0/1：`INSPECTION_INVALID`。
- 有质检记录但产品标记非 1、确认人/时刻缺失、来源不在 normal/historical、历史日期未来：`INSPECTION_INVALID`。
- 通知候选来源半缺、基准寄送/外部事实同时存在或都不存在：`relationSourceInvalid`。
- 外部事实不属于产品/日期不一致：通知重验失败。

#### 条件分支

- `create` 或 `first` 才自动建历史质检；`existing + rental_repeat` 不建。
- 历史质检只用于“当时已交付合格”认定，不改变维修/返厂/当前资格。

#### 参数校验

历史日期不得晚于今天；产品标记必须存在。

#### 权限校验

质检写入由历史订单权限控制；后续读取按各模块页面权限。

#### 数据变化

`prop_inspection`、`prop_product.initial_production_inspection_passed`、生产事件；不写旧受付/旧作业/旧寄送文件。

#### 第三方依赖

无。

#### 错误处理

历史质检、产品标记、订单关系必须同事务；任一失败整单回滚。

#### 涉及代码文件

- `PropHistoryEntryService.java`
- `PropHistoryEntryMapper.xml`
- `PropLifecycleMapper.xml`
- `PropNoticeService.java`
- `PropProductionServiceImpl.java`

#### 涉及方法

`checkInspection`、`historicalInspection`、`markInitialProductionInspectionPassed`、`historicalRecovered`、`historicalSnapshot`、通知来源校验。

### 功能008：订单幂等、事务、锁与结果恢复

#### 入口

`POST /orders`、`GET /requests/{requestId}`。

#### Controller

`create`、`result`；业务拒绝 409 + errors；幂等冲突 4601、结果缺失 4602。

#### Service

`create`（L241-264）、`replay`（L231-239）、`save`（L266-398）、`requestId`（L111-115）、`hash`（L105-109）、`writeAt`（L66-75）。

#### 数据访问

`prop_order_create_request` 先插入 `requestId + hashVersion=2 + payloadHash`；完成后补 `order_id + historical_result_json + complete_time`；结果查询读取该行。

#### 正常流程

1. `requestId` 必须为标准 UUID。
2. 首次请求在事务内先登记请求，再校验/锁定/写入/完成登记。
3. 同 `requestId + 同内容` 重放：返回原结果，`replayed=true`。
4. 同 `requestId` 不同内容：4601 身份冲突；不重新创建。
5. 并发同请求：唯一键冲突后重读胜者并重放。
6. 结果查询：无记录 `notFound`；有记录且完成返回原结果；结果缺失/非 historical 返回 4602。

#### 异常流程

- requestId 非法：`FIELD_INVALID`。
- 哈希版本非 2、payload 不一致：4601。
- 结果 JSON 与请求/订单 ID 不一致：4602。
- 任意业务异常/数据库异常：事务回滚，不留下订单、产品、绑定、寄送、关系、基准、质检。

#### 条件分支

- 先查请求行，存在直接 replay；不存在才开事务。
- 数据库并发冲突后重读；找不到胜者才按身份冲突处理。

#### 参数校验

请求体未知字段严格拒绝；请求号 UUID 格式；payload 规范化 JSON 排序后 SHA-256。

#### 权限校验

`prop:historyEntry:page`。

#### 数据变化

请求登记行、订单及全部关联数据、结果 JSON；成功重放不改业务数据。

#### 第三方依赖

无。

#### 错误处理

`changed()` 要求正好影响 1 行，否则异常回滚；`IdentityConflict` 保留失败路径到事务外，避免丢失定位。

#### 涉及代码文件

- `PropHistoryEntryService.java`
- `PropHistoryEntryMapper.xml`
- `PropHistoryEntryController.java`

#### 涉及方法

`create`、`save`、`replay`、`result`、`requestId`、`hash`、`canonical`、`writeAt`。

### 功能009：批量粘贴、统一填写、离开保护与历史编辑保护

#### 入口

历史订单页批量粘贴弹窗、统一衣体规格、统一本单出货日、提交确认弹窗；订单详情/编辑页。

#### Controller

历史页无额外后端接口；最终仍调用 `POST /orders`。历史订单编辑调用现有 `PUT /prop/order/{orderId}`，服务端进入 `updateHistorical`。

#### Service

前端 `historyEntryRules.mjs`、`index.vue`；后端 `PropOrderServiceImpl.updateHistorical`（L199-232）、`cancel`（L185）、`PropShipmentService.normalSource`（L357-362）、`PropShipmentDocumentService.alive`（L86-93）。

#### 正常流程

1. 粘贴：支持 LF/CRLF/CR；先判 Tab 再 trim；空行忽略；保留字形/前导零；按原顺序追加；任一问题整批不追加。
2. 单次文本 ≤20,000 码点、非空编号 ≤200、单号 ≤64；本批/已有重复定位行号；空文本拒绝。
3. 统一衣体规格只补 `mode=create` 且 profileId/profileVersionId 都为空的行；跳过已有/半填/待查号。
4. 统一出货日只补空 shipDate，并清空该行旧 lookup/expected。
5. 离开页面有路由确认和 `beforeunload`；返回不恢复输入；无跨页 store/草稿。
6. 提交状态：editable/rejected 可编辑；submitting/unknown/identityConflict/completed 锁定；unknown 可查询原请求或原样重试；identityConflict 只能查询原结果。
7. 提交前只弹一个统一确认，展示产品、交付方式、出货日、出租状态、回收日、基准前后、日期异常、旧通知提示和不可撤销。
8. 历史订单编辑：类型/订单行/产品名/数量冻结；仅允许订单号、受注日、三方客户/地址、备注等白名单；受注日未来拒绝，晚于最早交付需同次确认；取消服务端拒绝。
9. 历史订单/寄送：普通寄送创建、保存、加/删产品、确认、邮件、删除、文件生成均拒绝；前端隐藏发货/取消/文件按钮，但服务端仍鉴权。

#### 异常流程

- 粘贴超长/Tab/重复/超 200：返回 issues，不追加。
- 批次部分有效一行也不追加。
- 提交中改数据或改号：旧查号/采用失效，必须重新查号。
- 页面认证变化/退出：epoch 失效，旧响应不回填。
- 历史订单编辑改类型/明细/数量：`orderFrozen`。
- 历史订单取消：`orderCancelForbidden`。
- 历史寄送普通写：`normalShipmentForbidden`。

#### 条件分支

- 只有 `canEditHistoryEntry` 两个状态可编辑；查询中锁定。
- 已有产品不能在本页改配置；历史订单不能新增发货。
- 历史订单详情仍有“查看”入口，但无文件/物流编辑。

#### 参数校验

粘贴按 Unicode 码点；前端相等不替代数据库排序规则，最终服务端唯一约束；订单编辑字段服务端复核。

#### 权限校验

历史页 `prop:historyEntry:page`；订单详情/编辑 `prop:order:page`；客户跳转/创建 `prop:customer:page`。前端按权限隐藏入口，服务端仍独立鉴权。

#### 数据变化

粘贴/统一填写只改页面内存；历史订单编辑只更新白名单字段和操作记录；取消/删除/新增发货不改变历史数据。

#### 第三方依赖

无。

#### 错误处理

粘贴问题保留原文并提示行号；拒绝提交保留输入；结果未知持续显示并可查询；离开后不自动重建。

#### 涉及代码文件

- `ruoyi-ui\src\views\prop\history-entry\historyEntryRules.mjs`
- `ruoyi-ui\src\views\prop\history-entry\index.vue`
- `ruoyi-ui\src\views\prop\order\detail.vue`
- `ruoyi-ui\src\views\prop\order\form.vue`
- `ruoyi-ui\src\views\prop\shipment\ShipmentDrawer.vue`
- `PropOrderServiceImpl.java`
- `PropShipmentService.java`
- `PropShipmentDocumentService.java`

#### 涉及方法

`parseManufacturingNumbers`、`fillBlankBodyProfiles`、`fillBlankShipmentDates`、`canEditHistoryEntry`、`confirmSave`、`sendOriginal`、`queryResult`、`onBeforeRouteLeave`、`updateHistorical`、`normalSource`、`alive`。
## 4. 代码行为分支清单

| 编号 | 实际代码行为 | 主要证据 |
|---|---|---|
| BR-001 | 历史客户创建仅要求 `prop:customer:page`，不复用历史订单页权限 | `PropCustomerController.java:69-82` |
| BR-002 | 历史公司拒绝 `subjectId/subjectType/companyId/sites`，强制公司类型 | `PropCustomerServiceImpl.java:125-133` |
| BR-003 | 历史支店必须有路径公司 ID，父级必须是已保存、无空编号的公司 | `PropCustomerServiceImpl.java:109-123` |
| BR-004 | 历史创建夹带已有地址/联系人 ID 或跨主体字段时，单主体请求整次拒绝 | `PropCustomerServiceImpl.java:144-162` |
| BR-005 | 历史客户编号必填且 ≤64 码点 | `PropCustomerServiceImpl.java:134-141` |
| BR-006 | 历史编号执行数据库唯一校验；并发同号最多一份，冲突返回 409 | `PropCustomerServiceImpl.java:252-263` |
| BR-007 | `C+数字` 超过 `Long.MAX_VALUE-1` 被拒绝，避免影响正常 MAX 配号 | `PropCustomerServiceImpl.java:137-140` |
| BR-008 | 公司客户区分默认直贩；支店 `defaultCustomerType` 置空并继承公司 | `PropCustomerServiceImpl.java:100-115`、`CustomerEditor.vue:388-394` |
| BR-009 | 地址邮编必须 7 位半角数字、地址 1 必填；联系人姓名必填，电话/传真/邮箱文本可空 | `PropCustomerServiceImpl.java:358-374`、`CustomerEditor.vue:155-221` |
| BR-010 | 已有客户普通编辑强制沿用原客户编号 | `PropCustomerServiceImpl.java:195` |
| BR-011 | 完整编辑先读完整地址/联系人集合，按差异增删改，未操作项保留 | `PropCustomerServiceImpl.java:268-323` |
| BR-012 | 同名客户只做候选提示，不按名称唯一拒绝 | `CustomerEditor.vue:403-417`、`PropCustomerServiceImpl.java:358-374` |
| BR-013 | 历史订单页面及全部接口统一要求 `prop:historyEntry:page` | `PropHistoryEntryController.java:12-18` |
| BR-014 | 只有历史页权限的用户可读客户 selector 树/预览，但不能创建/维护客户 | `PropCustomerController.java:57-59,102-104` |
| BR-015 | 只有客户页权限的用户不能提交订单或查询历史请求结果 | `PropHistoryEntryController.java:14` |
| BR-016 | 原订单号必填 ≤64、允许重复、不写 `generated_no`、不消费年度序列 | `PropHistoryEntryService.java:457`、`PropHistoryEntryMapper.xml:38` |
| BR-017 | 受注日必填且 ≤ 今天；类型仅 sale/rental/replacement；客户区分仅 direct/agency | `PropHistoryEntryService.java:459-460` |
| BR-018 | 订单行固定 1 行，颜色备注 ≤500；数量由产品明细数计算 | `PropHistoryEntryService.java:461-462`、`L362` |
| BR-019 | 产品明细至少 1 台；refKey 与制造编号同单不得重复 | `PropHistoryEntryService.java:456,469` |
| BR-020 | 新建行不得带 productId/expected 且必须带 body；已有行必须带 productId+expected 且同产品不重复 | `PropHistoryEntryService.java:471-472` |
| BR-021 | 每台出货日必填且 ≤ 今天，不接受仅月份/默认今天 | `PropHistoryEntryService.java:474`、`index.vue:81-85` |
| BR-022 | 受注日晚于本单出货日必须带 `dateOrderConfirmed=true` 才保存 | `PropHistoryEntryService.java:475`、`index.vue:948` |
| BR-023 | 租赁必须 ongoing/ended；非租赁携带 rentalState 或 rental_repeat 被拒 | `PropHistoryEntryService.java:476-478` |
| BR-024 | ended 必须 `shipDate <= actualRecoveryDate <= today`；ongoing 不得带回收日 | `PropHistoryEntryService.java:479-481` |
| BR-025 | 部件槽位仅 airbag/sensor/inflator_1/inflator_2；部件号 ≤64 且不得与产品号/同单部件重复 | `PropHistoryEntryService.java:482-492` |
| BR-026 | 请求体、订单行、产品、body、部件任一未知字段均拒绝 | `PropHistoryEntryService.java:243-250` |
| BR-027 | 三个客户角色可不同、不可空；主体必须存在并加行锁 | `PropHistoryEntryService.java:499-505` |
| BR-028 | 配送地址必须直接属于納品先；联系人必须属于配送地址 | `PropHistoryEntryService.java:506-510` |
| BR-029 | 变更納品先清空地址/联系人；变更地址清空联系人 | `index.vue:640-675` |
| BR-030 | 保存三方主体、地址、联系人 JSON 快照 | `PropHistoryEntryService.java:511-516` |
| BR-031 | 按制造编号查重包含软删；同号多条或唯一记录已删为 `IDENTITY_CONFLICT` | `PropHistoryEntryService.java:131-136` |
| BR-032 | 查号返回 expected 快照，提交时不一致返回 `RECHECK` | `PropHistoryEntryService.java:149-164,314` |
| BR-033 | 已有产品禁止携带 body/parts/storagePath，避免覆盖当前配置 | `PropHistoryEntryService.java:315` |
| BR-034 | 删除/报废产品不可采用；报废在查号阶段即提示 `PRODUCT_UNAVAILABLE` | `PropHistoryEntryService.java:141,313` |
| BR-035 | 非 ended 的已有产品有当前关系时返回 `PRODUCT_OCCUPIED` 及关系明细 | `PropHistoryEntryService.java:316-320` |
| BR-036 | 非 ended 的已有产品存在预留/未结束受付/返送准备时返回 `PRODUCT_IN_OPERATION` | `PropHistoryEntryService.java:320`、`PropHistoryEntryMapper.xml:31-37` |
| BR-037 | 新建产品/部件号全局不得已存在（含软删），保存和查号都校验 | `PropHistoryEntryService.java:325,421` |
| BR-038 | 新建产品生成 `M+6位` 序列、首检标记 0，制造编号同时作为 body 编号 | `PropHistoryEntryService.java:339-340,403` |
| BR-039 | 新建产品建立 body 及其他槽位绑定，部件来源标记 historical | `PropHistoryEntryService.java:343-357` |
| BR-040 | 资料/版本必须匹配槽位类型，不能自动取最新版本 | `PropHistoryEntryService.java:413` |
| BR-041 | 固件仅 sensor 允许且必须来自字典 | `PropHistoryEntryService.java:414` |
| BR-042 | 已有部件必须资料/版本/固件一致、未删除且未被其他产品活动绑定 | `PropHistoryEntryService.java:415-420` |
| BR-043 | 基准四要素必须全空或完整一致，半缺返回 `BASELINE_INVALID` | `PropHistoryEntryService.java:182-186` |
| BR-044 | 外部首次事实必须存在、属于本产品且日期等于基准首次日 | `PropHistoryEntryService.java:187-191` |
| BR-045 | 寄送基准必须未删、状态 shipped、日期一致、`delivery_valid=1` | `PropHistoryEntryService.java:192-196` |
| BR-046 | first 模式禁止外部日期；已有更早首次返回 `FIRST_CONFLICT` | `PropHistoryEntryService.java:200-204` |
| BR-047 | repeat 无首次或本单早于首次时，必须外部首次日且 ≤ 本单日、≤ 今天 | `PropHistoryEntryService.java:206-212` |
| BR-048 | repeat 已有首次且本单不早于首次时，禁止外部日期并保留原来源；同日不自动换源 | `PropHistoryEntryService.java:213-220` |
| BR-049 | 预览动作按当前基准计算 establish/advance/keep | `PropHistoryEntryService.java:221-222` |
| BR-050 | 已有产品 repeat 但无首次时，服务端要求 `previousRecoveryConfirmed=true` | `PropHistoryEntryService.java:328`、`index.vue:987` |
| BR-051 | 历史质检一致性：标记 0/1、有记录必须标记 1、确认人/时刻、来源、历史日期合法 | `PropHistoryEntryService.java:438-446` |
| BR-052 | 订单事务为 `REQUIRES_NEW + READ_COMMITTED`，任意失败整单回滚 | `PropHistoryEntryService.java:47-49,256` |
| BR-053 | 请求登记行先插入，最后写订单 ID 与结果 JSON | `PropHistoryEntryService.java:268-271,397` |
| BR-054 | `requestId` 必须标准 UUID；payload 规范化后 SHA-256 哈希 | `PropHistoryEntryService.java:105-115,253` |
| BR-055 | 同请求同内容重放原结果；内容变化返回 4601；结果缺失返回 4602 | `PropHistoryEntryService.java:231-239` |
| BR-056 | 并发唯一键冲突后重读胜者并重放 | `PropHistoryEntryService.java:257-263` |
| BR-057 | 结果查询无记录返回 notFound，完成后返回固定结果 | `PropHistoryEntryService.java:225-229` |
| BR-058 | 保存前按订单→寄送→订购量→有效关系→产品/部件/序列加锁，锁后重验 | `PropHistoryEntryService.java:275-305,425-436` |
| BR-059 | 订单写为 historical 且 `generated_no` 必须为空；明细数量=`rows.size()` | `PropHistoryEntryService.java:361-362`、`Mapper.xml:38` |
| BR-060 | 按 shipDate 分组生成 historical 寄送，status=shipped、无 SH 号、无承运商/运单 | `PropHistoryEntryService.java:363-370`、`Mapper.xml:39-42` |
| BR-061 | 关系固定 delivery_valid=1；ended 时 active_product_id=NULL、reason=historical_recovery、baseline_action=keep | `PropHistoryEntryService.java:376`、`Mapper.xml:43-46` |
| BR-062 | establish/advance 写首次日/月及寄送或外部事实来源，并写基准变更事件 | `PropHistoryEntryService.java:378-389`、`Mapper.xml:47-49` |
| BR-063 | 对外产品名只在产品名为空且未采用过时写入 | `PropHistoryEntryService.java:390`、`Mapper.xml:49` |
| BR-064 | 无既有质检且 create/first 时写 historical 质检并置产品首检标记 1；existing repeat 不建 | `PropHistoryEntryService.java:391-392`、`Mapper.xml:50` |
| BR-065 | 写 `HISTORICAL_REGISTERED`、`HISTORICAL_BASELINE_CHANGED`、绑定事件和订单 create 操作 | `PropHistoryEntryService.java:356,388,393,395` |
| BR-066 | 结果对象包含订单、产品 ID、外部事实 ID、创建数量 | `PropHistoryEntryService.java:396-397` |
| BR-067 | 历史订单编辑冻结类型/订单行/产品名/数量；仅允许订单号、受注日、客户/地址、备注等 | `PropOrderServiceImpl.java:199-229`、`order/form.vue:93-306` |
| BR-068 | 历史订单编辑受注日不得未来；晚于最早交付需同次确认 | `PropOrderServiceImpl.java:221-225` |
| BR-069 | 历史订单取消服务端明确拒绝，前端隐藏取消按钮 | `PropOrderServiceImpl.java:185`、`order/detail.vue:53-59` |
| BR-070 | 历史订单新增正常发货、普通寄送保存/加减产品/确认/邮件/删除均拒绝 | `PropShipmentService.java:357-372`、`ShipmentDrawer.vue:70-360` |
| BR-071 | 历史寄送文件准备/创建/内容读取均拒绝 | `PropShipmentDocumentService.java:86-93` |
| BR-072 | 前端状态机：editable/rejected 可编辑；submitting/unknown/identityConflict/completed 锁定 | `index.vue:522-523`、`historyEntryRules.mjs:59` |
| BR-073 | unknown 可查询原请求或原样重试；identityConflict 只能查询，不重新创建 | `index.vue:7-23,1214-1268` |
| BR-074 | 路由离开确认与 beforeunload 提示；成功后不再提示；无跨页恢复 | `index.vue:1272-1304,1289-1298` |
| BR-075 | 认证变化使旧请求失效，旧响应不回填 | `index.vue:1305-1314`、`590` |
| BR-076 | 产品查号/客户候选均有 sequence/epoch 防护，迟到响应丢弃 | `index.vue:681-714,813-847` |
| BR-077 | 粘贴文本 ≤20,000 码点；LF/CRLF/CR 切行；Tab 在 trim 前拒绝；空行忽略 | `historyEntryRules.mjs:6-18` |
| BR-078 | 单号 ≤64、单批 ≤200；本批/已有重复定位行号；任一问题整批不追加 | `historyEntryRules.mjs:20-32` |
| BR-079 | 统一衣体规格只补 create 且两项全空；统一日期只补空值并清旧查号 | `historyEntryRules.mjs:35-56` |
| BR-080 | 提交前仅一个统一确认，展示产品/日期/出租/基准变化/旧通知提示/不可撤销 | `index.vue:1022-1078` |
| BR-081 | 客户保存结果未知时按原编号提示人工核对，无客户请求号查询/精确重放 | `CustomerEditor.vue:492-507` |
| BR-082 | 菜单 SQL 未执行、迁移 SQL 标 REVIEW ONLY；目标环境是否部署无法由代码确认 | `c06_history_entry_menu.sql:1-8`、`c06_history_entry.sql:1-2` |
| BR-083 | 通知支持外部首次事实来源并校验二选一；旧通知/PDF 快照不重写 | `PropNoticeService.java:478-525,652-673` |
| BR-084 | 生命周期按首次日/月计算，historical_recovery 有独立回收标记 | `PropLifecycleMapper.xml:41-46,150-154` |
| BR-085 | 生产履历显示 historical 回收与部件来源文案 | `PropProductionServiceImpl.java` historical 分支 |
## 5. 无法确认的代码行为

1. **部署与菜单授权状态 UNKNOWN**：`c06_history_entry.sql` 明确标注 REVIEW ONLY，`c06_history_entry_menu.sql` 明确标注未执行且不授予角色。仓库代码不能证明目标数据库已执行迁移、菜单已启用或目标角色已获得 `prop:historyEntry:page`。
2. **数据库排序规则的实际同号判定 UNKNOWN**：历史产品/部件/客户最终依赖数据库唯一约束；未运行目标库，无法确认大小写、全半角、尾随空格在该库排序规则下的具体冲突表现。
3. **并发时序 UNKNOWN**：代码有请求唯一键、行锁、`writeAt` 与锁后重验，但未运行真实并发，无法确认死锁重试、锁等待超时与 InnoDB 隔离级别的实际表现。
4. **历史订单“删除”入口 UNKNOWN**：未找到历史订单删除 API；前端详情页没有删除按钮。可以确认“未提供删除接口”，但不能把“代码不存在”解释为运行期一定无法被其他管理接口删除。
5. **历史寄送 clear 后“所有首次来源一起清除”的下游细节 UNKNOWN**：寄送基准更正 SQL 只覆盖 `correctBaseline`；解除关系/清基准的其他分支未逐一运行验证。
6. **H30/H41/H74/H75/H84 的下游完整行为 UNKNOWN/待联调**：通知候选、旧 PDF 冻结、案内/受付读取、生命周期页面显示已有部分代码证据，但未执行端到端运行，不能仅凭本模块代码确认页面展示与旧文件完全不改。
7. **浏览器交互 UNKNOWN**：`beforeunload`、路由离开、Esc/遮罩关闭、超长文本滚动、迟到响应在真实浏览器中的表现未运行验证。
8. **H69/H81/H90 的“此前已回收”人工确认语义**：前端对所有 `rental_repeat` 统一发送 `previousRecoveryConfirmed=true`（`index.vue:987`），统一确认弹窗对任一 repeat 显示回收提示（`index.vue:1071-1073`）。代码实现了“统一确认”，但没有单独记录用户是否逐台确认此前回收；是否满足业务对“人工确认留痕”的要求，需要验收裁决。
9. **H22 历史质检人员语义**：历史质检写入 `confirmed_by=本次登记人`、`confirmed_time=本次登记时刻`，业务日另存 `historical_inspection_date`。代码没有伪造原质检人员/时分秒，但页面是否明确区分“登记审计”和“历史合格认定”，需实际页面确认。
10. **历史订单详情寄送表状态/操作列**：历史寄送仍有“状态/查看”列（`order/detail.vue:258-272`），但无编辑、文件、物流操作。是否存在展示层与需求的细微差异，需页面验收确认。

## 6. 总体行为结论

- 历史补录的主链路已经实现：客户公司/支店补录、历史订单原子保存、三方客户快照、按出货日分组的历史寄送、首次/再次出租基准、历史质检、幂等与结果查询、批量粘贴、历史来源保护均有明确代码。
- 代码中最强的保护点是：请求幂等、锁后重验、历史订单/寄送来源保护、编辑白名单和前端状态机。
- 最主要的待确认点不是“有没有代码”，而是部署/菜单授权、真实并发与数据库排序规则、统一确认是否满足“逐台确认此前回收”的业务留痕、以及下游通知/生命周期/旧文件冻结的运行期表现。
- 本模块静态分析可以支持“核心功能已实现”的判断；不能支持“目标环境已上线验收通过”的判断。
