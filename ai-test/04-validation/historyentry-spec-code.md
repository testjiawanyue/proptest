# Spec → Code Validation（历史补录）

- 分析时间：2026-10-29（CST）。
- 需求基线：`E:\proptest\spec\spec10-28\spec\docs\features\FEAT-20-history-entry\spec.md`；逐条验证使用同目录 `validation.md` 的 H01～H92，并参考 `product-judgment-rules.md` 与 `E:\proptest\spec\spec10-28\spec\docs\baseline\business-time\spec.md`。
- 注意事项：本次按用户要求只使用 spec10-28 最新需求。`ai-test\01-requirement\requirement-baseline.md` 的旧 REQ 清单不包含 FEAT-20；因此本文件以 H01～H92 作为需求条目，不把旧基线缺失当作代码缺口。
- 代码依据：`ai-test/02-code-analysis/historyentry-code-behavior.md`（BR-001～BR-085）。
- 判定性质：静态代码实现判定，不是运行验收结果。

## 判定汇总

| 判定 | 数量 |
|---|---|
| PASS | 83 |
| PARTIAL | 9 |
| FAIL | 0 |
| UNKNOWN | 0 |
| 合计 | 92 |

PARTIAL 条目：H28、H30、H41、H60、H69、H74、H75、H84、H89。主要集中在两类：下游生命周期/通知/受付的静态证据不足，以及“此前已回收”统一确认是否满足人工留痕要求。

---

## REQ-H01

需求：仅原编号/名称及公司区分，无地址，客户可独立保存，无假地址/联系人。

代码实现：历史公司创建允许地址集合为空；仅在传入地址/联系人时逐项校验和插入。

涉及文件：`PropCustomerServiceImpl.java`、`PropCustomerController.java`、`CustomerEditor.vue`。

涉及方法：`createHistoricalCompany`、`validateHistoricalCreate`、`insertAggregateWithNumber`。

验证：

正常流程：PASS。无地址/联系人时不进入地址循环，主体独立提交。

异常流程：PASS。主体为空、编号缺失、已有 ID 均拒绝。

业务规则：PASS。公司类型强制为 company，编号和名称保留；客户区分默认直贩并允许修改。

最终结果：**PASS**

问题说明：无。

---

## REQ-H02

需求：一级公司两个直属地址、两个支店各有多地址/联系人，公司及支店分别保存且归属清楚。

代码实现：每次请求只保存一个主体；公司可带多个直属地址，支店通过独立接口挂在已保存公司下，地址带 subjectId 归属。

涉及文件：`PropCustomerServiceImpl.java`、`CustomerEditor.vue`、`customer/index.vue`。

涉及方法：`createHistoricalCompany`、`createHistoricalSite`、`insertAddress`、`insertContact`。

验证：

正常流程：PASS。地址可多个，联系人挂在明确地址下，支店逐次创建。

异常流程：PASS。跨主体地址 ID、重复地址/联系人、支店父级错误均拒绝。

业务规则：PASS。地址 1/2 分列，支店继承公司客户区分。

最终结果：**PASS**

问题说明：不支持一次请求提交多主体图，符合“每次保存一个主体”的边界。

---

## REQ-H03

需求：支店只能引用已保存且有编号的公司；上级无编号拒绝，不借支店号。

代码实现：`createHistoricalSite` 先锁编号序列，再锁公司；公司不存在、非 company 或编号为空均报 400。

涉及文件：`PropCustomerServiceImpl.java`。

涉及方法：`createHistoricalSite`、`lockCustomerNumber`、`insertAggregateWithNumber`。

验证：

正常流程：PASS。合法公司下可创建支店。

异常流程：PASS。未保存/无编号父级明确拒绝。

业务规则：PASS。父级必须是公司，不能用支店作上级。

最终结果：**PASS**

问题说明：无。

---

## REQ-H04

需求：支店选支店作父级、路径与载荷父级冲突、夹带已有地址/联系人 ID 时，本次单主体请求拒绝且不改已有对象。

代码实现：校验路径与载荷 companyId 一致且父级为 company；`subjectId/addressId/contactId` 非空即拒绝。

涉及文件：`PropCustomerServiceImpl.java`。

涉及方法：`validateHistoricalCreate`。

验证：

正常流程：PASS。合法支店命令无冲突字段。

异常流程：PASS。三类冲突均返回 400 字段错误。

业务规则：PASS。请求为单主体整体保存，异常时事务回滚。

最终结果：**PASS**

问题说明：无。

---

## REQ-H05

需求：新编号与已有客户号冲突或试改原号时拒绝，不自动合并/覆盖。

代码实现：历史创建走数据库唯一约束；普通编辑强制把提交编号改回当前编号。

涉及文件：`PropCustomerServiceImpl.java`。

涉及方法：`insertAggregateWithNumber`、`update`。

验证：

正常流程：PASS。新号保存；编辑沿用原号。

异常流程：PASS。同号冲突 409，编辑提交不同号被覆盖为原号而非改号。

业务规则：PASS。不自动合并、不覆盖已有主体。

最终结果：**PASS**

问题说明：无。

---

## REQ-H06

需求：两个合法同名客户不同编号只提示候选，不以名称唯一拒绝。

代码实现：历史编辑器失焦查询客户树并按名称精确过滤候选；服务端校验不含名称唯一约束。

涉及文件：`CustomerEditor.vue`、`PropCustomerServiceImpl.java`。

涉及方法：`checkSameName`、`validateHistoricalSubject`。

验证：

正常流程：PASS。同名候选展示，编号不同可分别保存。

异常流程：PASS。候选读取失败不影响主保存（仅提示）。

业务规则：PASS。名称不是唯一键。

最终结果：**PASS**

问题说明：无。

---

## REQ-H07

需求：完整编辑已有客户时，先读完整旧集合；未操作项保留，明确删除沿现有语义。

代码实现：详情加载地址/联系人完整集合；更新按地址/联系人差异插入、更新、删除。

涉及文件：`PropCustomerServiceImpl.java`、`CustomerEditor.vue`。

涉及方法：`selectDetail`、`loadAddresses`、`saveAddressDiff`、`saveContactDiff`。

验证：

正常流程：PASS。未提交的旧地址/联系人保留。

异常流程：PASS。跨主体地址、重复地址、删除仍有联系人的地址拒绝。

业务规则：PASS。局部追加不会被当作全量替换。

最终结果：**PASS**

问题说明：无。

---

## REQ-H08

需求：邮编含〒/连字符/全角数字、联系人无姓名时按字段拒绝；电话/传真/邮箱保持文本可空。

代码实现：前后端均要求 `[0-9]{7}`；地址 1 和联系人姓名必填；电话/传真/邮箱无格式强制。

涉及文件：`CustomerEditor.vue:155-237`、`PropCustomerServiceImpl.java:358-374`。

涉及方法：`validateSubject`、表单规则。

验证：

正常流程：PASS。合法 7 位邮编、姓名可保存。

异常流程：PASS。〒、连字符、全角数字、空姓名均不通过。

业务规则：PASS。可选文本字段保留。

最终结果：**PASS**

问题说明：无。

---

## REQ-H09

需求：三个无隶属关系公司分别承担订单三角色，配送归納品先，联系人归配送地址。

代码实现：三方主体分别选择并加锁；地址必须属于納品先，联系人必须属于地址。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`customerOrder`、`subjectSelected`、`openCandidates`。

验证：

正常流程：PASS。三方 ID 独立，允许不同主体。

异常流程：PASS。地址/联系人跨主体拒绝。

业务规则：PASS。三方快照分别保存。

最终结果：**PASS**

问题说明：无。

---

## REQ-H10

需求：支店借用母公司地址、改納品先后沿用旧联系人应拒绝并清理失效选择。

代码实现：服务端按 subjectId 校验地址归属；前端变更納品先清空地址/联系人，变更地址清空联系人。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`customerOrder`、`useRecipient`、`clearAddress`。

验证：

正常流程：PASS。合法地址/联系人可选择。

异常流程：PASS。跨主体地址/联系人 400 定位。

业务规则：PASS。前端联动清理，服务端最终复核。

最终结果：**PASS**

问题说明：无。

---

## REQ-H11

需求：原订单号可含 -1 后缀、允许同号不同产品，保留完整号、内部 ID 区分、不消费年度序列。

代码实现：订单号只做必填/长度校验，无同号唯一限制；写订单后 `markOrderHistorical` 要求 `generated_no IS NULL`。

涉及文件：`PropHistoryEntryService.java`、`PropHistoryEntryMapper.xml`。

涉及方法：`validate`、`save`、`markOrderHistorical`。

验证：

正常流程：PASS。完整字符串保存，内部 orderId 区分。

异常流程：PASS。空号/超长拒绝。

业务规则：PASS。不生成 `generated_no`，不调用年度序列。

最终结果：**PASS**

问题说明：无。

---

## REQ-H12

需求：缺受注日、非法类型、空产品明细拒绝；数量服务端计算，不接受手填。

代码实现：受注日、类型、订单行、产品列表均强校验；订单行数量写 `rows.size()`。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`validate`、`save`。

验证：

正常流程：PASS。合法订单可保存。

异常流程：PASS。缺日期/非法类型/空明细均 409。

业务规则：PASS。数量不取客户端订单行数量。

最终结果：**PASS**

问题说明：无。

---

## REQ-H13

需求：本单 6 台不重复产品，订单数量为 6，不记录原量/待补余额。

代码实现：订单行数量固定为产品行数；历史页面只读展示 `products.length`。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`save`、模板数量展示。

验证：

正常流程：PASS。6 行产品写数量 6。

异常流程：PASS。重复产品拒绝。

业务规则：PASS。无原需求量/余额字段。

最终结果：**PASS**

问题说明：无。

---

## REQ-H14

需求：本单重复产品拒绝；仍在出租且另有当前关系拒绝；已结束历史不争当前占用。

代码实现：制造编号集合去重；非 ended 检查当前关系，ended 跳过当前关系。

涉及文件：`PropHistoryEntryService.java`、`PropHistoryEntryMapper.xml`。

涉及方法：`validate`、`save`、`currentRelations`。

验证：

正常流程：PASS。不重复且无占用可保存。

异常流程：PASS。重复产品、ongoing 占用均拒绝。

业务规则：PASS。ended 关系 active_product_id 为空，不占当前。

最终结果：**PASS**

问题说明：无。

---

## REQ-H15

需求：新制造编号建档，只输入一个号；产品/衣体身份不同但同号，M 号及 body 绑定正确。

代码实现：制造编号作为产品号和 body 部件号；产品 M 号取序列；建立 body 绑定。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`save`、`creationParts`。

验证：

正常流程：PASS。产品、body 部件、绑定同时创建。

异常流程：PASS。同号已存在拒绝。

业务规则：PASS。制造编号只输入一次。

最终结果：**PASS**

问题说明：无。

---

## REQ-H16

需求：缺衣体规格、资料版本不属于资料、部件类型错槽位时拒绝，不能自动取最新规格。

代码实现：资料/版本必须同时匹配 `profileId + profileVersionId + partType`；不自动选择版本。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`validateParts`。

验证：

正常流程：PASS。明确资料版本可保存。

异常流程：PASS。缺版本、版本不属于资料、类型错位均 `PROFILE_INVALID`。

业务规则：PASS。前端也要求新建行两项必填。

最终结果：**PASS**

问题说明：无。

---

## REQ-H17

需求：气囊/传感器/发生器或固件未知允许空，不创建占位记录；历史销售仍认定质检通过。

代码实现：其他槽位为可选；空值不建部件；新销售/首次/代替品写历史质检并置产品标记。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`creationParts`、`save`、`historicalInspection`。

验证：

正常流程：PASS。未知槽位留空，历史质检仍建立。

异常流程：PASS。填写了部件号则资料/类型必须完整。

业务规则：PASS。不生成占位部件或默认固件。

最终结果：**PASS**

问题说明：body（衣体）本身是新建产品必需槽位，不属于“未知其他部件”。

---

## REQ-H18

需求：已有部件一致且空闲，或已绑本产品且一致时引用，不重复创建、不改规格/固件。

代码实现：新建产品可引用已有部件（校验一致且无活动绑定）；已有产品的当前绑定通过查号只读展示，不重新提交。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`validateParts`、`lookup`、`expected`。

验证：

正常流程：PASS。空闲部件可引用；已有产品绑定保留。

异常流程：PASS。部件被占用/资料不一致拒绝。

业务规则：PASS。已有产品配置只读，避免改写。

最终结果：**PASS**

问题说明：“已绑本产品”通过只读保留实现，不通过重复提交绑定命令实现。

---

## REQ-H19

需求：部件占用其他产品、发生器 1/2 同号时整单拒绝，指出占用产品和位置。

代码实现：已有部件检查活动绑定；同单部件号集合去重；错误路径定位到槽位。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`validateParts`、`validate`。

验证：

正常流程：PASS。无占用且不重复可保存。

异常流程：PASS。`PART_OCCUPIED` / `IDENTITY_CONFLICT`。

业务规则：PASS。整单事务回滚。

最终结果：**PASS**

问题说明：占用提示含槽位路径；关联产品明细由前端/消息展示。

---

## REQ-H20

需求：已有产品资料/当前绑定与输入不一致时冲突提示，不换件、不清空或覆盖已知值。

代码实现：查号额外返回 expected 快照；提交时产品字段、质检 ID、绑定快照不一致即 `RECHECK`。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`expected`、`lookup`、`save`。

验证：

正常流程：PASS。快照一致可保存。

异常流程：PASS。快照不一致拒绝并要求重新查号。

业务规则：PASS。已有产品 body/parts/storagePath 禁止提交。

最终结果：**PASS**

问题说明：无。

---

## REQ-H21

需求：报废/删除产品拒绝；在修产品可补旧已结束租赁，不改当前作业。

代码实现：非 ended 分支拒绝删除/报废并检查在途；ended 分支仅保留删除/报废拒绝，跳过当前关系与阻断作业。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`save`、`ended`、`blockedOperations`。

验证：

正常流程：PASS。在修产品的早期 ended 历史可保存。

异常流程：PASS。删除/报废产品拒绝。

业务规则：PASS。ended 不改当前作业/关系。

最终结果：**PASS**

问题说明：无。

---

## REQ-H22

需求：每台历史销售产品填具体出货日；空/仅月份拒绝；记录有历史来源、业务日=出货日；登记时刻为当前审计，不捏造原质检时分秒/人员。

代码实现：`shipDate` 为必填 `LocalDate`，未来/空拒绝；历史寄送 `source_type=historical`；历史质检业务日=首次日，确认人/时刻=本次登记。

涉及文件：`PropHistoryEntryService.java`、`PropHistoryEntryMapper.xml`。

涉及方法：`validate`、`preview`、`save`、`historicalInspection`。

验证：

正常流程：PASS。具体日期保存，历史来源与业务日分开。

异常流程：PASS。空日期、仅月份无法通过日期类型/必填校验。

业务规则：PASS。登记审计不伪造原人员/时分秒。

最终结果：**PASS**

问题说明：页面是否明确标为“登记审计”而非“原质检人”，需页面验收。

---

## REQ-H23

需求：同单两台不同具体出货日，内部分组记录且各台日期正确，仍一个事务。

代码实现：保存循环按 `shipDate` 建寄送映射，同日期复用，不同日期新建；整个 `save` 在一个事务。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`save`、`insertShipment`。

验证：

正常流程：PASS。两台日期分别落入对应寄送。

异常流程：PASS。任一写入失败整单回滚。

业务规则：PASS。无额外页面步骤。

最终结果：**PASS**

问题说明：无。

---

## REQ-H24

需求：代替品/首次出租无已有质检时，按 H71 自动认定历史交付合格，无需勾选。

代码实现：无既有质检且 `create` 或 `first` 时自动写 historical 质检；无合格确认字段。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`save`、`historicalInspection`。

验证：

正常流程：PASS。代替品/首次租赁自动建立认定。

异常流程：PASS。已有质检不覆盖。

业务规则：PASS。无勾选/审批/草稿。

最终结果：**PASS**

问题说明：无。

---

## REQ-H25

需求：首次交付日 2023-06-15 时本单/首次日同值、基准月 2023-06、历史质检同日；只填 2023-06 拒绝，无可编辑基准月例外。

代码实现：first 模式候选=shipDate；setBaseline 写首次日与 `DATE_FORMAT(... '%Y-%m')`；历史质检用 first；页面无基准月输入。

涉及文件：`PropHistoryEntryService.java`、`PropHistoryEntryMapper.xml`、`history-entry/index.vue`。

涉及方法：`preview`、`save`、`setBaseline`、`historicalInspection`。

验证：

正常流程：PASS。完整日期自动派生基准月与质检日。

异常流程：PASS。仅月份无法作为 `LocalDate` 提交。

业务规则：PASS。基准月不可直接编辑。

最终结果：**PASS**

问题说明：无。

---

## REQ-H26

需求：已有完整基准/半缺基准/更早交付时，完整保留或按 H82 确认前移；半缺拒绝、不自动修复。

代码实现：非空基准要求首次日、月、寄送/事实二选一全部一致；半缺 `BASELINE_INVALID`；更早候选返回 advance。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`preview`。

验证：

正常流程：PASS。完整基准保留/前移。

异常流程：PASS。半缺/来源矛盾拒绝。

业务规则：PASS。不做 MIN 自动修复。

最终结果：**PASS**

问题说明：无。

---

## REQ-H27

需求：禁止直接改基准月；更早有效交付经统一确认前移。

代码实现：历史页面无基准月字段；只有 first/repeat 预览动作能触发 `setBaseline`，且提交前统一确认。

涉及文件：`history-entry/index.vue`、`PropHistoryEntryService.java`。

涉及方法：`confirmSave`、`preview`、`setBaseline`。

验证：

正常流程：PASS。更早交付 advance 后同事务写基准。

异常流程：PASS。直接编辑基准月无接口/字段。

业务规则：PASS。确认弹窗展示前后值。

最终结果：**PASS**

问题说明：无。

---

## REQ-H28

需求：后续正常出货、解除 keep/clear、实际回收时识别历史来源；保留原规则；clear 同时清日期/月/所有首次来源。

代码实现：正常寄送 `correctBaseline` 只更新 normal 来源且不改外部事实；历史寄送/订单被普通写保护；clear 的具体下游分支未完整取证。

涉及文件：`PropShipmentService.java`、`PropShipmentMapper.xml`、`PropLifecycleMapper.xml`。

涉及方法：`correctBaseline`、`normalSource`、`historicalRecovered`。

验证：

正常流程：PARTIAL。正常出货与历史保护有代码证据；clear 的完整清空路径未逐分支确认。

异常流程：PASS。历史来源普通写被拒绝。

业务规则：PARTIAL。需要运行验证 clear 是否同时清日期、月和首次来源。

最终结果：**PARTIAL**

问题说明：建议补充“历史/外部基准 clear”的接口级用例与数据库断言。

---

## REQ-H29

需求：历史支撑记录直接调用普通物流更正、删除、文件/邮件接口时服务端拒绝，隐藏按钮不能替代鉴权。

代码实现：寄送服务 `normalSource` 拒绝 historical 订单/寄送；文件服务 `alive` 同样拒绝；前端隐藏按钮。

涉及文件：`PropShipmentService.java`、`PropShipmentDocumentService.java`、`ShipmentDrawer.vue`。

涉及方法：`normalSource`、`alive`、`lockContext`、`releaseCancelledOrder`。

验证：

正常流程：PASS。历史记录只读。

异常流程：PASS。普通写/文件/邮件接口服务端拒绝。

业务规则：PASS。服务端鉴权不依赖前端隐藏。

最终结果：**PASS**

问题说明：无。

---

## REQ-H30

需求：补录后新受付/报告采用本次当前配置，旧受付/快照/文件不变，不伪造旧作业。

代码实现：历史保存只写订单、寄送、关系、基准、质检和事件，不写受付/作业/旧文件；新受付沿用现有模块。

涉及文件：`PropHistoryEntryService.java`、`PropShipmentDocumentService.java`。

涉及方法：`save`、`alive`。

验证：

正常流程：PARTIAL。历史保存不写旧作业有明确证据；新受付/报告采用当前配置依赖下游模块，未端到端确认。

异常流程：PASS。历史寄送文件接口拒绝。

业务规则：PARTIAL。旧快照/文件冻结需运行验收。

最终结果：**PARTIAL**

问题说明：建议补一条“补录后新建受付/报告”的联调用例。

---

## REQ-H31

需求：历史创建末尾失败、订单最后一台或请求结果失败时各自内部全回滚；已成功公司/客户不受影响。

代码实现：客户单主体 `@Transactional`；订单 `REQUIRES_NEW`，请求登记、订单、产品、寄送、关系、基准、质检、结果任一步失败均回滚。

涉及文件：`PropCustomerServiceImpl.java`、`PropHistoryEntryService.java`。

涉及方法：`createHistoricalCompany`、`createHistoricalSite`、`save`、`writes.execute`。

验证：

正常流程：PASS。成功才完成请求登记。

异常流程：PASS。异常路径整单回滚，客户和订单是独立事务。

业务规则：PASS。公司失败不撤销支店，订单失败不撤销客户。

最终结果：**PASS**

问题说明：无。

---

## REQ-H32

需求：订单同次同内容重复/并发提交只产生一份订单和关联结果，返回原次成功结果。

代码实现：`requestId` 请求行唯一；先查后写，并发冲突重读胜者；payloadHash 校验。

涉及文件：`PropHistoryEntryService.java`、`PropHistoryEntryMapper.xml`。

涉及方法：`create`、`replay`、`save`、`completeRequest`。

验证：

正常流程：PASS。同请求同内容重放。

异常流程：PASS。内容不同 4601，不新建。

业务规则：PASS。请求行唯一键与数据库约束兜底。

最终结果：**PASS**

问题说明：真实并发未运行，静态逻辑完整。

---

## REQ-H33

需求：已成功订单改内容再用原身份时提示内容冲突并查询原结果，不引导重新创建。

代码实现：payloadHash 比较不一致返回 4601；前端转 `identityConflict`，只显示查询原结果。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`replay`、`sendOriginal`、`queryResult`。

验证：

正常流程：PASS。同内容重放成功。

异常流程：PASS。改内容返回 4601。

业务规则：PASS。identityConflict 不提供原样重试按钮。

最终结果：**PASS**

问题说明：无。

---

## REQ-H34

需求：订单成功响应丢失、查询暂未见结果时确认原次结果或原内容重试；未查到不证明未保存，不自动重建。

代码实现：unknown 状态展示查询/重试；查询返回 notFound 只提示未找到，保留 unknown；重试复用原 payload/requestId。

涉及文件：`history-entry/index.vue`、`PropHistoryEntryService.java`。

涉及方法：`sendOriginal`、`queryResult`、`result`。

验证：

正常流程：PASS。查询到完成结果。

异常流程：PASS。notFound 不自动新建。

业务规则：PASS。原内容重试固定 requestId。

最终结果：**PASS**

问题说明：无。

---

## REQ-H35

需求：争抢同编号、部件或当前关系有唯一身份/占用保护；不同已结束历史可并存，不跨请求识别重复旧单。

代码实现：产品/部件号含软删查重；活动绑定唯一；ended 的 active_product_id 为空；不扫描其他历史旧单。

涉及文件：`PropHistoryEntryService.java`、`PropHistoryEntryMapper.xml`。

涉及方法：`save`、`validateParts`、`insertRelation`。

验证：

正常流程：PASS。合法 ended 可并存。

异常流程：PASS。同编号/部件/当前关系冲突。

业务规则：PASS。没有跨请求相似旧单识别。

最终结果：**PASS**

问题说明：无。

---

## REQ-H36

需求：只有历史页权限可选已有客户/提交/查询，不能创建维护客户；只有客户页权限可历史客户创建并按原号查验，不能提交/查询历史订单。

代码实现：历史接口类级权限；客户 selector 允许三种页面权限；历史客户创建仅客户页权限。

涉及文件：`PropHistoryEntryController.java`、`PropCustomerController.java`。

涉及方法：`create`、`result`、`selectorTree`、`selectorPreview`、`createHistoricalCompany`。

验证：

正常流程：PASS。历史页用户可读客户树。

异常流程：PASS。无客户权限调用客户写接口被拒绝。

业务规则：PASS。页面权限不互相放宽写接口。

最终结果：**PASS**

问题说明：菜单授权未部署时实际角色表现无法确认。

---

## REQ-H37

需求：无页面权限拒绝；跨部门两个有权限用户共享同业务数据，不加部门/个人过滤。

代码实现：所有接口只做页面级 `@PreAuthorize`，历史查询/保存未加 DataScope 或 createBy 过滤。

涉及文件：`PropHistoryEntryController.java`、`PropCustomerController.java`。

涉及方法：全部历史接口。

验证：

正常流程：PASS。有权限用户共享数据。

异常流程：PASS。无权限 403。

业务规则：PASS。无部门/个人过滤。

最终结果：**PASS**

问题说明：无。

---

## REQ-H38

需求：已保存后结果详情读取失败时显示保存成功及固定编号，只重试读取，不重新提交、不永久 loading。

代码实现：`result` 存在即显示成功卡片和订单号；详情跳转单独按钮；查询只改 `checking`，失败保持原状态。

涉及文件：`history-entry/index.vue`。

涉及方法：`queryResult`、模板成功卡片。

验证：

正常流程：PASS。保存结果显示固定编号。

异常流程：PASS。读取失败不触发重新提交。

业务规则：PASS。`checking` 在 finally 复位。

最终结果：**PASS**

问题说明：无。

---

## REQ-H39

需求：明确拒绝、结果未知、跨页面迟到响应时保留页内输入；客户未知按原号核对，订单确认原次结果；旧响应不回填。

代码实现：rejected 保持 editable；unknown 锁定但保留数据；epoch/sequence 丢弃迟到响应；认证变化置 identityConflict。

涉及文件：`history-entry/index.vue`、`CustomerEditor.vue`。

涉及方法：`sendOriginal`、`queryResult`、`lookup`、`openCandidates`、`watch user.token`。

验证：

正常流程：PASS。拒绝后可修改再提交。

异常流程：PASS。旧响应被 epoch/sequence 拦截。

业务规则：PASS。客户结果未知按原编号提示。

最终结果：**PASS**

问题说明：无。

---

## REQ-H40

需求：正常新客户、入库/组装/质检/寄送回归不受影响；历史 C 数字号按现有 MAX 规则影响后续 C 号且不冲突。

代码实现：历史客户使用独立创建入口，写同一编号空间；正常创建仍 `C%05d`；历史编号锁序列并受唯一约束；超大 C 值拒绝。

涉及文件：`PropCustomerServiceImpl.java`。

涉及方法：`createCompany`、`createHistoricalCompany`、`lockCustomerNumber`、`selectMaxSystemCustomerNumber`。

验证：

正常流程：PASS。正常入口未改。

异常流程：PASS。同号/超大值拒绝。

业务规则：PASS。历史编号参与 MAX，但不改变正常创建逻辑。

最终结果：**PASS**

问题说明：大编号导致后续 C 号位数增长是现有 MAX 规则的直接结果，需业务确认可接受。

---

## REQ-H41

需求：正常和外部历史首次基准，后续出货、keep/clear 及回收时首次筛选和生命周期按真实日期；clear 清日期/月和来源。

代码实现：生命周期按 `first_shipment_date`/`lifecycle_base_month` 及外部事实校验；普通寄送 `correctBaseline` 只处理 normal 来源。

涉及文件：`PropLifecycleMapper.xml`、`PropShipmentMapper.xml`、`PropShipmentService.java`。

涉及方法：`correctBaseline`、生命周期查询。

验证：

正常流程：PARTIAL。首次筛选和外部事实有代码证据；clear 全量清空未逐分支确认。

异常流程：PASS。历史来源不被普通更正覆盖。

业务规则：PARTIAL。需运行验证 keep/clear/回收组合。

最终结果：**PARTIAL**

问题说明：与 H28 同一风险，建议合并为基准解除专项测试。

---

## REQ-H42

需求：普通新增与历史新增同母公司支店并发、两个历史客户争同号时不重复编号、不留部分地址联系人、不破坏父级归属。

代码实现：客户编号序列锁、父级行锁、单主体事务、数据库唯一约束。

涉及文件：`PropCustomerServiceImpl.java`。

涉及方法：`lockCustomerNumber`、`createSite`、`createHistoricalSite`、`insertAggregateWithNumber`。

验证：

正常流程：PASS。锁顺序为编号→父级，事务内完整插入。

异常流程：PASS。同号/父级冲突回滚。

业务规则：PASS。失败请求不留下部分地址/联系人。

最终结果：**PASS**

问题说明：真实数据库并发未运行。

---

## REQ-H43

需求：先逐条录一台，再粘贴三个不同编号，再逐条添加；两入口共用明细结构，粘贴顺序追加，错误对应原行。

代码实现：两种入口都调用 `newRow`；粘贴解析后追加；行以 refKey 标识。

涉及文件：`history-entry/index.vue`。

涉及方法：`newRow`、`appendPaste`、`addProduct`。

验证：

正常流程：PASS。原行不变，粘贴按顺序追加。

异常流程：PASS。粘贴 issues 阻止整批追加。

业务规则：PASS。添加不写库、不占号、不自动提交。

最终结果：**PASS**

问题说明：无。

---

## REQ-H44

需求：LF/CRLF/CR、空行、首尾空白、前导零、大小写/全半角、内部符号及 Tab 多列正确处理；Tab 在 trim 前拒绝，末尾 Tab 不漏。

代码实现：按三种换行切分；先 `raw.includes('\t')` 再 trim；只 trim 首尾；保留原字符串；空行忽略。

涉及文件：`historyEntryRules.mjs`。

涉及方法：`parseManufacturingNumbers`。

验证：

正常流程：PASS。三种换行、空白、字形保留。

异常流程：PASS。Tab 在 trim 前检测。

业务规则：PASS。不拆逗号/范围、不去表头。

最终结果：**PASS**

问题说明：无。

---

## REQ-H45

需求：本批重复或与现有明细重复时标原始行号及冲突行，不静默去重；有任一问题整批不追加。

代码实现：`seen` 与本批、`existing` 与现有明细比较；issues 有值时返回空 numbers。

涉及文件：`historyEntryRules.mjs`。

涉及方法：`parseManufacturingNumbers`。

验证：

正常流程：PASS。无重复时完整追加。

异常流程：PASS。重复定位行号，整批不追加。

业务规则：PASS。原文和原明细保持。

最终结果：**PASS**

问题说明：无。

---

## REQ-H46

需求：两编号 JS 不同但数据库排序规则相同，不以 JS 相等冒称唯一；服务端明确冲突、整单回滚、定位产品，不自动归并/改号。

代码实现：前端只做本地提示；服务端唯一键冲突由 `writeAt` 捕获为 `IdentityConflict` 并定位产品；事务回滚。

涉及文件：`historyEntryRules.mjs`、`PropHistoryEntryService.java`。

涉及方法：`parseManufacturingNumbers`、`writeAt`、`save`。

验证：

正常流程：PASS。本地不同号可提交。

异常流程：PASS。数据库冲突整单拒绝。

业务规则：PASS。不改号/不归并。

最终结果：**PASS**

问题说明：具体排序规则冲突表现需目标库验证。

---

## REQ-H47

需求：空文本/全空行、64/65 码点、200/201 个、20,000/20,001 码点按边界接受/拒绝，失败不截断/不部分追加。

代码实现：`[...text].length > 20000`、`[...number].length > 64`、`numbers.length > 200`；空列表 `PASTE_EMPTY`。

涉及文件：`historyEntryRules.mjs`。

涉及方法：`parseManufacturingNumbers`。

验证：

正常流程：PASS。64/200/20000 边界可接受。

异常流程：PASS。65/201/20001 拒绝且整批不追加。

业务规则：PASS。200 仅为本地单次保护，不是订单总上限。

最终结果：**PASS**

问题说明：无。

---

## REQ-H48

需求：添加失败保留文本；关闭只清弹窗；成功后重开为空；锁定态禁用打开/确认/文本/逐条编辑，查询与安全退出保留。

代码实现：issues 时不关闭；`closePaste` 清文本；`openPaste` 先清空；`locked` 禁用按钮与输入；查询/退出不受锁定影响。

涉及文件：`history-entry/index.vue`。

涉及方法：`openPaste`、`closePaste`、`appendPaste`、`locked`。

验证：

正常流程：PASS。关闭/重开清空。

异常流程：PASS。失败保留文本。

业务规则：PASS。锁定态显式禁用编辑入口。

最终结果：**PASS**

问题说明：弹窗内输入是否逐项禁用需页面确认；打开按钮已禁用。

---

## REQ-H49

需求：粘贴后仍须补衣体资料/出货日；采用已有产品或部件占用冲突；统一日期有值/空的行为正确。

代码实现：粘贴只建行不采用；最终提交逐台校验；统一日期只补空白；部件冲突服务端拒绝。

涉及文件：`history-entry/index.vue`、`historyEntryRules.mjs`、`PropHistoryEntryService.java`。

涉及方法：`appendPaste`、`confirmSave`、`validateParts`。

验证：

正常流程：PASS。缺资料/日期不能提交。

异常流程：PASS。已知冲突整单拒绝。

业务规则：PASS。未知部件/固件可空，统一日期不默认今天。

最终结果：**PASS**

问题说明：无。

---

## REQ-H50

需求：textarea Enter 只换行；一次点击只追加一次；模态框开时订单注册禁用；改号/移除后旧查号不回填；原始粘贴文字不独立保存。

代码实现：表单 `@submit.prevent`；`appendPaste` 首次后关闭；`confirmSave` 在 pasteOpen 时直接返回；行 sequence 递增；粘贴文本只在页面 ref。

涉及文件：`history-entry/index.vue`。

涉及方法：`appendPaste`、`confirmSave`、`numberChanged`、`invalidate`。

验证：

正常流程：PASS。Enter 不提交订单。

异常流程：PASS。旧查号被 sequence 拦截。

业务规则：PASS。粘贴原文不进入 payload。

最终结果：**PASS**

问题说明：无。

---

## REQ-H51

需求：已有产品首次 2023-04-10、基准月 2023-04，前次租赁已回收，再次出货 2024-06-15；引用同一产品，本单日 2024-06-15，原首次日/月/来源、配置、质检、履历不变。

代码实现：repeat 且本单不早于首次时 `candidate=current`、action=keep，不写基准；建立新 historical 寄送/关系；已有产品配置只读。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`preview`、`save`。

验证：

正常流程：PASS。原基准 keep，新关系按本次日期。

异常流程：PASS。已有当前关系时 ongoing 拒绝。

业务规则：PASS。不改原配置/质检/基准。

最终结果：**PASS**

问题说明：无。

---

## REQ-H52

需求：当前关系/在途冲突时仅建立当前关系的分支拒绝；已结束旧租赁可与当前 B/维修并存，不改 B/维修；删废拒绝。

代码实现：`!ended` 才查当前关系与阻断作业；ended 只保留产品可用的删除/报废校验。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`save`、`ended`。

验证：

正常流程：PASS。ended 可并存。

异常流程：PASS。ongoing 冲突拒绝。

业务规则：PASS。删废始终拒绝。

最终结果：**PASS**

问题说明：无。

---

## REQ-H53

需求：多个历史出租日期重叠时不扫描全部历史、不选前次回收关系，只查本次依据和当前关系。

代码实现：只读当前关系/基准寄送，不查询其他历史订单期间；无跨订单重叠校验。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`discoverParents`、`save`。

验证：

正常流程：PASS。重叠历史不阻断。

异常流程：PASS。本次当前关系仍校验。

业务规则：PASS。不选择前次回收关系。

最终结果：**PASS**

问题说明：无。

---

## REQ-H54

需求：来源半缺、不属本产品、日期/月不符时拒绝；更早交付按 H82，同日不换源；不以登记时间推断业务时间。

代码实现：基准四要素完整性、事实产品/日期、寄送状态/日期/有效交付均校验；同日保留原 sourceKind；历史业务日来自 shipDate。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`preview`。

验证：

正常流程：PASS。合法来源保留。

异常流程：PASS。异常来源 `BASELINE_INVALID`。

业务规则：PASS。同日不自动换源。

最终结果：**PASS**

问题说明：无。

---

## REQ-H55

需求：离开订单去客户管理再返回时提示输入丢失、不恢复；客户独立保存后重新录订单。

代码实现：路由离开确认；无跨页 store/草稿；客户管理独立保存。

涉及文件：`history-entry/index.vue`、`customer/index.vue`。

涉及方法：`onBeforeRouteLeave`、`hasInput`。

验证：

正常流程：PASS。有输入时提示。

异常流程：PASS。无输入不拦截。

业务规则：PASS。返回空表单。

最终结果：**PASS**

问题说明：无。

---

## REQ-H56

需求：订单提交夹带未保存客户/客户创建内容，或客户历史创建失败时拒绝夹带、不写客户，客户失败无可采用对象。

代码实现：历史订单请求未知字段严格拒绝；三方主体必须存在；订单服务不调用客户创建。

涉及文件：`PropHistoryEntryService.java`、`CustomerEditor.vue`。

涉及方法：`create`、`customerOrder`。

验证：

正常流程：PASS。只允许已保存主体 ID。

异常流程：PASS。未知字段/不存在主体拒绝。

业务规则：PASS。客户失败不产生订单可用对象。

最终结果：**PASS**

问题说明：无。

---

## REQ-H57

需求：结果未知留在当前页时查询原请求或原样重试，不建设跨页恢复。

代码实现：unknown 卡片提供查询/重试；重试复用 `originalPayload`；无 URL 查询号入口。

涉及文件：`history-entry/index.vue`。

涉及方法：`sendOriginal`、`queryResult`。

验证：

正常流程：PASS。原请求查询。

异常流程：PASS。notFound 不新建。

业务规则：PASS。无跨页状态。

最终结果：**PASS**

问题说明：无。

---

## REQ-H58

需求：多台新建/已有/待查号产品，批量衣体规格与版本、统一本单日；每台四槽默认展开；只补符合条件空白；只改内存。

代码实现：产品行模板显示四槽；`fillBlankBodyProfiles` 仅 create 且两项全空；`fillBlankShipmentDates` 仅空日期；不改首次日/月。

涉及文件：`history-entry/index.vue`、`historyEntryRules.mjs`。

涉及方法：`fillBlankBodyProfiles`、`fillBlankShipmentDates`、`applyBody`、`applyDate`。

验证：

正常流程：PASS。只补空白并显示数量。

异常流程：PASS。已填/半填/已有/待查号跳过。

业务规则：PASS。只改页面内存，最终逐台校验。

最终结果：**PASS**

问题说明：模板布局是否“默认展开”需页面确认；四槽均渲染。

---

## REQ-H59

需求：并发正常出货、历史已结束补录、基准调整时，当前关系至多一个成功；正常新交付和旧 ended 可顺序成功；基准变化重核后可前移。

代码实现：产品/关系行锁、活动关系唯一键、锁后重验；ended 不占当前；基准变更在同事务写入。

涉及文件：`PropHistoryEntryService.java`、`PropHistoryEntryMapper.xml`。

涉及方法：`save`、`insertRelation`、`setBaseline`。

验证：

正常流程：PASS。锁与唯一键保证当前关系竞争。

异常流程：PASS。冲突回滚返回占用。

业务规则：PASS。基准变化重新预览/确认。

最终结果：**PASS**

问题说明：真实并发时序未运行。

---

## REQ-H60

需求：repeat 成功后履约、生命周期、案内、受付、原质检及登记履历正确；既有产品不生成/覆盖质检，外部新建产品按真实首次日认定。

代码实现：关系保留历史交付，履约按当前关系；生命周期按首次月；existing repeat 不建质检；notices/受付不自动写。

涉及文件：`PropHistoryEntryService.java`、`PropLifecycleMapper.xml`、`PropNoticeService.java`。

涉及方法：`save`、`historicalInspection`、生命周期/通知读取。

验证：

正常流程：PARTIAL。本模块写入关系与质检分支清楚；履约/案内/受付页面未端到端确认。

异常流程：PASS。未自动发通知/写旧作业。

业务规则：PARTIAL。登记时刻与业务日已分开，下游展示需验收。

最终结果：**PARTIAL**

问题说明：建议补 repeat 后的履约数量、生命周期月、受付/通知页面联调。

---

## REQ-H61

需求：同单混合 first/rental_repeat，改订单类型、同请求重放时逐台校验、全单原子；改类型提示重核，不静默改模式；重放不被新增当前关系误拒。

代码实现：每行独立 `preview`；前端切换类型清空不兼容 rental 字段；重放先查请求行并直接返回，不读当前状态。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`preview`、`invalidateAll`、`create`、`replay`。

验证：

正常流程：PASS。每行模式独立校验。

异常流程：PASS。类型不兼容字段拒绝。

业务规则：PASS。重放固定结果。

最终结果：**PASS**

问题说明：无。

---

## REQ-H62

需求：客户列表普通新增/历史创建共用 CustomerEditor；正常自动号且客户端原号不影响策略；历史号必填查重；保存后同一列表/详情/完整编辑，编号只读。

代码实现：同一组件两种模式；普通创建不提交 customerNo；历史创建提交原号；编辑强制原号。

涉及文件：`customer/index.vue`、`CustomerEditor.vue`、`PropCustomerServiceImpl.java`。

涉及方法：`openAddCompany`、`openHistoricalCompany`、`payload`、`update`。

验证：

正常流程：PASS。两种模式入口共用组件。

异常流程：PASS。历史号必填/同号拒绝。

业务规则：PASS。保存后编号只读。

最终结果：**PASS**

问题说明：无。

---

## REQ-H63

需求：同一公司多个支店逐次创建；其中一支店失败只回滚该请求，不撤销公司和其他支店。

代码实现：支店每次独立 `@Transactional`；父级只读校验；失败仅本请求回滚。

涉及文件：`PropCustomerServiceImpl.java`。

涉及方法：`createHistoricalSite`。

验证：

正常流程：PASS。逐次创建。

异常流程：PASS。单个支店失败不影响已提交主体。

业务规则：PASS。不支持多主体图。

最终结果：**PASS**

问题说明：无。

---

## REQ-H64

需求：客户保存超时、按原号查询、同号竞争、保存成功后列表读取失败时按原号人工核对；不自动判成功/覆盖；无客户请求号或精确重放承诺。

代码实现：409 显示同号；其他未知错误记录 `unknownNumber` 并提示按原号查询；`checkExisting` 跳到客户列表；无客户 requestId；列表读取失败有重试入口。

涉及文件：`CustomerEditor.vue`、`customer/index.vue`。

涉及方法：`save`、`checkExisting`、`retryLoad`。

验证：

正常流程：PASS。保存成功刷新列表。

异常流程：PASS。超时/未知显示原号，不自动覆盖。

业务规则：PASS。无客户请求号查询。

最终结果：**PASS**

问题说明：人工核对后的合并/采用由现有客户编辑完成。

---

## REQ-H65

需求：含输入的订单页离开后返回空表单，不自动采用客户或提交。

代码实现：离开确认；页面状态不持久化；重新挂载初始化空表单。

涉及文件：`history-entry/index.vue`。

涉及方法：`onBeforeRouteLeave`、`onMounted`。

验证：

正常流程：PASS。离开提示。

异常流程：PASS。返回重建空状态。

业务规则：PASS。不自动采用/提交。

最终结果：**PASS**

问题说明：无。

---

## REQ-H66

需求：订单结果未知后离开时提示无法恢复输入及需核对结果，不自动新建请求，不承诺跨页结果恢复。

代码实现：unknown 状态仍有 hasInput 时离开确认；提示语境由未知卡片/离开弹窗提供；无持久化。

涉及文件：`history-entry/index.vue`。

涉及方法：`hasInput`、`onBeforeRouteLeave`。

验证：

正常流程：PASS。未知状态离开被拦截。

异常流程：PASS。不新建 requestId。

业务规则：PASS。无跨页恢复。

最终结果：**PASS**

问题说明：离开弹窗文案是否明确包含“结果需核对”需页面文案验收。

---

## REQ-H67

需求：离开/刷新/关闭、认证变化及迟到响应时提示丢失、返回空表单、不提供 URL/编号恢复、不自动重建；认证变化旧响应失效。

代码实现：`beforeunload` + 路由守卫；`epoch`/`authChanged` 使旧请求失效；无 URL 恢复参数。

涉及文件：`history-entry/index.vue`。

涉及方法：`beforeUnload`、`watch user.token/user.name`、`current`。

验证：

正常流程：PASS。离开/刷新提示。

异常流程：PASS。认证变化旧响应丢弃。

业务规则：PASS。不自动重建。

最终结果：**PASS**

问题说明：真实浏览器关闭/刷新行为未运行。

---

## REQ-H68

需求：无权限跳转客户页或查询订单结果时按页面授权拒绝；不新增返回条或跨页状态机制。

代码实现：客户跳转按钮按 `prop:customer:page` 显示；订单详情按 `prop:order:page`；历史结果接口类级权限；无跨页 store。

涉及文件：`history-entry/index.vue`、`PropHistoryEntryController.java`。

涉及方法：`allowed`、模板条件、Controller 权限。

验证：

正常流程：PASS。有权限才显示入口。

异常流程：PASS。无权限接口 403。

业务规则：PASS。无跨页状态机制。

最终结果：**PASS**

问题说明：菜单权限数据未部署时实际按钮表现无法确认。
---

## REQ-H69

需求：仅有旧台账、首次 2023-04-10、再次出租 2024-06-15 且确认此前已回收时，可按真实首次日补录当前订单，不补造旧订单/回收作业。

代码实现：已有产品 repeat 且本单晚于首次时 action=keep，建立本单 historical 寄送/关系；不写旧受付/旧作业；服务端对无首次的产品要求 `previousRecoveryConfirmed`。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`preview`、`save`、`confirmSave`、`payload`。

验证：

正常流程：PASS。原首次日保留，本单关系按 2024-06-15 建立。

异常流程：PASS。无首次且未确认前次回收时拒绝。

业务规则：PARTIAL。前端对所有 repeat 统一发送 `previousRecoveryConfirmed=true`，统一确认弹窗显示回收提示，但没有逐台/逐次人工确认留痕。

最终结果：**PARTIAL**

问题说明：需确认“统一确认弹窗 + 自动 true”是否满足“确认此前已回收”的人工留痕要求；否则应增加逐台确认状态或审计字段。

---

## REQ-H70

需求：本次建立当前关系且原关联/回收作业未完成时引导正常处理；本次补旧已结束时无需结束当前 B；离开丢失输入。

代码实现：ongoing 当前关系冲突返回 `PRODUCT_OCCUPIED` 及关系；前端弹窗提供受付/作业导航；ended 跳过当前关系；离开守卫。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`save`、`showOccupancy`、`navigate`、`onBeforeRouteLeave`。

验证：

正常流程：PASS。ended 旧历史可保存。

异常流程：PASS。ongoing 占用整单拒绝并给出指引。

业务规则：PASS。不自动结束旧关系，不写回收作业。

最终结果：**PASS**

问题说明：无。

---

## REQ-H71

需求：销售/首次租赁/代替品自动历史合格认定，业务日取真实首次日，同时原子建立产品主档首次生产质检通过标记；既有质检不覆盖但标记保持通过；不设确认框。

代码实现：无质检且 create/first 时写 historical 质检并 `markInitialProductionInspectionPassed`；同一事务；无确认字段。

涉及文件：`PropHistoryEntryService.java`、`PropHistoryEntryMapper.xml`。

涉及方法：`save`、`historicalInspection`、`markInitialProductionInspectionPassed`。

验证：

正常流程：PASS。自动建立记录与产品标记。

异常流程：PASS。任一写入失败整单回滚。

业务规则：PASS。已有质检不覆盖；页面无合格勾选。

最终结果：**PASS**

问题说明：产品标记含义需在下游页面正确解释，不在本模块代码内。

---

## REQ-H72

需求：受注日晚于出货且同时基准前移时，日期区只提示；两项在唯一提交确认中统一确认；修改后确认失效，服务端重验。

代码实现：日期区提示；确认弹窗展示日期警告和基准前后；确认后 payload 带 `dateOrderConfirmed=true`；提交前比较 fingerprint；服务端重验日期与基准。

涉及文件：`history-entry/index.vue`、`PropHistoryEntryService.java`。

涉及方法：`confirmSave`、`preview`、`validate`。

验证：

正常流程：PASS。统一确认后保存。

异常流程：PASS。未确认/日期未来拒绝；确认后改数据 fingerprint 不匹配不提交。

业务规则：PASS。服务端再次检查受注日/出货日/基准。

最终结果：**PASS**

问题说明：`dateOrderConfirmed` 是客户端确认标志，直接调用 API 可伪造 true；若要求不可伪造的人工确认证据，需要额外审计设计。

---

## REQ-H73

需求：历史事实日期未来拒绝；预计日期未来允许；不检查跨订单出租顺序。

代码实现：受注日/出货日/回收日/外部首次日均 ≤ 今天；预计发货日无未来限制；无跨订单顺序校验。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`validate`、`preview`。

验证：

正常流程：PASS。预计日期可未来。

异常流程：PASS。历史事实日期未来拒绝。

业务规则：PASS。不检查跨订单期间顺序。

最终结果：**PASS**

问题说明：无。

---

## REQ-H74

需求：外部首次基准后正常出货不覆盖真实首次日；尝试更正历史支撑日期拒绝；回收/keep 保留，clear 清日期/月和来源；旧登记证据/通知快照不改。

代码实现：普通寄送更正 SQL 限定 `source_type='normal'` 且不改外部事实；历史寄送普通写拒绝；旧通知快照读取已冻结数据；clear 全路径未完整取证。

涉及文件：`PropShipmentService.java`、`PropShipmentMapper.xml`、`PropNoticeService.java`。

涉及方法：`correctBaseline`、`normalSource`、`historicalSnapshot`。

验证：

正常流程：PARTIAL。正常出货不覆盖外部事实有 SQL 证据；clear 与通知快照冻结未运行验证。

异常流程：PASS。历史支撑日期更正被普通来源保护拒绝。

业务规则：PARTIAL。需补 keep/clear/回收组合断言。

最终结果：**PARTIAL**

问题说明：与 H28/H41 同一组基准解除风险。

---

## REQ-H75

需求：外部来源产品进入生命周期与案内生成时按真实首次月计算；当前订单履约只计本次；通知冻结外部来源，旧文件不重写，不展示假物流。

代码实现：生命周期查询要求首次日/月及外部事实完整；通知支持 external fact 并校验来源；历史寄送无 SH/承运商；旧快照读取。

涉及文件：`PropLifecycleMapper.xml`、`PropNoticeService.java`、`PropHistoryEntryMapper.xml`。

涉及方法：生命周期查询、通知来源校验、`historicalSnapshot`。

验证：

正常流程：PARTIAL。首次月/外部来源有代码证据；案内生成与履约展示未端到端确认。

异常流程：PASS。来源不完整拒绝。

业务规则：PARTIAL。旧文件不重写需运行验收。

最终结果：**PARTIAL**

问题说明：建议补生命周期/案内/通知三处联调用例。

---

## REQ-H76

需求：两种来源同时存在、事实不含本产品、日期/月不匹配或来源未完成时拒绝或标记异常，不按非空误判完整、不自动修复；正常寄送来源原规则保持。

代码实现：基准要求寄送与外部事实严格二选一；外部事实校验 productId+日期；寄送校验状态/日期/有效交付；通知同样二选一校验。

涉及文件：`PropHistoryEntryService.java`、`PropNoticeService.java`。

涉及方法：`preview`、通知来源校验。

验证：

正常流程：PASS。单一完整来源可保存。

异常流程：PASS。双来源/半缺/错产品/错日期均拒绝。

业务规则：PASS。不做自动修复。

最终结果：**PASS**

问题说明：无。

---

## REQ-H77

需求：回收引导跳转只导航不写数据；提示订单输入丢失，处理后重新填写并核对。

代码实现：占用弹窗按钮调用 `router.push` 到受付/作业；无写接口；离开守卫提示。

涉及文件：`history-entry/index.vue`。

涉及方法：`showOccupancy`、`navigate`、`hasInput`。

验证：

正常流程：PASS。仅导航。

异常流程：PASS。不自动处理占用。

业务规则：PASS。返回后无草稿恢复。

最终结果：**PASS**

问题说明：无。

---

## REQ-H78

需求：既有产品再次出租但无已登记质检时，不生成/覆盖质检，也不把产品首检标记改为通过；明确显示未登记。

代码实现：`existing + rental_repeat` 不进入历史质检写入；`checkInspection` 允许无记录且标记 0；前端显示“未登记/无质检”文案。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`save`、`checkInspection`、`inspectionLabel`。

验证：

正常流程：PASS。不新建质检、不改产品标记。

异常流程：PASS。标记与记录矛盾时拒绝。

业务规则：PASS。前端明确显示未登记。

最终结果：**PASS**

问题说明：无。

---

## REQ-H79

需求：已结束租赁回收日缺失/不确定拒绝；仍在出租携带回收日拒绝；均定位产品行，不生成假日期。

代码实现：ended 必须有回收日且 ≥出货日、≤今天；ongoing 携带回收日即拒绝。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`validate`。

验证：

正常流程：PASS。ended 完整日期可保存。

异常流程：PASS。缺失/多余回收日均拒绝。

业务规则：PASS。无“日期不明”选项。

最终结果：**PASS**

问题说明：无。

---

## REQ-H80

需求：回收早于出货、出货/回收未来拒绝；同日允许；不校验跨订单期间重叠；实际回收日与登记时刻分开展示；已结束不占当前关系。

代码实现：日期比较规则明确；不扫描跨订单；`actual_recovery_date` 与 `create_time/ended_time` 分列；ended active 为空。

涉及文件：`PropHistoryEntryService.java`、`PropHistoryEntryMapper.xml`。

涉及方法：`validate`、`save`、`insertRelation`。

验证：

正常流程：PASS。同日可保存。

异常流程：PASS。早于出货/未来拒绝。

业务规则：PASS。无跨订单重叠校验。

最终结果：**PASS**

问题说明：无。

---

## REQ-H81

需求：当前 B 在租时补早期已结束 A 允许且不动 B；把 A 填仍在租则整单拒绝并给处理指引。

代码实现：ended 跳过当前关系；ongoing 查询当前关系并返回占用明细；前端占用弹窗给受付/作业/改号指引。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`save`、`showOccupancy`。

验证：

正常流程：PASS。早期 ended 与 B 并存。

异常流程：PASS。ongoing 整单拒绝。

业务规则：PASS。不改 B/维修。

最终结果：**PASS**

问题说明：无。

---

## REQ-H82

需求：先录 2020-08-10，后补确认 2019-10-15 更早交付时，二次确认展示变化，同事务更新首次日/月/来源及履历；不改当前关系/配置。

代码实现：repeat 本单早于当前首次且填 2019 external fact → action=advance；确认弹窗展示 before→after；`setBaseline` 写首次/月/来源并写事件；不触碰当前关系/配置。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`preview`、`confirmationCells`、`setBaseline`。

验证：

正常流程：PASS。确认后基准前移。

异常流程：PASS。外部日期晚于本单/未来拒绝。

业务规则：PASS。只更新基准与履历。

最终结果：**PASS**

问题说明：无。

---

## REQ-H83

需求：更晚交付不改、同日不自动换源、已有更早外部依据保留；异常来源拒绝，不用 MIN 修复。

代码实现：candidate 晚于/等于 current 时 action=keep；同日 source 保留 current；异常基准 `BASELINE_INVALID`；无 MIN 逻辑。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`preview`。

验证：

正常流程：PASS。更晚/同日 keep。

异常流程：PASS。异常来源拒绝。

业务规则：PASS。已有更早事实保留。

最终结果：**PASS**

问题说明：无。

---

## REQ-H84

需求：基准前移时旧文件/事实不改，新候选按新基准；可人工再次通知，同请求不重复；不自动发通知/报废。

代码实现：基准写入只改产品基准与事件；通知按产品基准生成候选；通知快照读取既有事实；无自动通知调用。

涉及文件：`PropHistoryEntryService.java`、`PropNoticeService.java`。

涉及方法：`setBaseline`、通知候选/快照。

验证：

正常流程：PARTIAL。基准与通知候选有代码证据；旧 PDF 不重写、人工再通知防重未运行。

异常流程：PASS。无自动通知/报废。

业务规则：PARTIAL。需运行验证通知候选与旧文件。

最终结果：**PARTIAL**

问题说明：建议补“基准前移后通知候选/再次通知/旧文件”联调用例。

---

## REQ-H85

需求：历史认定已存在，后来基准前移时原认定依据日/审计保留，标记仍 1，不新建质检；差异有显示和基准履历。

代码实现：`historicalInspection` 只在无质检时插入；基准前移只改产品基准并写事件；已有历史质检日期不更新。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`save`、`setBaseline`、`event`。

验证：

正常流程：PASS。不新建第二次质检。

异常流程：PASS。基准变更失败整单回滚。

业务规则：PASS。保留原认定依据与调整履历。

最终结果：**PASS**

问题说明：页面差异展示需验收。

---

## REQ-H86

需求：真实质检登记晚于历史出货不阻断；真实质检不改，标记与事实合法性仍检查。

代码实现：`checkInspection` 只校验标记、确认人/时刻、来源、历史日期未来，不比较真实质检时间与出货日。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`checkInspection`。

验证：

正常流程：PASS。时间先后不阻断。

异常流程：PASS。标记/事实非法拒绝。

业务规则：PASS。真实质检不覆盖。

最终结果：**PASS**

问题说明：无。

---

## REQ-H87

需求：统一提交确认；历史编辑按 §8.4 白名单；取消/删除/新增发货拒绝；解绑与正常回收仍可用。

代码实现：历史页单一确认弹窗；`updateHistorical` 冻结类型/行/数量，允许订单号/日期/客户/备注；取消拒绝且前端隐藏；无订单删除 API；发货按钮隐藏且服务端拒绝；当前关系解绑按钮保留。

涉及文件：`history-entry/index.vue`、`PropOrderServiceImpl.java`、`order/detail.vue`、`PropShipmentService.java`。

涉及方法：`confirmSave`、`updateHistorical`、`cancel`、`openRelease`、`normalSource`。

验证：

正常流程：PASS。统一确认与白名单编辑。

异常流程：PASS。取消/新增发货服务端拒绝。

业务规则：PASS。解绑/正常回收入口仍在。

最终结果：**PASS**

问题说明：订单删除没有 API；若有其他管理入口可删除，需另行确认（见 UNKNOWN）。

---

## REQ-H88

需求：提交期间基准/占用改变、末尾失败、成功重放时，锁后变化拒绝重新核对；整单及基准共同回滚；重放不重复变更/履历。

代码实现：保存前发现并锁定父订单/寄送/关系/产品，锁后重验；所有写入同一事务；重放先查请求行返回原始结果。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`save`、`discoverParents`、`create`、`replay`。

验证：

正常流程：PASS。成功重放不改数据。

异常流程：PASS。锁后变化 `RECHECK`，整单回滚。

业务规则：PASS。基准/关系中任一失败均回滚。

最终结果：**PASS**

问题说明：真实并发未运行。

---

## REQ-H89

需求：已结束 A 提交期间新增维修/准备/当前 B 不单独构成业务拒绝；不要求结束 B；采用事实变化或必要锁前缀缺失回滚重核，不反向补锁。

代码实现：ended 分支跳过当前关系/阻断作业；保存前发现当前关系/基准父级并锁定，锁后重验；ended 关系 active 为空。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`save`、`discoverParents`。

验证：

正常流程：PARTIAL。静态逻辑允许 ended 与新增 B/维修并存；真实并发与“锁前缀缺失”场景未运行。

异常流程：PARTIAL。锁后重验有代码，但缺失前缀导致的回滚路径未逐一确认。

业务规则：PASS。不反向补锁、不强制结束 B。

最终结果：**PARTIAL**

问题说明：建议做并发注入用例，验证新增维修/准备/B 与 ended 补录的时序。

---

## REQ-H90

需求：现基准 2020，补 2019 再次出租，真实首次 2018；保持 repeat，缺首次日预览 conflict 不能提交，填写后 advance 至 2018，唯一确认后原子保存。

代码实现：repeat 本单早于 current，要求 externalFirstShipmentDate；候选 2018 ≤ 本单 2019；action=advance；统一确认后写外部事实+基准+关系。

涉及文件：`PropHistoryEntryService.java`、`history-entry/index.vue`。

涉及方法：`preview`、`confirmSave`、`save`。

验证：

正常流程：PASS。填写 2018 后 advance。

异常流程：PASS。缺首次日 `EXTERNAL_DATE_REQUIRED`。

业务规则：PASS。保持 repeat，不冒充 first。

最终结果：**PASS**

问题说明：无。

---

## REQ-H91

需求：较早 repeat 首次日期晚于本单、未来或未知，来源半缺时拒绝；本单不早于现基准却携带首次更正时拒绝；不造日期、不改称 first；普通 keep 不开放任意更正。

代码实现：外部日 > 本单/今天拒绝；repeat 本单不早于首次时禁止 external 字段；基准半缺 `BASELINE_INVALID`；first/repeat 模式不变。

涉及文件：`PropHistoryEntryService.java`。

涉及方法：`preview`。

验证：

正常流程：PASS。合法较早外部日 advance。

异常流程：PASS。晚于本单/未来/半缺/多余更正均拒绝。

业务规则：PASS。不自动造日期/改模式。

最终结果：**PASS**

问题说明：无。

---

## REQ-H92

需求：较早 repeat 确认后基准变化、末尾失败及同请求重放时，变化回滚重核；失败无部分事实；成功重放不重复建首次依据或改审计。

代码实现：锁定+锁后重验；外部事实与基准同事务；请求行+结果 JSON 固定重放；外部事实唯一键 `(product_id, request_id)`。

涉及文件：`PropHistoryEntryService.java`、`c06_history_entry.sql`。

涉及方法：`save`、`replay`、`insertFact`、`completeRequest`。

验证：

正常流程：PASS。成功重放返回原结果。

异常流程：PASS。锁后变化/末尾失败整单回滚。

业务规则：PASS。唯一键防重复首次事实。

最终结果：**PASS**

问题说明：真实并发未运行。

---

## 问题汇总

### P0

- 未发现静态代码层面可直接判定的 P0 缺陷：历史订单保存为单事务、历史来源普通写被服务端拒绝、历史订单取消被拒绝、当前关系/唯一身份有锁与唯一约束。

### P1

1. **目标环境部署与页面授权未确认**：迁移 SQL 标 REVIEW ONLY，菜单 SQL 标未执行且不授予角色。代码存在不等于目标环境可使用；若未执行，整个历史补录入口/接口不可用。涉及 `c06_history_entry.sql`、`c06_history_entry_menu.sql`（BR-082）。
2. **“此前已回收”人工确认留痕不足**：前端对所有 `rental_repeat` 自动发送 `previousRecoveryConfirmed=true`，统一确认弹窗仅展示提示，没有逐台确认状态/审计字段（BR-050、H69）。若业务要求可追溯的人工确认，应提升为 P1。

### P2

1. **基准解除 clear 的完整清空路径未验证**：H28/H41/H74 要求 clear 同时清日期、月和所有首次来源，当前只确认了 `correctBaseline` 的 normal 约束，解除关系的 clear 分支未逐条取证。
2. **下游生命周期/通知/受付未端到端验证**：H30/H60/H75/H84 依赖案内、受付、通知 PDF 冻结等模块；本模块代码只证明“历史保存不写旧作业”，不能证明页面与旧文件运行期完全不变。
3. **并发 ended 补录与新增维修/准备/当前 B 的时序未验证**：H89 的“锁前缀缺失回滚重核”静态可见，但需要并发注入确认。
4. **历史质检登记人/时刻的页面语义**：数据库字段正确分离业务日与登记审计，但页面是否明确标注“历史合格认定依据日/登记审计”需验收（H22/H85）。

### P3

1. 历史订单详情出货记录仍展示“状态/查看”列；无编辑/文件/物流操作，但展示是否与“历史只读快照”文案完全一致需页面验收。
2. 目标数据库排序规则下的同号/全半角/尾随空格冲突表现未运行验证（H46）。
3. 菜单 SQL 不授予角色、不启用状态，需部署人员按实际角色另行授权；这是实施事项，不是代码自动完成项。
4. 客户历史创建没有请求号查询/精确重放，符合 spec10-28 §4.1；测试不得把“按原号查不到”判为保存失败。
