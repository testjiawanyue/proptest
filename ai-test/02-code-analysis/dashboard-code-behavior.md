# Code Behavior Model（首页看板）

分析时间：2026-11-19（CST）。

分析范围：`FEAT-00-dashboard` 对应首页工作台。后端 `PropDashboardController`、`PropDashboardService`、`PropDashboardMapper` 及 `PropDashboardMapper.xml`；前端 `WorkbenchPage.vue`、`api/prop/dashboard.js`、`routes.js`、`businessTime.mjs`、日文 `dashboard.js`；关联产品列表阶段筛选与页面权限。源码基线为当前 `prop_new` 工作区，未修改源码。

需求依据：`E:\proptest\spec\spec10-28\spec\docs\features\FEAT-00-dashboard\spec.md` 与 `validation.md`（VAL-01～VAL-10）。`requirement-baseline.md` 的 REQ-002～REQ-008 用于编号，但其 REQ-008“每张卡片均可一键跳转”的验收表述已被 spec10-28 §4.2/§4.5 收敛为仅保留库存、半成品两处跳转；本文件以最新需求为准。

分析方法：依据实际 Controller、Service、Mapper XML、前端模板/脚本、路由与表结构判断；不根据方法名、注释或历史 Spec 反推实现。无法确认处标记“无法确认”。

## 1. 系统业务模块

首页看板是登录后的默认只读汇总页，不维护业务事实。它读取订单、寄送关系、受付、作业、产品、部件绑定六类现有记录，形成六块统计：

| 看板块 | 数据来源 | 代码落点 |
|---|---|---|
| 订单一览 | `prop_order`、`prop_order_line`、`prop_product_order_relation` | `selectOrders` |
| 待办事项 | 同一订单聚合的预计发货日分桶 | `selectOrders` + Service 分桶累加 |
| 厂内作业 | `prop_reception`、`prop_reception_work`、`prop_reception_type`、`prop_work_group`、`prop_work_disposition`、`prop_return`、`prop_return_item` | `selectFactory` |
| 今日作业 | `prop_work_group`、`prop_reception`、`prop_product` | `selectTodayWork` |
| 厂内库存 | `prop_product`、`prop_product_order_relation` | `selectProducts` |
| 半成品 | 同一产品投影 + `prop_product_binding`、`prop_part_item` | `selectProducts` |

页面只调用一个读取接口，不调用订单、受付、作业、产品写接口。库存卡与半成品卡各有一个前端路由跳转，其余卡片没有业务入口。

## 2. API 清单

| 方法 | 路径 | Controller 方法 | 权限表达式 | 主要结果 |
|---|---|---|---|---|
| GET | `/prop/dashboard` | `PropDashboardController.read` | `@PreAuthorize("isAuthenticated()")` | `AjaxResult.success(PropDashboard)`，一次返回业务日与六块统计 |

接口没有查询参数、分页参数、写方法或批量方法。返回对象字段：`businessDate`、`orders{rental,sale,replacement}`、`todos{dueToday,overdue}`、`factory{pendingCleaning,pendingReturnBatches,receivedToday}`、`inventory{workInProgress,finishedInStock}`、`todayWork{sewing,sensor,assembly,expanded,cleaning}`、`semiFinished{workInProgress,awaitingInspection,airbags,sensors,inflators}`。

## 3. 业务功能

### 功能001：登录后进入首页与只读六卡展示

#### 入口

根路径 `/` 与 `/home` 均重定向 `/home/workbench`；登录成功页显式 `router.push('/home/workbench')`。路由 `Workbench` 静态注册，组件为 `WorkbenchPage.vue`，`affix: true`。

#### Controller

`PropDashboardController.read()`：类级 `@RequestMapping("/prop/dashboard")`，方法级 `@GetMapping`，只接受已认证用户；返回 `AjaxResult.success(service.read())`。

#### Service

`PropDashboardService.read()` 开启 `readOnly=true`、`Isolation.REPEATABLE_READ` 事务，调用 `read(Clock.systemUTC())`。业务日通过 `LocalDate.now(clock.withZone(Asia/Tokyo))` 计算，整个请求固定同一个东京日历日；`start=today.atStartOfDay()`、`end=today.plusDays(1).atStartOfDay()`。

#### 数据访问

同一事务内依次调用 `selectOrders(today)`、`selectFactory(start,end)`、`selectProducts()`、`selectTodayWork(start,end)`。Service 将订单行按类型装入 rental/sale/replacement，将 today/overdue 分桶装入待办；库存与半成品共用同一 `ProductCounts` 结果；工作组结果按固定枚举装入五个字段。

#### 正常流程

1. 已登录用户进入首页，前端 `onMounted(load)` 发 GET。
2. 后端确定东京业务日，执行四组只读 SQL。
3. 六块计数默认由 `PropDashboard` 内部对象初始化为 0，SQL 空集合使用 `COALESCE`/默认对象形成真实 0。
4. 前端 `validResult` 校验 `businessDate` 为真实 `YYYY-MM-DD`，所有计数为 `Number.isSafeInteger` 且非负。
5. 校验通过后一次性赋值 `data`，六个卡片统一显示真实数字。

#### 异常流程

- 未登录访问 `/home/workbench`：前端路由守卫无 token，跳转 `/login?redirect=...`。
- 请求失败、超时、响应结构非法：前端清空 `data`，显示持续失败 alert；不显示 0 或旧数字。
- 数据库/映射异常：Service 没有捕获，异常交给全局异常处理；前端按请求失败处理。
- 后端返回未知订单类型或未知工作组：Service 抛 `IllegalStateException`，不会静默丢弃。

#### 条件分支

- `inFlight || disposed` 时 `load()` 直接返回，防止重复并发。
- `validResult` 对日期格式、真实日历日期、所有计数类型与范围逐项判断。
- 错误码为 `ECONNABORTED`/`ETIMEDOUT` 时显示超时文案，否则显示通用失败文案。
- `disposed` 或 `current !== sequence` 时丢弃成功/失败/finally，防止旧请求回填。

#### 参数校验

请求无业务参数。前端只校验响应：`businessDate` 必须匹配 `^\d{4}-\d{2}-\d{2}$`，再以 UTC 零点验证日期可解析且 ISO 日期不变化；六块中每个计数路径都必须是安全整数且 ≥0。注意：计数剩余字段 `remaining` 也被校验。

#### 权限校验

- 页面路由本身不配置 `meta.permissions`，登录用户都可进入。
- 后端仅 `isAuthenticated()`，没有 `prop:*:page` 页面权限码。
- 库存/半成品跳转额外要求 `auth.hasPermi('prop:product:page')` 且 `router.hasRoute('PropProducts')`；无产品页权限时入口不渲染，但统计仍展示。

#### 数据变化

无。首页没有 POST/PUT/DELETE 接口，没有保存、快照、趋势或定时任务；四组 SQL 都是 SELECT。刷新/重试只重新读取当前记录。

#### 第三方依赖

无外部 HTTP、消息队列或邮件调用。依赖数据库、MyBatis、Spring Security 登录态、Vue Router、Ant Design Vue 与 i18n 日文资源。

#### 错误处理

Controller 不捕获异常；Service 不吞异常；前端 `try/catch/finally` 负责 loading 结束与错误状态。公共请求层 `request.js` 负责网络/服务错误通知，页面再保留可操作 alert 与“再読み込み”按钮。

#### 涉及代码文件

`PropDashboardController.java`、`PropDashboardService.java`、`PropDashboardMapper.java`、`PropDashboardMapper.xml`、`PropDashboard.java`、`WorkbenchPage.vue`、`dashboard.js`、`routes.js`、`vueRouter.js`、`request.js`、`ja-JP/dashboard.js`。

#### 涉及方法

`PropDashboardController.read`、`PropDashboardService.read()`、`PropDashboardService.read(Clock)`、`PropDashboardMapper.selectOrders/selectFactory/selectProducts/selectTodayWork`、`WorkbenchPage.load`、`validResult`、`count`、`productTarget`。

### 功能002：订单一览与待办事项统计

#### 入口

首页 GET 返回的 `orders` 与 `todos` 字段；前端 `orders` 卡与 `todos` 卡读取。

#### Controller / Service

Controller 同功能001。Service 遍历 `selectOrders(today)` 返回的 `OrderBucket`：

- `orderType` 为 `rental/sale/replacement` 时分别累加对应 `OrderCount.ongoingOrders/remainingUnits`；
- `dueBucket` 为 `today/overdue` 时分别累加 `TodoCount.orders/remainingUnits`；
- 其他 `dueBucket`（SQL 产生 `other`）不进入待办；
- 未知 `orderType` 抛异常。

#### 数据访问

`selectOrders` 子查询：

1. 从 `prop_order` 取 `order_status='active'` 的订单；
2. `remaining = COALESCE(SUM(prop_order_line.quantity),0) - COUNT(prop_product_order_relation WHERE order_id=o.order_id AND delivery_valid=1)`；
3. 外层只保留 `remaining > 0`；
4. 以 `order_type` 与 `dueBucket` 分组，返回 `COUNT(*)` 与 `SUM(remaining)`。

`dueBucket` 规则：`expected_ship_date = 今天` 为 `today`，`< 今天` 为 `overdue`，其余（包括 NULL、未来）为 `other`。

#### 正常流程

有效履约关系只在寄送确认时由 `PropShipmentService.confirm` 写入，`delivery_valid=1`；订单行数量由订单明细决定。剩余为正的 active 订单进入进行中和对应待办桶。

#### 异常流程

- 订单类型异常：Service 抛 `IllegalStateException`，整次看板请求失败。
- 数据异常导致 remaining ≤ 0：该订单被 SQL `WHERE remaining > 0` 排除，不进入进行中/待办；没有单独错误提示。

#### 条件分支

- `order_status='cancelled'` 不参与。
- `remaining=0`（已发完）不参与。
- `expected_ship_date` 为空或未来：只进入 `other`，订单仍在 `orders` 进行中，但不进入 `todos`。
- 逾期数字 >0 时前端用 `token.colorError`，为 0 时普通色。

#### 参数校验

后端无输入参数；业务数量依赖表内 `quantity` 与关系计数。前端 `validResult` 校验所有订单/待办计数为非负安全整数。

#### 权限校验

仅登录态；订单卡没有跳转，不检查订单页面权限。

#### 数据变化

无。`delivery_valid`、订单状态、预计发货日由其他模块维护，首页只读。

#### 第三方依赖

无。

#### 错误处理

Service 不单独处理数据库异常；前端统一进入失败状态。

#### 涉及代码文件 / 方法

`PropDashboardMapper.xml:5-18`、`PropDashboardService.java:33-53`、`WorkbenchPage.vue:112-139`、`PropShipmentService.java:307-315`、`PropOrderRelationMapper.xml:27-48`。

### 功能003：厂内作业统计

#### 入口

首页 `factory` 字段，前端“厂内作业”卡。

#### Controller / Service

Controller 同功能001。Service 调用 `selectFactory(start,end)`，直接放入 `result.factory`。

#### 数据访问

`selectFactory` 用三个标量子查询：

1. **待清洗**：`COUNT(DISTINCT r.product_id)`，条件为产品 `deleted_time IS NULL AND scrapped_time IS NULL`；存在 `prop_reception_work.work_code='cleaning'`；不存在 `prop_reception_type.type_code='disposal'`；不存在任意 `prop_work_disposition`；不存在 `prop_work_group.group_code='cleaning' AND cleaning_completed=1`。
2. **待返送**：`COUNT(DISTINCT r.batch_id)`，条件为 `r.plan='return'`、产品未删除未报废、不存在任意 `prop_work_disposition`、不存在该受付对应的 `prop_return_item` 且 `prop_return.status='shipped'`。即同一大番号只要还有一件未实际寄出，就仍计入。
3. **今日受付**：`COUNT(*)`，条件为产品未删除、`r.established_at >= start AND < end`。按受付行计数，不按产品去重。

#### 正常流程

清洗完成由 `prop_work_group.cleaning_completed=1` 表示；返送实际寄出由 `prop_return.status='shipped'` 表示；今日受付按东京半开日区间统计。

#### 异常流程

- 产品已删除或报废：待清洗/待返送排除。
- 处置计划为 disposal：待清洗排除。
- 已有 disposition 事实：待清洗/待返送排除。
- 返送单准备中/已打印未确认：status 不是 shipped，仍计入待返送。
- 今日受付的产品已删除：排除；已报废但产品未删除的受付仍会计入（见 BR-052）。

#### 条件分支

- `plan='return'` 才可能进入待返送；`recovery/disposal/NULL` 不计入。
- 返送项全部 shipped 才使大番号退出；部分 shipped 仍保留批次。
- 今日受付只按 `established_at` 东京区间，不按创建操作时刻之外的业务日换算。

#### 参数校验

无外部输入；`start/end` 由 Service 的东京业务日计算。

#### 权限校验

仅登录态；厂内作业卡没有跳转，不做受付/返送页面权限检查。

#### 数据变化

无。只读受付、作业组、处置、返送表。

#### 第三方依赖

无。

#### 错误处理

SQL 异常由全局处理；空集合由 `COUNT` 返回 0。

#### 涉及代码文件 / 方法

`PropDashboardMapper.xml:20-40`、`PropDashboardService.java:54`、`WorkbenchPage.vue:140-155`、`WorkDispositionService.java:57-66`、`ReturnService.java:314-340`。

### 功能004：今日作业统计

#### 入口

首页 `todayWork` 字段，前端“今日作业”卡。

#### Controller / Service

Service 调用 `selectTodayWork(start,end)`；遍历结果，将 `groupCode` 映射到 `sewing/sensor/assembly/expanded/cleaning`，未知组抛异常。

#### 数据访问

`selectTodayWork` 从 `prop_work_group g` 连接 `prop_reception r`、`prop_product p`：

- `g.create_time >= start AND g.create_time < end`；
- `g.group_code IN ('sewing','sensor','assembly','expanded','cleaning')`；
- `p.deleted_time IS NULL`；
- 按 `group_code` 分组，`COUNT(DISTINCT r.product_id)`。

`prop_work_group` 主键为 `(reception_id, group_code)`，`updateGroup` 只改 `revision/note/dispositions_json/cleaning_completed/directory_text/update_time`，不改 `create_time`；因此同一产品同组当天多次修改不会重复计数。

#### 正常流程

当天第一次保存某产品某工作组时插入 `prop_work_group`，`create_time` 记录首次登记；后续修改保持原 `create_time`，看板只认首次登记日。

#### 异常流程

- 未知 `group_code`：Service 抛 `IllegalStateException`。
- 产品已删除：SQL 排除。
- 已报废产品：SQL 未按 `scrapped_time` 排除（见 BR-053）。
- “作废作业记录”：表结构没有作废/删除标记，SQL 也没有无效记录过滤（见 BR-050），会按组行计入。

#### 条件分支

- 只看 `create_time`，不读 `update_time`，所以“昨天登记、今天修改”不计入今天。
- 同一产品同组只一行，多个产品按 `COUNT(DISTINCT product_id)`。
- 五个组以外的代码不显示；若结果出现未知组，整次请求失败。

#### 参数校验

无外部输入；仅 Service 的东京日边界。

#### 权限校验

仅登录态；今日作业卡没有跳转，不检查作业页面权限。

#### 数据变化

无。首页不创建/更新/删除作业组。

#### 第三方依赖

无。

#### 错误处理

SQL 异常由全局处理；空组默认 0。

#### 涉及代码文件 / 方法

`PropDashboardMapper.xml:68-76`、`PropDashboardService.java:63-74`、`WorkMapper.xml:161-168`、`c05b_work_b_s1.sql:18-28`、`WorkbenchPage.vue:170-181`。

### 功能005：厂内库存与半成品统计

#### 入口

首页 `inventory`、`semiFinished` 字段，前端“厂内库存”卡与“半成品”卡。

#### Controller / Service

Service 调用一次 `selectProducts()`，将同一个 `ProductCounts` 同时写入：

- `inventory.workInProgress`、`inventory.finishedInStock`；
- `semiFinished.workInProgress`、`semiFinished.awaitingInspection`、`semiFinished.airbags/sensors/inflators`。

因此两处“在制品”来自同一结果，不会因两次查询产生不同快照。

#### 数据访问

`selectProducts` 内层按 `product_id` 聚合：

- `FROM prop_product p`，`WHERE p.deleted_time IS NULL AND p.scrapped_time IS NULL`；
- `LEFT JOIN prop_product_binding b ON b.product_id=p.product_id AND b.ended_time IS NULL`，只取当前绑定；
- `LEFT JOIN prop_part_item pi ON pi.part_id=b.part_id AND pi.deleted_time IS NULL`；
- `inspected = CAST(p.initial_production_inspection_passed AS SIGNED)`；
- `linked = EXISTS(SELECT 1 FROM prop_product_order_relation r WHERE r.product_id=p.product_id AND (r.ended_time IS NULL OR r.active_product_id IS NOT NULL))`；
- `body = MAX(b.slot_type='body' AND pi.part_type='jacket')`；
- `airbags = SUM(slot_type='airbag' AND part_type='airbag')`；
- `sensors = SUM(slot_type='sensor' AND part_type='sensor')`；
- `inflator1 = MAX(slot_type='inflator_1' AND part_type='inflator')`；
- `inflators = SUM(slot_type IN ('inflator_1','inflator_2') AND part_type='inflator')`。

外层汇总：

- `workInProgress = SUM(inspected=0)`；
- `finishedInStock = SUM(inspected=1 AND linked=0)`；
- `awaitingInspection = SUM(inspected=0 AND body=1 AND airbags=1 AND sensors=1 AND inflator1=1)`；
- 零件数只对 `inspected=0` 的产品求和。

#### 正常流程

- 未通过首次生产质检且未报废的产品进入在制品。
- 已通过首次质检、当前无未结束订单关系的产品进入成品在库。
- 部件齐全（衣体、气囊、传感器、发生器位置 1）的未质检产品进入待质检。
- 零件数只统计在制品当前有效绑定；解除绑定（`ended_time` 非空）不计，删除部件（`pi.deleted_time` 非空）不计，衣体因 `part_type` 过滤不计。

#### 异常流程

- 已删除或已报废产品：内层 `WHERE` 直接排除。
- 当前关系存在：`linked=1`，即使已质检也不进入成品在库。
- 关系已结束且 `active_product_id=NULL`：`linked=0`，已质检产品进入成品在库；对应订单管理解除、受付确认回收的业务路径。
- 部件记录已删除：连接条件排除，不计零件数。

#### 条件分支

- `initial_production_inspection_passed=1` 即视为已过首次质检，未读取 `prop_inspection` 表。
- `linked` 的判定是 `ended_time IS NULL OR active_product_id IS NOT NULL`；正常结束时 `active_product_id` 被置 NULL，历史结束关系不占当前。
- 待质检要求 `body/airbags/sensors/inflator1` 四个标志均为 1；`inflator_2` 不作为最低构成，但会计入发生器零件数。
- 发生器件数按 `inflator_1`/`inflator_2` 两条槽位求和，所以位置 1 和 2 各算一个。

#### 参数校验

无外部输入；只依赖数据库字段类型与 `CAST`。`COUNT/SUM` 使用 `COALESCE`，空集合为 0。

#### 权限校验

统计本身不限产品权限；两个产品跳转额外受 `prop:product:page` 与路由存在性约束。

#### 数据变化

无。首页只读产品、绑定、部件、订单关系；不解除绑定、不删除产品、不改变生产阶段。

#### 第三方依赖

无。

#### 错误处理

SQL 异常交给全局异常；空集合由 `COALESCE` 返回 0。产品阶段与前端列表阶段筛选是两套逻辑：看板直接读 `initial_production_inspection_passed`，产品列表使用 `stage` 过滤。

#### 涉及代码文件 / 方法

`PropDashboardMapper.xml:42-66`、`PropDashboardService.java:55-62`、`PropProductionMapper.xml:55-66,136-175`、`PropProductOrderRelationMapper.xml:27-48`、`WorkbenchPage.vue:156-200`。

### 功能006：库存与半成品跳转

#### 入口

`WorkbenchPage.vue` 卡片 `extra` 插槽：仅当 `card.link && canViewProducts` 时渲染 `<router-link>`。

#### Controller / Service

无后端跳转接口；由 Vue Router 导航到 `PropProducts`。

#### 数据访问

库存卡 `productTarget('products')` 返回 `{name:'PropProducts',query:{}}`；半成品卡 `productTarget('workInProgress')` 返回 `{name:'PropProducts',query:{stage:'uninspected'}}`。

#### 正常流程

- 有 `prop:product:page` 且 `PropProducts` 路由存在：显示“製品を見る/仕掛品を見る”，点击进入产品列表。
- 库存无 query，产品页 `blankQuery.stage='inspected'`，即默认已完成质检视图。
- 半成品带 `stage=uninspected`，产品页 `routeContext` 接受该值并发送 `stage=uninspected`；后端 `productListFilters` 过滤 `deleted_time IS NULL`、`scrapped_time IS NULL`、`initial_production_inspection_passed=0`，包含组装中与待质检。

#### 异常流程

- 无产品页面权限或路由不存在：链接不渲染，但六卡统计继续显示。
- `stage` 不在 `allowedStages`：产品页回退默认 `inspected`；路由 `stage` 为空时 `stage=undefined`，后端不按阶段过滤。

#### 条件分支

`canViewProducts = auth.hasPermi('prop:product:page') && router.hasRoute('PropProducts')`，两个条件必须同时成立。

#### 参数校验

产品页只接受 `uninspected/in_progress/ready/inspected`；非法值回退默认视图。首页不发送其他参数。

#### 权限校验

前端仅控制入口显隐；产品页/产品接口自身权限由目标模块负责。首页没有把产品权限扩散到订单、作业等接口。

#### 数据变化

无。跳转只导航，不读写业务数据。

#### 第三方依赖

Vue Router、目标产品页面及产品页面权限数据。

#### 错误处理

路由不存在时链接不显示；产品页加载失败由产品模块自行处理，首页不接管。

#### 涉及代码文件 / 方法

`WorkbenchPage.vue:33-37,104-110,156-200`、`routes.js:47-57`、`product/index.vue:280-335,349-370`、`PropProductionMapper.xml:136-175`。

### 功能007：加载、失败、超时、重试与迟到响应

#### 入口

`WorkbenchPage.vue` 的 `load()`、`onMounted(load)`、`onBeforeUnmount` 与模板状态区。

#### Controller / Service

后端无特殊状态；请求超时由前端 `getDashboard` 的 `timeout:10000` 与 axios 处理。

#### 数据访问

每次 `load()` 发起一个 GET；开始前 `data=null`、`error=''`、`loading=true`，成功后写 `data`，失败写 `error`，finally 只在当前 sequence 且未卸载时结束 loading。

#### 正常流程

首次进入/重新进入/刷新/用户点击重试均触发 `load()`；成功后六卡统一显示。真实 0 由成功响应中的 0 显示，不是加载占位。

#### 异常流程

- 网络错误、服务错误、非法响应：`data=null`，显示 `dashboard.loadFailed` 与 `dashboard.failedNote`，提供“再読み込み”。
- 超时：axios 超时 10 秒；`cause.code` 为 `ECONNABORTED`/`ETIMEDOUT` 时显示 `dashboard.timeout`。
- 页面卸载：`disposed=true`、`sequence++`；旧请求成功/失败/finally 均不再改当前实例。
- 旧请求迟到：`current !== sequence` 直接返回，不回填。

#### 条件分支

- `inFlight` 为真时重复点击不新增请求。
- 失败后 `inFlight=false`，允许再次重试。
- 页面离开不取消 axios 请求本身，但通过 `disposed/sequence` 屏蔽结果；返回时组件重新挂载并读取。

#### 参数校验

同功能001：响应日期和全部计数都要合法；非法响应按失败处理，不进入成功展示。

#### 权限校验

统计请求只要求登录；跳转链接的权限显示逻辑独立于 loading/error，仍按 `canViewProducts` 显示。

#### 数据变化

无。重试只读，不写业务记录。

#### 第三方依赖

axios、Ant Design Vue skeleton/alert/button、i18n 日文文案、公共请求层错误通知。

#### 错误处理

公共请求层 `notifyRequestError` 以 `message::description` 为键做 1200ms 去重；页面保留 alert，不额外弹窗。页面不展示 SQL/堆栈，只有日文失败说明。

#### 涉及代码文件 / 方法

`WorkbenchPage.vue:1-86,100-110,202-256`、`api/prop/dashboard.js:3-5`、`request.js:19-72,175-192`、`ja-JP/dashboard.js`。

### 功能008：事务、异常与只读边界

#### 入口

`PropDashboardService.read()` 的事务注解与四个 Mapper 调用。

#### Controller / Service

Controller 直接调用 Service，不自行捕获；Service 使用 Spring `@Transactional(readOnly=true, isolation=REPEATABLE_READ)`。四组查询在同一事务内执行，但未显式加锁。

#### 数据访问

四组 SELECT 分别访问订单/关系、受付/作业/返送、产品/绑定/订单关系、作业组。没有 INSERT/UPDATE/DELETE、没有 `FOR UPDATE`、没有缓存写入。

#### 正常流程

同一事务快照下生成一次看板结果；业务日、六块统计与响应对象一起返回。

#### 异常流程

任一 Mapper 抛异常，Spring 事务回滚（只读事务无写入），异常传递给全局异常处理；前端收到失败响应后清空数据。Service 对未知枚举主动抛异常，属于失败路径。

#### 条件分支

- `REPEATABLE_READ` 提供同一事务内一致性读，不是跨请求快照。
- 不计入缓存的 `useCache` 未在 Dashboard Mapper 使用；每次请求执行 SQL。
- 无定时任务、无消息队列、无文件操作。

#### 参数校验

Controller 无入参；Service 只校验内部枚举；SQL 参数为 `LocalDate/LocalDateTime`，由 Service 生成。

#### 权限校验

仅认证；没有页面权限注解。该设计使所有登录用户可见汇总，但产品跳转仍受目标页权限控制。

#### 数据变化

无。数据库只读，事务不产生写集。

#### 第三方依赖

数据库（MySQL）、MyBatis、Spring 事务、Spring Security。

#### 错误处理

Service 未包装异常；全局异常处理负责响应；前端按统一失败状态呈现。未知类型异常会导致整页错误，而不是部分卡片显示错误数字。

#### 涉及代码文件 / 方法

`PropDashboardService.java:19-75`、`PropDashboardMapper.xml:3-77`、`PropDashboardController.java:10-19`、`request.js`。

## 4. 代码行为分支清单

| 编号 | 实际行为 | 代码证据 |
|---|---|---|
| BR-001 | 根路径 `/` 与 `/home` 重定向 `/home/workbench`，登录成功页显式跳转首页 | `routes.js:38-58`、`LoginPage.vue:181`、`LoginPage2.vue:93`、`LoginPage3.vue:202` |
| BR-002 | 无 token 访问受路由守卫拦截，跳转登录并携带 redirect | `vueRouter.js:147-164` |
| BR-003 | 首页 API 仅要求 `isAuthenticated()`，没有页面权限码 | `PropDashboardController.java:17-19` |
| BR-004 | 首页只有 GET 读取，没有新增/编辑/删除/保存接口 | `PropDashboardController.java:10-19` |
| BR-005 | 一次请求返回 businessDate 与六块统计对象 | `PropDashboard.java`、`PropDashboardService.java:31-75` |
| BR-006 | 业务日取 `Asia/Tokyo` 日历日；start/end 为东京当日半开区间 | `PropDashboardService.java:28-30` |
| BR-007 | 读事务 `readOnly=true`、`REPEATABLE_READ`，四组查询同一事务 | `PropDashboardService.java:19-23` |
| BR-008 | 订单 SQL 只取 `order_status='active'`，cancelled 不参与 | `PropDashboardMapper.xml:14` |
| BR-009 | 订单剩余 = 订单行数量和减 `delivery_valid=1` 关系数；只保留 `remaining>0` | `PropDashboardMapper.xml:12-16` |
| BR-010 | 订单按 rental/sale/replacement 分桶；未知类型抛异常 | `PropDashboardService.java:35-40` |
| BR-011 | 预计发货日分为 today/overdue/other；today/overdue 才进入待办 | `PropDashboardMapper.xml:7-8,17`、`PropDashboardService.java:43-52` |
| BR-012 | 未填预计发货日为 other，不进入今日/逾期 | `PropDashboardMapper.xml:7-8` |
| BR-013 | 已发完订单 remaining=0，被 `WHERE remaining>0` 排除 | `PropDashboardMapper.xml:16` |
| BR-014 | 待办按 today/overdue 累加订单数与剩余台数 | `PropDashboardService.java:43-52` |
| BR-015 | 前端逾期计数 >0 才使用错误色 | `WorkbenchPage.vue:47-53,130-135` |
| BR-016 | 待清洗：需 cleaning、产品有效、非 disposal、无 disposition、未 cleaning_completed | `PropDashboardMapper.xml:22-29` |
| BR-017 | 待返送：plan=return、产品有效、无 disposition、无已 shipped 返送项；按大番号去重 | `PropDashboardMapper.xml:30-36` |
| BR-018 | 今日受付：established_at 在东京当日、产品未删除，按受付行计数 | `PropDashboardMapper.xml:37-39` |
| BR-019 | 今日作业：work_group.create_time 在当日、五组、按产品去重、产品未删除 | `PropDashboardMapper.xml:68-76` |
| BR-020 | 今日作业五组固定；未知 groupCode 抛异常 | `PropDashboardService.java:65-73` |
| BR-021 | 产品投影只取产品未删除、未报废，按 product_id 单行聚合 | `PropDashboardMapper.xml:50-65` |
| BR-022 | inspected 取 `initial_production_inspection_passed`，不读 inspection 表 | `PropDashboardMapper.xml:52` |
| BR-023 | linked = 存在 `ended_time IS NULL OR active_product_id IS NOT NULL` 的关系 | `PropDashboardMapper.xml:53-54` |
| BR-024 | 在制品 = inspected=0 | `PropDashboardMapper.xml:44` |
| BR-025 | 成品在库 = inspected=1 且 linked=0 | `PropDashboardMapper.xml:45` |
| BR-026 | 待质检 = inspected=0 且 body/airbag/sensor/inflator_1 均绑定 | `PropDashboardMapper.xml:46,55-58` |
| BR-027 | 零件数只对在制品当前绑定按类型求和，发生器位置 1/2 各算一个 | `PropDashboardMapper.xml:47-49,56-59` |
| BR-028 | 绑定只取 ended_time IS NULL，部件只取 deleted_time IS NULL；衣体不计零件数 | `PropDashboardMapper.xml:61-63` |
| BR-029 | 厂内库存与半成品在制品共用同一 `ProductCounts.workInProgress` | `PropDashboardService.java:55-62` |
| BR-030 | 空集合计数为真实 0；领域对象内部计数默认 0 | `PropDashboard.java`、`PropDashboardMapper.xml:44-49` |
| BR-031 | 前端六卡顺序固定为订单一览、待办事项、厂内作业、厂内库存、今日作业、半成品 | `WorkbenchPage.vue:112-201` |
| BR-032 | 页面标题、日期星期、自动统计说明由日文 i18n 输出 | `WorkbenchPage.vue:3-8,218-223`、`ja-JP/dashboard.js` |
| BR-033 | 加载时六块数字显示 skeleton、显示「読み込み中…」，data 置 null | `WorkbenchPage.vue:8,55-64`、`load` 231-233 |
| BR-034 | validResult 校验业务日与全部计数为非负安全整数；非法响应按失败处理 | `WorkbenchPage.vue:205-217,237` |
| BR-035 | 失败时 data=null，显示持续日文失败 alert 与“再読み込み” | `WorkbenchPage.vue:10-23,239-243` |
| BR-036 | 请求超时 10 秒；ECONNABORTED/ETIMEDOUT 映射超时文案 | `api/prop/dashboard.js:4`、`WorkbenchPage.vue:241-243` |
| BR-037 | 重试由用户点击触发；`inFlight` 阻止并发重复点击，结束后释放 | `WorkbenchPage.vue:19-21,226-250` |
| BR-038 | sequence+disposed 隔离旧成功/失败/finally；卸载使旧响应失效 | `WorkbenchPage.vue:224-255` |
| BR-039 | 库存/半成品链接要求 `prop:product:page` 且 PropProducts 路由存在 | `WorkbenchPage.vue:104-106` |
| BR-040 | 库存链接不带 query，产品页默认 `stage=inspected` | `WorkbenchPage.vue:107-110`、`product/index.vue:283-290` |
| BR-041 | 半成品链接带 `stage=uninspected` | `WorkbenchPage.vue:107-110,185` |
| BR-042 | 产品页 uninspected = 未删除、未报废、首检标志 0，包含 in_progress/ready | `PropProductionMapper.xml:150-154` |
| BR-043 | 产品页默认 inspected，路由 stage 只接受四个白名单值 | `product/index.vue:280-335,349-370` |
| BR-044 | 只有库存与半成品卡配置 link；其余卡无跳转、无按钮栏 | `WorkbenchPage.vue:33-37,112-201` |
| BR-045 | 首页无写接口、无保存快照/趋势、无定时轮询；进入/刷新触发读取 | `PropDashboardController.java`、`WorkbenchPage.vue:255` |
| BR-046 | 每次 onMounted 读取，返回首页重新挂载并重新查询 | `WorkbenchPage.vue:255` |
| BR-047 | 公共请求层错误通知按文案 1200ms 去重；页面保留 alert 不重复弹窗 | `request.js:20-72,175-192`、`WorkbenchPage.vue:10-23` |
| BR-048 | 订单类型/工作组未知时抛 IllegalStateException，整次请求失败 | `PropDashboardService.java:35-40,65-73` |
| BR-049 | 成功响应为 `AjaxResult.success(data)`，HTTP 200 包装 data | `PropDashboardController.java:19` |
| BR-050 | 今日作业没有“作废/无效”过滤；`prop_work_group` 无删除标记，当日组行全部统计 | `PropDashboardMapper.xml:68-76`、`c05b_work_b_s1.sql:18-28` |
| BR-051 | 订单无删除字段/删除接口，只有 cancelled 状态；删除订单不是现有业务能力 | `c03_order_wp1.sql:71-106`、`PropOrderMapper.xml:145` |
| BR-052 | 今日受付未排除已报废产品，只排除产品 deleted_time | `PropDashboardMapper.xml:37-39` |
| BR-053 | 今日作业未排除已报废产品，只排除产品 deleted_time | `PropDashboardMapper.xml:72` |
| BR-054 | 首页接口无分页、无查询参数，每次返回全量聚合 | `PropDashboardController.java`、`PropDashboardMapper.java:9-15` |
| BR-055 | 订单剩余依赖上游阻止超发；SQL 只按 `remaining>0` 过滤，没有额外负值修正 | `PropDashboardMapper.xml:16`、`PropShipmentService.java:291` |
| BR-056 | Service 不捕获数据库/映射异常，交由全局异常处理；前端统一失败态 | `PropDashboardService.java:19-75`、`WorkbenchPage.vue:239-243` |

## 5. 无法确认的代码行为

1. **目标环境数据库是否与当前 DDL 一致**：静态代码可见 `initial_production_inspection_passed`、`scrapped_time`、`active_product_id` 等列，但是否已在目标库执行迁移，无法从源码确认。
2. **页面权限菜单数据**：首页是静态路由，不依赖菜单授权；但产品页 `PropProducts` 路由和 `prop:product:page` 权限是否在目标环境存在，无法仅从首页代码确认。
3. **真实数据库排序规则/时区行为**：SQL 以 `LocalDate/LocalDateTime` 参数查询；`application.yml` 配置 `Asia/Tokyo`，JDBC URL 配置 `connectionTimeZone=+09:00`，但目标 MySQL 会话时区、连接池复用与真实数据边界未运行验证。
4. **“已作废作业记录”的业务表示**：表结构没有作废/删除列，代码也没有对应过滤；无法确认上游是否存在另一种“作废”数据形态。
5. **“删除订单/删除发货”的实际数据形态**：`prop_order` 没有软删除列，订单只有 cancelled；发货删除只允许 preparing，关系作废通过 `delivery_valid=0`。V5 中“删除”是否为历史数据或旧系统概念，无法仅从当前代码确认。
6. **已报废产品的今日受付/今日作业是否应排除**：代码只排除产品 `deleted_time`，未排除 `scrapped_time`；需求“有效产品/有效记录”的边界未逐字覆盖此组合。
7. **公共通知的实际次数**：代码有 1200ms 去重和页面 alert，但真实网络连续重试时的通知次数仍需运行确认。
8. **六卡布局的视觉一致性**：模板和 CSS 可确认结构、顺序、响应式断点，但实际像素布局、骨架尺寸与图片原型的一致性无法静态判定。

## 6. 总体行为结论

当前首页看板是一个单接口、纯只读、登录即可访问的六块聚合页。核心统计链路完整：订单进行中/剩余待发、今日/逾期、待清洗/待返送/今日受付、今日作业、库存与半成品均由实际 SQL 计算；前端具备加载骨架、失败提示、10 秒超时、单飞重试、卸载/迟到响应隔离，且只保留库存和半成品两个产品跳转。

静态代码可确认的主要不一致是：

- 今日作业没有排除“作废/无效作业记录”，而最新 Spec §3.4/§5 明确要求排除；`prop_work_group` 无删除/作废标记，SQL 统计当日全部组行（BR-050）。
- 订单没有删除能力，只有 cancelled；V5 的“删除或作废订单”只能覆盖取消路径（BR-051）。
- 已报废产品的今日受付、今日作业未被显式排除（BR-052/BR-053），是否属于“有效记录”需按业务裁决。
- `requirement-baseline.md` REQ-008 的“每张卡片均可一键跳转”与 spec10-28 §4.2 的“仅两处跳转”冲突；代码实现的是最新 spec，旧基线验收语句不能直接作为代码缺陷。
