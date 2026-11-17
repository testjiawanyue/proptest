# Spec → Code Validation（产品管理模块 product）

- 分析时间：2026-10-23（CST）
- 需求依据：`ai-test/01-requirement/requirement-baseline.md` REQ-029～REQ-040（FEAT-08 产品列表、FEAT-09 部件追溯）
- 代码依据：`ai-test/02-code-analysis/product-code-behavior.md`（BR-001～BR-046），`prop_new` 提交 `5c609fc`
- 判定标准：PASS=代码明确实现且行为一致；PARTIAL=实现部分但存在缺失；FAIL=明确未实现或与需求冲突；UNKNOWN=资料不足无法确认

## REQ-029

需求：

产品基本信息。製造番号=衣体编号终身不变；M番号单调递增、删除不复用、任何界面（含搜索）不显示；对外产品名称首次正式发货按订单采用、可经名称更正事件更新、无事件显「未命名」；衣体规格读当前衣体最新资料规格；业务类型（销售/租赁/未确定）首次发货确认时写入；生命周期基准月由首次发货月确定；首次质检通过日；首次出货日（未出货显「待首次出货」）；资料存放路径手动录入仅展示。

代码实现：

- 製造番号入库时确定终身不变（intakeOne 写入，无更新路径）；更换衣体仅追加事件不改变编号（BR-027）。
- M番号 M+6 位序列配发、删除不复用（BR-016 production）；接口投影含 mNo 字段返回前端，但列表/详情/部件页均无渲染，查询键仅 manufacturing_no/part_no（BR-015）。
- 对外名称/基准月/首次出货日读取 prop_product 列（external_product_name/lifecycle_base_month/first_shipment_date，出货模块写入），未出货显示「待首次出货」、未命名显示「未命名」（BR-010、BR-018）。
- 衣体规格取当前衣体当前资料版本 specification（productProjection bodySpecification）。
- 资料存放路径可录入展示（功能005）。

涉及文件：

- `PropProductionServiceImpl.java`、`PropProductionMapper.xml`、`sql/c03_shipment_wp2.sql`
- `ruoyi-ui/src/views/prop/product/index.vue`、`detail.vue`

涉及方法：

`productList`、`productDetail`、`productProjection`、`updateStoragePath`

验证：

正常流程：PARTIAL

7 项字段展示与派生实现（BR-018），但「业务类型」未实现：prop_product 全部 DDL（c02/c03 迁移）无 business_type 列，代码无该字段任何读写，列表与详情均无展示。

异常流程：PASS

未命名/待首次出货/无基准月文案均按规则显示（BR-010、BR-018、BR-020）。

业务规则：PARTIAL

M番号界面（含搜索）不可见已实现（BR-015）；製造番号终身不变已实现；业务类型「首次发货确认时写入」无实现载体；对外名称「名称更正事件更新」依赖出货模块 PRODUCT_NAME_CHANGED 事件写入（本模块只读展示并按 nameAdoptedShipmentId 去重合并，BR-022）。

最终结果：

PARTIAL

问题说明：

业务类型字段完全未实现（无列、无读写、无展示），属明确缺失（P2）；对外名称/首次出货/基准月的写入口径需出货模块证据回补（P3）。

---

## REQ-030

需求：

生产阶段自动判定。按事实判定在制/待质检/已完成质检并列表与详情一致展示；位置 2 始终可空；已完成质检后拆除必需部件不退回在制；阶段不可人工设置。

代码实现：

- SQL `productProjection` 派生 productionStage：有质检记录=inspected；气囊+传感器+发生器位置1 三槽位齐=ready；否则 in_progress（XML L56-58）；`productListStage`（ServiceImpl L238-244）同口径按行派生；`stage` 筛选 choose 分支同口径（XML L131-152）。
- 阶段仅由绑定与质检事实派生，全工程无人工设置入口。

涉及文件：

`PropProductionServiceImpl.java`、`PropProductionMapper.xml`、`product/index.vue`、`detail.vue`

涉及方法：

`productListStage`、`productProjection`、`productListFilters`

验证：

正常流程：PASS

三态派生一致（列表、详情、筛选、组装页齐全计数同口径），位置 2 不参与构成（BR-014）。

异常流程：PASS

Spec 未明确异常；缺件产品 in_progress 正常派生。

业务规则：PASS

已完成质检后拆除必需部件：阶段判定首条件为「存在质检记录」，拆件后仍 inspected 不回退（BR-014）；阶段不可人工设置（无写入口径）。

最终结果：

PASS

问题说明：

无。

---

## REQ-031

需求：

产品列表查询与筛选。范围/单件/部件反查三方式；起止均填写才生效否则清除范围条件；阶段默认已完成质检、下拉即时生效；单件/反查命中直达详情、未命中分别提示；重置保留阶段/前缀/模式；表格列与派生展示规则；排序按製造番号数字后缀升序；分页 20 条/页显示总数；无匹配空状态；历史跳转链接不提供。

代码实现：

- 三种查询方式、阶段默认 inspected、下拉即时生效、命中直达/未命中提示、重置保留规则、20 条/页总数、列展示均实现（BR-001～BR-011）。
- 排序：`selectProductPageIds` 为 `create_time desc, product_id desc`（BR-008）。
- 起止只填一个：前端 productionRangeError 警告「范围筛选需同时填写开始和结束编号」且不发请求；后端同样抛错（BR-002），并非「清除范围条件」。
- 订单号、番号纯文本无跳转链接（BR-010、BR-011）。

涉及文件：

`PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`、`product/index.vue`、`propProduction.mjs`

涉及方法：

`productList`、`selectProductPageIds`、`search`、`reset`、`productionRangeError`

验证：

正常流程：PARTIAL

查询方式与筛选行为主体实现；排序与需求不一致（创建时间降序而非製造番号数字升序）；起止未成对时按报错处理而非静默清除条件。

异常流程：PASS

无匹配空状态与提示实现（BR-003、BR-004）。

业务规则：PARTIAL

列展示/分页/总数/无链接符合；排序口径偏差（BR-008）；范围条件清除规则偏差（BR-002）。

最终结果：

PARTIAL

问题说明：

①排序为 create_time desc, product_id desc，需求要求製造番号数字后缀升序（P2）；②起止未成对处理与需求「清除范围条件」不符（P3，交互差异）。

---

## REQ-032

需求：

产品删除。四类阻断（当前绑定非衣体部件/已存在质检记录/已存在出货记录含准备中/已存在受付记录，不得增加其他条件）；阻断弹窗一次性列出全部原因；无阻断二次确认后删除，产品与衣体退出当前有效范围、历史保留、非衣体部件不删除、M番号不复用、编号可重新入库；不新增作废/恢复/回收站。

代码实现：

- `productDeleteBlockers`（L635-645）四类阻断与需求完全一致，前端 Modal.error 一次性列出全部命中原因（BR-035）。
- `deleteProduct`（L647-665）：行锁、逐类拦截、结束衣体绑定、软删衣体与产品（历史原值保留、active 编号释放）；非衣体部件不动（BR-036、BR-037）。
- 确认弹窗文案覆盖退出范围/历史保留/非衣体部件不删除/M番号不复用/可重新入库（index.vue askDelete）。
- 无作废/恢复/回收站实现（符合「不新增」）。

涉及文件：

`PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`、`product/index.vue`

涉及方法：

`productDeleteBlockers`、`deleteProduct`、`retainedShipmentProduct`、`retainedReception`、`hasInspection`

验证：

正常流程：PASS

无阻断删除链路完整（BR-036、BR-037），行即时消失（列表刷新）。

异常流程：PASS

四类阻断拦截与一次性列示实现（BR-035）。

业务规则：PARTIAL

阻断集合与需求一致（retainedShipmentProduct 含准备中 prop_shipment_product 全部记录，未缩小为仅正式寄出）；历史保留经事件流与软删实现。「删除衣体不计入入库记录有效成员；无有效成员入库记录不作为有效记录展示」无实现载体：全工程无入库记录查询功能（同 production 模块 REQ-025 结论）。

最终结果：

PARTIAL

问题说明：

入库记录展示口径子规则无法确认（无实现载体，P3）；其余阻断与删除行为与需求一致。

---

## REQ-033

需求：

产品详情-部件操作。气囊/发生器：更换、拆除；传感器：更换、版本升级、拆除；未安装部件（仅在制/待质检）：补录；更换弹窗资料默认旧部件当前资料；发生器更换保持原位置；拆除确认；版本升级追加不覆盖；资料不一致经确认（以所选资料为准追加更正记录）；与组装工作台共用冲突逻辑；不提供对外名称设定/更正按钮；衣体不支持补录。

代码实现：

- 操作入口按槽位/是否已装/阶段/报废显示（BR-028）：body=更换衣体、已装=更换+拆除（传感器+版本升级）、未装且 stage≠inspected=补录、报废全隐藏。
- 弹窗资料默认旧部件当前资料（partForm.profileId=row.profileId）、发生器位置 1/2 独立行独立按钮（BR-029）。
- 复用 saveAssembly/removeBinding/updateFirmware：更换确认、资料不一致 profile 确认（与组装页同一服务端逻辑，BR-030）、拆除二次确认（BR-031）、固件追加（BR-032）。
- 无对外名称设定/更正按钮、无解除订单关系入口（BR-034）；body 行无补录（补录按钮不含 body 槽位——补录分支只在非 body 的未安装槽位显示，见 detail.vue L84-116 结构）。

涉及文件：

`PropProductionController.java`、`PropProductionServiceImpl.java`、`detail.vue`、`propProduction.mjs`

涉及方法：

`saveAssembly`、`removeBinding`、`updateFirmware`、`submitPart`、`askRemove`、`openFirmware`

验证：

正常流程：PASS

四类操作与弹窗行为完整实现（BR-028～BR-032）。

异常流程：PASS

编号必填、他产品占用、类型不符、资料不一致确认/取消均实现（BR-029、BR-030 及 production BR-026/027/041）。

业务规则：PASS

共用冲突逻辑（同一 saveAssembly 入口）；追加不覆盖；无名称设定入口（BR-034）；衣体不补录（BR-028）。

最终结果：

PASS

问题说明：

更换且资料不一致时为两次顺序确认（replacement→profile），与 production REQ-026 同一已知偏差（P2 已在 production-spec-code 登记，此处不重复计）。

---

## REQ-034

需求：

更换衣体事件。弹窗确认「请确认线下已完成实物更换。产品、製造番号、系统衣体身份与绑定保持不变，确认后登记更换衣体事件。」；确认后仅登记事件；历史显示「更换衣体」；不新建衣体、不解绑、不产生可删除旧衣体；不显示新旧编号；取消无变化；不引导组装绑定新衣体。

代码实现：

- `replaceBody`（L619-634）：仅追加 BODY_PHYSICAL_REPLACED 事件（内容「更换衣体」，无新旧编号字段），不建衣体/不解绑/不改资料（BR-027）。
- 确认弹窗文案「请确认线下已完成实物更换。产品、製造番号、系统衣体身份与绑定保持不变。」（较需求少末尾「确认后登记更换衣体事件。」半句，语义一致）；取消无请求；成功后停留详情页刷新，无组装引导（detail.vue askBody）。

涉及文件：

`PropProductionController.java`、`PropProductionServiceImpl.java`、`detail.vue`

涉及方法：

`replaceBody`、`askBody`

验证：

正常流程：PASS

确认登记事件、身份/编号/绑定不变（BR-027）。

异常流程：PASS

取消不产生事件；报废/删除产品被 requireMutable 拦截。

业务规则：PASS

不新建/不解绑/不产生可删除旧衣体（无任何部件写操作）；事件不含编号对照（BR-027）。

最终结果：

PASS

问题说明：

弹窗文案与需求逐字差异（少「确认后登记更换衣体事件。」），不影响行为（P3 备注）。

---

## REQ-035

需求：

生命周期日程。未出货空状态「首次出货后生成生命周期日程」；固定 5 行（1～4 年定期点检、第 5 年报废计划）；计划年月=基准月+N 年；实际记录有事实显「已计入·日期」或「已报废·日期」，无记录显「尚无实际记录」。

代码实现：

- 空状态与 5 行计划（基准月+N 年、第 5 年报废计划）实现（BR-020）。
- 实际记录：匹配 eventType='SERVICE_RECEPTION' 且 inspectionYear=N 的事件显示「已计入 · 日期」，否则显示「—」（BR-021）；无「尚无实际记录」文案、无「已报废·日期」分支。

涉及文件：

`detail.vue`（lifecycleRows L329-345）

涉及方法：

`lifecycleRows`

验证：

正常流程：PARTIAL

计划推算与空状态实现；实际记录展示与需求两处不符：无记录文案为「—」而非「尚无实际记录」；无「已报废·日期」处理。

异常流程：PASS

未出货空状态符合（BR-020）。

业务规则：PARTIAL

推算方式一致；实际记录展示口径偏差（BR-021）；SERVICE_RECEPTION 事件由受付模块写入，匹配口径（inspectionYear）依赖受付模块证据。

最终结果：

PARTIAL

问题说明：

无记录年度占位文案与「已报废」展示缺失（P3）；实际记录来源依赖受付模块（P3 待回补）。

---

## REQ-036

需求：

相关业务历史。统一时间线分 6 页签：全部（默认）/生产与资料/出货与订单/点检与维修/部件与版本/返送与最终去向；倒序；每条含事件内容、操作人（无值显 system）、业务时间；「部件与版本」页签操作人统一显 system；全部页签为其余 5 个完整合集；订单号番号纯文本；不提供历史编辑。

代码实现：

- 页签 5 个：全部/生产与部件/出货与订单/点检与维修/返送与最终去向（BR-023）；无「部件与版本」页签。
- 全部页签=四类合集（productHistoryCategory 非空即纳入）；倒序（sortHistory）；操作人=createBy 空值 system（BR-024，无按页签统一 system 规则）；事件描述含字段级差异（BR-025）；纯文本无链接；无编辑入口。

涉及文件：

`detail.vue`、`propProduction.mjs`、`PropProductionServiceImpl.java`

涉及方法：

`productHistoryIncludes`、`productHistoryCategory`、`productHistoryActor`、`productionEventDisplay`

验证：

正常流程：PARTIAL

时间线主体与分类过滤实现；页签数量与「部件与版本」页签缺失（该页签的操作人统一 system 规则随之无实现）。

异常流程：PASS

空分类显示「尚无相关记录」。

业务规则：PARTIAL

全部页签为合集、纯文本、无编辑入口符合；6 页签结构不符（BR-023、BR-024）。

最终结果：

PARTIAL

问题说明：

缺「部件与版本」页签及其操作人统一 system 规则（P2）；「生产与资料」页签名实为「生产与部件」（P3 文案差异）。

---

## REQ-037

需求：

产品资料存放路径录入。详情输入框录入，失焦或回车保存；不提供打开或校验；仅记录展示。

代码实现：

- 详情「资料存放路径」展示+「编辑」按钮 → Modal 输入 → 「保存」按钮提交（BR-026）；非输入框失焦/回车即存。
- ≤500 字符校验、空值归一、仅记录不打开（updateStoragePath L610-618）。

涉及文件：

`PropProductionController.java`、`PropProductionServiceImpl.java`、`detail.vue`

涉及方法：

`updateStoragePath`、`savePath`

验证：

正常流程：PARTIAL

保存与展示实现；保存交互为弹窗按钮保存，与需求「失焦或回车保存」不同。

异常流程：PASS

超长拦截、删除产品拦截（BR-026）。

业务规则：PASS

不提供打开或校验（无任何打开/解析逻辑），仅记录展示。

最终结果：

PARTIAL

问题说明：

录入交互方式与需求描述不符（弹窗保存 vs 失焦/回车即存，P3）；核心记录功能与验收标准（可保存展示、不触发打开校验）满足。

---

## REQ-038

需求：

部件追溯查询与详情。筛选：类型/关键词（编号片段）/资料/当前归属；即时生效、重置恢复；列：编号（等宽）/类型/当前资料/当前归属/首次登记（来源+日期）；详情弹窗基础信息一行三列+履历时间线（倒序限高滚动）；履历含首次登记/安装/解除安装/撤销安装/被更换/资料更正（从哪份到哪份）/固件变更，操作人有记录显示；历史引用属原部件身份，删除后历史可读不重定向；无跳转；只查当前有效部件。

代码实现：

- `selectParts` 四条件+当前有效过滤+归属 join（BR-038、BR-039）；前端即时查询/重置/列展示（功能009）。
- `partDetail`：基础信息+事件履历（partId 或 relatedPartId 命中含被更换）+合成首次登记事件（BR-040）；倒序限高滚动、操作人显示、纯文本（BR-041）。
- 资料更正展示「从哪份到哪份」字段级差异（BR-025）；已删除档案历史经事件流（part_no 原值永久保留列）可读，不按同编号新档案重定向（事件关联 partId 原身份）。

涉及文件：

`PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`、`part/index.vue`、`propProduction.mjs`

涉及方法：

`parts`、`selectParts`、`partDetail`、`selectPartEvents`

验证：

正常流程：PASS

筛选/列表/详情履历完整实现（BR-038～BR-041）。

异常流程：PASS

无匹配空状态；部件不存在/已删除报错页（功能010）。

业务规则：PASS

只查当前有效（BR-039）；历史按 partId 身份关联、part_no 历史原值列保留可读、不重定向（DDL idx_part_no_history）；无跳转（BR-041）。

最终结果：

PASS

问题说明：

「撤销安装」事件类型：代码事件流无独立「撤销安装」类型，解除安装统一为 PART_REMOVED（拆除）；履历覆盖需求列举的各类事实，口径差异属命名层面（P3 备注）。

---

## REQ-039

需求：

部件导出 Excel。按当前筛选结果导出，列与页面一致。（Spec 边界注明 2026-09-21 核对时尚未实施。）

代码实现：

- `exportParts`（L132-145，`prop:part:page`）：按当前筛选全量查询，`PropPartExportRow.from` 转换五列（编号/类型/当前资料/当前归属/首次登记，与页面列一致），ExcelUtil 输出（BR-042）。
- 前端「导出」按钮下载 `部件追溯_日期.xlsx`（part/index.vue exportRows）。

涉及文件：

`PropProductionController.java`、`PropPartExportRow.java`、`part/index.vue`

涉及方法：

`exportParts`、`PropPartExportRow.from`

验证：

正常流程：PASS

导出链路完整，列与页面一致（BR-042）。

异常流程：PASS

Spec 未明确；无结果时导出为空文件（ExcelUtil 默认行为）。

业务规则：PASS

内容与页面列一致（BR-042）。

最终结果：

PASS

问题说明：

需求边界注明的实现差距已消除：当前代码已实现导出（c02 迭代内 `exportParts`+`PropPartExportRow`）。

---

## REQ-040

需求：

部件删除。唯一阻断=当前存在有效绑定（曾经绑定/履历/固件历史不阻断，不得新增限制）；未绑定二次确认后删除，退出当前有效范围、记录删除时间与操作人、历史保留可读不以孤立 ID 代替、编号可重新登记为独立身份不继承旧历史、不按编号转向新档案；衣体当前绑定时同样阻断；不新增恢复/回收站/启停。

代码实现：

- `deletePart`（L598-609）：唯一阻断为 selectActiveBindingByPart 当前有效绑定（BR-043）；软删记录删除人/时间（softDeletePart XML L320）。
- 编号释放：active_part_no 置空，uk_part_active_no 只约束当前有效，同编号可重新建档为独立身份（BR-044）。
- 历史保留：事件流按 partId 关联原身份，part_no 历史原值列永久保留；已删除部件不可更正/升级/安装（BR-045）。
- 衣体删除不走此入口（详情无衣体删除按钮；产品删除随删衣体且同样要求无有效绑定的逆命题——衣体当前绑定时 deletePart 同样被 selectActiveBindingByPart 阻断）。
- 无恢复/回收站/启停实现。

涉及文件：

`PropProductionController.java`、`PropProductionServiceImpl.java`、`PropProductionMapper.xml`、`part/index.vue`

涉及方法：

`deletePart`、`lockPart`、`selectActiveBindingByPart`、`softDeletePart`

验证：

正常流程：PASS

未绑定确认删除链路完整（BR-043、BR-044）。

异常流程：PASS

绑定阻断前后端双重（前端预检+后端行锁复检，BR-043）。

业务规则：PASS

唯一阻断条件与需求一致（无历史类附加条件）；历史保留经事件流与 part_no 原值列；编号独立重登记（BR-044）；已删除部件不可再操作（BR-045）。

最终结果：

PASS

问题说明：

无。

---

## 问题汇总

### P0

无。

### P1

无。

### P2

- REQ-029：「业务类型（销售/租赁/未确定，首次发货确认时写入）」完全未实现，prop_product 无 business_type 列、代码无读写、界面无展示。
- REQ-031：产品列表排序为 create_time desc, product_id desc，与需求「製造番号数字后缀升序」不一致（selectProductPageIds XML L158-161）。
- REQ-036：相关业务历史为 5 页签，缺「部件与版本」页签及该页签操作人统一显 system 规则（detail.vue historyTabs L316-322）。

### P3

- REQ-029：对外名称/首次出货日/基准月写入口径依赖出货模块证据回补。
- REQ-031：范围起止只填一个时按报错处理，与需求「清除范围条件」不符。
- REQ-032：入库记录有效成员展示口径无实现载体（同 REQ-025 结论）。
- REQ-035：生命周期无记录年度显示「—」而非「尚无实际记录」；无「已报废·日期」分支。
- REQ-037：存放路径为弹窗按钮保存，与需求「失焦或回车保存」不符。
- REQ-034：更换衣体确认弹窗文案较需求少「确认后登记更换衣体事件。」（语义一致）。
- REQ-038：「撤销安装」无独立事件类型，统一为 PART_REMOVED（命名口径差异）。
