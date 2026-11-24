# Spec → Code Validation（首页看板）

分析时间：2026-11-19（CST）。

需求依据：`E:\proptest\spec\spec10-28\spec\docs\features\FEAT-00-dashboard\spec.md` 与 `validation.md`（VAL-01～VAL-10）。REQ-002～REQ-008 使用 `ai-test/01-requirement/requirement-baseline.md` 编号；页面入口、加载反馈等最新 Spec 要求另立 `REQ-DASH-001/002` 逐条核对。

代码依据：`ai-test/02-code-analysis/dashboard-code-behavior.md`（BR-001～BR-056）。

判定性质：静态代码实现判定，不是运行验收结果。需求与代码冲突时以 spec10-28 为准；`requirement-baseline.md` 中已被最新需求收敛的语句不计为代码缺陷。

## 判定汇总

| 判定 | 数量 |
|---|---|
| PASS | 7 |
| PARTIAL | 2 |
| FAIL | 0 |
| UNKNOWN | 0 |
| 合计 | 9 |

PARTIAL：REQ-005（今日作业未排除作废记录）、REQ-008（同一“有效记录”通用规则在今日作业未落实）。

---

## REQ-002

需求：订单一览按租赁、销售、替代三列，展示进行中订单数与剩余待发台数；进行中 = 有效发货数 < 订购数，已发完不计入；已结束/作废不参与；剩余待发为差额合计。

代码实现：`selectOrders` 只取 `order_status='active'`，以订单行数量减 `delivery_valid=1` 关系数计算 remaining，只保留 remaining>0，按 order_type 与 dueBucket 分组；Service 按 rental/sale/replacement 累加。

涉及文件：`PropDashboardMapper.xml`、`PropDashboardService.java`、`PropDashboard.java`、`WorkbenchPage.vue`、`PropShipmentService.java`、`PropOrderRelationMapper.xml`。

涉及方法：`selectOrders`、`PropDashboardService.read(Clock)`、`PropShipmentService.confirm`、`PropOrderRelationMapper.end`。

验证：

正常流程：PASS。三类订单分别映射；进行中与剩余台数由 SQL 聚合，前端每列显示单数与“未出荷 N 台”。

异常流程：PASS。无匹配订单时对象默认/`COALESCE` 为 0；类型未知时整次请求抛异常，不静默显示错误数字。

业务规则：PASS。cancelled 排除；remaining=0 排除；有效发货只认 `delivery_valid=1`；剩余为负时被 `remaining>0` 排除，且寄送确认有超发前置校验。

最终结果：**PASS**

问题说明：`prop_order` 没有删除字段或删除接口，当前只有 cancelled 状态；“删除订单”不是现有业务能力。已有行若被物理删除，自然不会参与统计；但 V5 的“删除或作废订单”只能部分执行取消路径，详见 `dashboard-code-test-v5.md`。

---

## REQ-003

需求：今日要发货 = 预计发货日为今天且仍有剩余的订单数及剩余台数；逾期 = 预计发货日早于今天且仍有剩余；逾期单数>0 红色；空日期、已发完不计入；按日本业务日。

代码实现：SQL 以 `expected_ship_date` 分 today/overdue/other；外层 `remaining>0` 过滤；Service 只把 today/overdue 累加到 `todos`；前端逾期计数>0 使用错误色。

涉及文件：`PropDashboardMapper.xml`、`PropDashboardService.java`、`WorkbenchPage.vue`、`ja-JP/dashboard.js`。

涉及方法：`selectOrders`、`PropDashboardService.read(Clock)`、`WorkbenchPage.count`。

验证：

正常流程：PASS。today/overdue 分桶并累加订单数与剩余台数；前端两项并排展示。

异常流程：PASS。无匹配时 0；空日期进入 other，不进入待办；非法响应被 `validResult` 拒绝。

业务规则：PASS。已发完 remaining=0 不参与；日本业务日由 Service 的东京日历日和 `LocalDate` 参数确定。

最终结果：**PASS**

问题说明：SQL 的 `other` 分支同时覆盖空日期和未来日期；两者都不进入待办，符合“空日期不参与、未来非今日/逾期”的口径。

---

## REQ-004

需求：厂内作业展示待清洗、待返送、今日受付。待清洗需清洗未完成，排除回收/报废；待返送按大番号，只认实际寄出；今日受付为今天新建有效受付。

代码实现：`selectFactory` 三个标量子查询。待清洗检查 cleaning、产品有效、非 disposal、无 disposition、未 cleaning_completed；待返送检查 plan=return、产品有效、无 disposition、无 shipped 返送项；今日受付按 established_at 东京半开日和产品未删除计数。

涉及文件：`PropDashboardMapper.xml`、`PropDashboardService.java`、`WorkbenchPage.vue`、`WorkDispositionService.java`、`ReturnService.java`。

涉及方法：`selectFactory`、`PropDashboardService.read(Clock)`、`WorkDispositionService.confirm`、`ReturnService.confirm`。

验证：

正常流程：PASS。三个指标分别计算；待返送 `COUNT(DISTINCT batch_id)`；准备中/已打印未确认的返送不是 shipped，仍计入。

异常流程：PASS。产品删除/报废排除；disposal/既有 disposition 排除；返送单部分 shipped 时大番号仍保留。

业务规则：PASS。清洗完成以 `prop_work_group.cleaning_completed=1` 判断；实际返送以 `prop_return.status='shipped'` 判断；今日受付只按接收建立时刻。

最终结果：**PASS**

问题说明：今日受付只排除产品 `deleted_time`，未排除 `scrapped_time`（BR-052）。若“有效产品受付”要求当天受付后已报废的产品也不计入，则此边界需业务裁决；当前需求与 V5 未给出该组合用例。

---

## REQ-005

需求：今日作业按五个工作组展示当天首次登记作业记录的产品台数；同组同产品当天只计一次；只看首次登记时间；已作废记录不计入；只按工作组，不按人员。

代码实现：`selectTodayWork` 从 `prop_work_group` 按 `create_time` 当日、五组、`COUNT(DISTINCT product_id)` 统计，连接产品排除 `deleted_time`；`prop_work_group` 主键为 `(reception_id,group_code)`，更新不修改 `create_time`。

涉及文件：`PropDashboardMapper.xml`、`PropDashboardService.java`、`WorkMapper.xml`、`c05b_work_b_s1.sql`、`WorkbenchPage.vue`。

涉及方法：`selectTodayWork`、`PropDashboardService.read(Clock)`、`WorkMapper.insertGroup/updateGroup`。

验证：

正常流程：PASS。五组正确映射；同产品同组只有一行；当天首次登记、后续修改不重复计数；昨天登记今天修改不计入今天。

异常流程：PASS。未知 groupCode 抛异常；空组为 0；已删除产品排除。

业务规则：PARTIAL。唯一明确缺口是“已作废的作业记录不计入”：`prop_work_group` 没有作废/删除标记，`selectTodayWork` 也没有像 `WorkMapper.receiptSummary` 那样计算 `invalid`，当天存在作废/无效组行时会被计入。已报废产品也未按 `scrapped_time` 排除（BR-053）。

最终结果：**PARTIAL**

问题说明：核心“首次登记、按组、按产品去重”已实现；但最新 Spec §3.4/§5 的“作废记录不计入”没有对应代码。需要确认上游“作废”的数据表示（物理删除、`invalid` 计算、还是根本不产生组行），并让看板复用同一有效性判定。

---

## REQ-006

需求：厂内库存展示在制品（未通过首次生产质检且未报废）与成品在库（质检通过、当前无未结束订单关系、未报废）；订单关系从订单管理解除或受付确认回收后进入成品在库，不要求重新质检。

代码实现：`selectProducts` 以 `initial_production_inspection_passed` 为 inspected，以 `EXISTS relation (ended_time IS NULL OR active_product_id IS NOT NULL)` 为 linked；WIP=inspected=0，finished=inspected=1 且 linked=0；产品过滤 deleted/scrapped。

涉及文件：`PropDashboardMapper.xml`、`PropDashboardService.java`、`PropOrderRelationMapper.xml`、`PropProductOrderRelationMapper.xml`、`WorkbenchPage.vue`。

涉及方法：`selectProducts`、`PropDashboardService.read(Clock)`、`PropOrderRelationMapper.end/endForRecovery`。

验证：

正常流程：PASS。未质检进入在制品；已质检且无当前关系进入成品在库；有未结束关系两者都不计。

异常流程：PASS。删除/报废产品排除；关系结束时 `active_product_id=NULL`，已质检产品进入成品在库。

业务规则：PASS。订单管理解除会置 `active_product_id=NULL`、`delivery_valid=0`；受付确认回收会置 `active_product_id=NULL`、保留 `delivery_valid=1`；两者都满足 linked=0，不要求重新质检。

最终结果：**PASS**

问题说明：`linked` 依赖关系表最终状态；若存在异常数据（已结束但 active_product_id 仍非空），会按“仍关联”处理。该保守口径不产生虚假库存。

---

## REQ-007

需求：半成品展示在制品、待质检与在制品当前绑定零件数；待质检为气囊、传感器、发生器位置 1 均绑定且未过首次质检；发生器位置 1/2 各算一个；衣体、已解除绑定、已过质检绑定不计。

代码实现：同一 `selectProducts` 投影计算 `awaitingInspection` 与零件数。待质检条件为 inspected=0 且 body/airbags/sensors/inflator1 均为 1；气囊/传感器按类型 SUM，发生器件数对 inflator_1/2 求和，且只对 inspected=0 产品求和；连接只取 ended_time IS NULL、部件 deleted_time IS NULL。

涉及文件：`PropDashboardMapper.xml`、`PropDashboardService.java`、`WorkbenchPage.vue`、`c02_product_production_and_traceability.sql`。

涉及方法：`selectProducts`、`PropDashboardService.read(Clock)`。

验证：

正常流程：PASS。待质检最低构成正确；发生器位置 2 不影响最低构成但计入零件数；衣体因 `part_type` 过滤不计入。

异常流程：PASS。解除绑定、已过质检产品、已删除部件均不计；删除/报废产品整体排除。

业务规则：PASS。厂内库存与半成品在制品共用同一值；零件数只统计在制品当前有效绑定。

最终结果：**PASS**

问题说明：待质检要求 `body=1` 且 `airbags=1`，若同一产品槽位数据异常存在多个当前气囊，`SUM` 可能大于 1 而使 `airbags=1` 不成立；正常唯一槽位约束下不影响。

---

## REQ-008

需求：看板通用规则与跳转。最新 Spec：统计而非存储；有效记录（已删除、已作废）不参与；日期按日本业务日；页面只读；仅库存与半成品保留两个跳转；打开/刷新实时统计。

代码实现：单 GET 接口、四组 SELECT、无写接口、无快照/趋势/轮询；业务日东京；前端只有 inventory/semiFinished 配置 link；每次挂载 `load()`。

涉及文件：`PropDashboardController.java`、`PropDashboardService.java`、`PropDashboardMapper.xml`、`WorkbenchPage.vue`、`routes.js`、`product/index.vue`、`requirement-baseline.md`。

涉及方法：`read`、`selectOrders/selectFactory/selectProducts/selectTodayWork`、`WorkbenchPage.load/productTarget`、`routeContext`。

验证：

正常流程：PASS。打开/刷新/返回首页重新查询；六卡显示当前记录；两个跳转目标正确。

异常流程：PASS。读取失败进入失败态；不写业务记录；无产品权限时入口隐藏但统计可见。

业务规则：PARTIAL。统计而非存储、日本日、只读、两个跳转均实现；但“已作废记录不参与”只在订单/受付/产品/返送等路径落实，今日作业未落实（BR-050），因此通用规则不能整体判 PASS。

最终结果：**PARTIAL**

问题说明：

1. `requirement-baseline.md` REQ-008 验收标准“每张卡片均可一键跳转对应模块”与 spec10-28 §4.2/§4.5“仅保留库存、半成品两处跳转”冲突；代码按最新 Spec 实现，旧基线的该句已失效，不应据此判 FAIL。
2. “已作废作业记录不计入”缺口见 REQ-005/BR-050。
3. 今日受付、今日作业对已报废产品的边界未显式排除（BR-052/053）。

---

## REQ-DASH-001

需求：最新 Spec §2、§4.1～§4.5：首页为登录后默认页，固定六卡顺序，顶部显示当前日期/星期与自动统计说明，只读，仅两个业务跳转。

代码实现：`routes.js` 根路径与 `/home` 重定向 `/home/workbench`；登录页显式跳转；`WorkbenchPage` 固定六个 card 对象与顺序；标题/日期/说明由 i18n；两个 link；无维护按钮。

涉及文件：`routes.js`、`vueRouter.js`、`LoginPage.vue`、`WorkbenchPage.vue`、`ja-JP/dashboard.js`、`common.js`。

涉及方法：`WorkbenchPage` 模板、`cards`、`displayDate`、`productTarget`。

验证：

正常流程：PASS。登录后默认进入工作台；六卡顺序固定；日期星期由东京业务日/`businessToday` 计算；自动统计说明显示。

异常流程：PASS。无 token 跳转登录；无产品权限时两个链接不显示，统计仍可读。

业务规则：PASS。页面没有新增/编辑/删除/保存入口；没有把取消的入口转移到数字、标题或整卡点击；仅两个跳转。

最终结果：**PASS**

问题说明：页面日文标题为「業務ダッシュボード」、顶栏为「ワークスペース」，与中文需求“工作看板/首页”是同一页面的本地化文案；不构成功能缺失。

---

## REQ-DASH-002

需求：最新 Spec §4.6：加载骨架与日文提示；成功统一展示真实数字；失败/超时结束 loading 并保留卡片与授权入口；10 秒级有限超时；手动单飞重试；旧响应不回填；公共通知至多一次；不展示 SQL/堆栈。

代码实现：`load()` 开始时 data=null、loading=true；模板逐指标渲染 skeleton；`validResult` 校验；catch 设置失败/超时文案；finally 按 sequence 结束 loading；`inFlight` 单飞；`disposed/sequence` 隔离迟到响应；API 超时 10000ms；request.js 去重通知。

涉及文件：`WorkbenchPage.vue`、`api/prop/dashboard.js`、`request.js`、`ja-JP/dashboard.js`。

涉及方法：`load`、`validResult`、`count`、`onBeforeUnmount`、`notifyRequestError`。

验证：

正常流程：PASS。加载不预填 0/旧数字；成功统一展示；真实 0 与加载/失败可区分；卡片和授权入口不被整页遮罩。

异常流程：PASS。网络/服务/非法响应进入失败态；10 秒超时映射日文提示；旧数字清空；不自动循环重试；卸载后旧响应被丢弃。

业务规则：PASS。重试单在途、失败后可再试、只读；页面 alert 不追加重复弹窗；不展示 SQL/堆栈。

最终结果：**PASS**

问题说明：公共请求层仍会在每次失败时发一条全局通知（同文案 1200ms 去重），页面同时保留持续 alert；这是“通知 + 页面状态”两个不同层级，符合“公共请求层负责一次通知、页面保留可操作状态”的最新 Spec。真实连续重试的通知次数需运行确认。

---

## 问题汇总

### P0

无。

### P1

1. **今日作业未排除作废/无效记录**：`selectTodayWork` 只按 `create_time` 和 `group_code` 统计 `prop_work_group`，没有复用 `WorkMapper.receiptSummary` 的 `invalid` 判定；`prop_work_group` 也没有作废/删除标记（BR-050）。若上游存在无效组行，首页今日作业会虚高，违反最新 Spec §3.4/§5。

### P2

1. **订单删除路径不存在**：`prop_order` 只有 `cancelled` 状态，没有删除字段/删除接口；V5“删除或作废订单”只能覆盖作废/取消（BR-051）。
2. **今日受付未排除已报废产品**：只排除产品 `deleted_time`，未排除 `scrapped_time`（BR-052）；是否应排除需业务裁决。
3. **今日作业未排除已报废产品**：只排除产品 `deleted_time`，未排除 `scrapped_time`（BR-053）；与“有效记录”口径存在边界歧义。

### P3

1. **旧基线 REQ-008 跳转语句已过期**：`requirement-baseline.md` 写“每张卡片均可一键跳转”，spec10-28 已收敛为仅两处；代码与最新 Spec 一致，旧基线不应作为 FAIL 依据。
2. **运行环境未验证**：东京时区、MySQL 会话时区、目标库迁移/菜单/产品页权限、真实骨架布局均未运行确认。
3. **视觉细节未验证**：六卡顺序、响应式断点和骨架尺寸可静态确认，但像素级布局未实测。
