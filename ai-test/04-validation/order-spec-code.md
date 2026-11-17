# Spec → Code Validation：订单管理（order）

分析时间：2026-10-26（CST）。
代码依据：`ai-test/02-code-analysis/order-code-behavior.md`（BR-001～BR-052）。
需求依据：`ai-test/01-requirement/requirement-baseline.md` REQ-041～REQ-056、REQ-103。

## REQ-041

需求：订单资料记录与保存（必填项、默认当天/销售、快照、编号自动生成、状态有效）。

代码实现：POST /prop/order 经 normalizeCommand 校验必填与枚举，applyCommand 保存三方主体/地址/联系人 JSON 快照，assignNumber 生成 [I/R/D]+YY+NNNN 编号，订单状态 active（BR-008～BR-015）。

涉及文件：PropOrderServiceImpl.java、PropOrderMapper.xml、form.vue

涉及方法：create、createInTransaction、normalizeCommand、applyCommand、assignNumber

验证：

正常流程：PASS

快照、编号、默认值（前端 form.vue:765 默认 direct 与当天受注日）均实现。

异常流程：PASS

必填缺失/数量非法/名称不一致分别抛对应业务异常并回滚（BR-013/014/015）。

业务规则：PASS

编号成立时取得、编辑取消不更换（编号只在 create 写入）；客户区分/請求書先提示由前端实现（form.vue:149-155）。

最终结果：

PASS

问题说明：

請求書先不同仅提示不阻断由前端 alert 实现（form.vue:149-155），服务端不校验；与需求一致。

---

## REQ-042

需求：订购内容行（颜色手输、数量正整数、多行同名、已履约自动统计、行数量不得低于已交付）。

代码实现：行数量校验（quantityPositive/quantityRequired，BR-014）；新建名称唯一、编辑名称规则（BR-013）；已履约=delivery_valid=1 关系数派生并在详情展示（BR-003）；编辑时订单总量不得低于有效交付数（quantityBelowFulfilled，BR-016）；最后一行不可删由前端禁用（form.vue:287 lines.length===1）。

涉及文件：PropOrderServiceImpl.java、detail.vue、form.vue

涉及方法：normalizeCommand、validateEditedProductNames、update

验证：

正常流程：PASS

异常流程：PASS

业务规则：PASS

“行数量不得低于已履约”实际按订单总量校验；因已履约只统计总数不按行拆分（需求同口径），总量校验与该口径自洽。

最终结果：

PASS

问题说明：

最后一行不可删除仅前端禁用，服务端未强制（提交空行集合时以 lineRequired 拦截，效果等价）。

---

## REQ-043

需求：订单就地新增/编辑地址与联系人，保存入主档并自动选用，取消订单表单不回滚。

代码实现：四组就地接口（createAddress/updateAddress/createContact/updateContact），校验邮编 7 位数字+地址1必填、联系人姓名必填，归属校验，幂等重放（BR-021～BR-023）。

涉及文件：PropOrderServiceImpl.java、PropOrderController.java

涉及方法：createAddress、updateAddress、createContact、updateContact

验证：

正常流程：PASS

异常流程：PASS

业务规则：PASS

就地保存直接写 prop_customer_address/prop_customer_contact，独立于订单表单事务。

最终结果：

PASS

问题说明：

无。

---

## REQ-044

需求：订单列表多条件查询、每页 10 条、空态、重置。

代码实现：selectOrderList 组合条件（关键词四项、制造番号、类型、客户区分、履约、状态、受注日/预计发货日范围），固定每页 10 条（BR-001～BR-006）；前端空态文案 order.empty.orders（index.vue:236-241）。

涉及文件：PropOrderMapper.xml、PropOrderController.java、index.vue

涉及方法：list、normalizeQuery、selectOrderList

验证：

正常流程：PASS

异常流程：PASS

查询无匹配返回空列表，不建记录。

业务规则：PASS

预计发货日范围排除 NULL；受注日含边界；无列排序（SQL 固定 create_time DESC）。

最终结果：

PASS

问题说明：

关键词匹配范围与 Spec 一致（四项）；V5 用例“关键词搜索产品名称与颜色”超出 Spec 与代码，属用例侧待澄清（见 order-code-test-v5.md）。

---

## REQ-045

需求：订单详情一页展示（进度、信息、关系、配送、订购内容、出货记录、产品关联、操作记录）。

代码实现：detail 聚合订单行+寄送列表+关系+快照解析；寄送排序 COALESCE(confirmed_time,create_time) DESC；已删准备不回显；操作记录分页 10 倒序（BR-006/007；功能002）。

涉及文件：PropOrderServiceImpl.java、PropShipmentService.java、PropShipmentMapper.xml、detail.vue

涉及方法：detail、operations、orderShipments、orderRelations

验证：

正常流程：PASS

异常流程：PASS

订单不存在抛 notFound（前端显示依赖前端处理，存在对应文案键）。

业务规则：PASS

最终结果：

PASS

问题说明：

各卡片空态文案为前端 i18n 资源，未逐条核对文案字面（属展示差异低风险）。

---

## REQ-046

需求：取消订单（原因必填、终止后续履约、保留历史出货与产品关联、不自动建受付/回收/报废）。

代码实现：cancel 校验原因必填≤1000、乐观锁、幂等；同事务 releaseCancelledOrder 释放准备中寄送产品占用；状态置 cancelled 并写操作记录（BR-018/019）；取消后编辑/新建寄送/确认/文件生成被服务端拒绝（BR-020）；前端弹窗在已有有效交付时显示警告（detail.vue:444-446）。

涉及文件：PropOrderServiceImpl.java、PropShipmentService.java、detail.vue

涉及方法：cancel、releaseCancelledOrder

验证：

正常流程：PASS

异常流程：PASS

业务规则：PASS

最终结果：

PASS

问题说明：

取消时释放准备中寄送产品占用为 Spec 之外的实现细节（Spec 未明确准备中寄送去向），行为合理：准备保留但不可确认。

---

## REQ-047

需求：解除产品关联（否定错误交付、扣减履约、产品回成品在库、历史保留；输入：无，不要求选择原因）。

代码实现：release 实现关系结束、delivery_valid=0、结束原因 unlink、历史保留（BR-026）；但强制要求 baselineAction=keep/clear（BR-024），Spec 未定义该输入。

涉及文件：PropOrderRelationService.java、PropOrderRelationController.java、detail.vue

涉及方法：release

验证：

正常流程：PARTIAL

解除主流程实现，但代码要求额外的基准处理选择（保留或清除产品首次出货/基准月），超出 Spec 输入定义；前端弹窗要求必选（detail.vue:387-396）。

异常流程：PASS

已结束→4601、多当前关系→409、身份变化→4601，覆盖 Spec 三类异常。

业务规则：PASS

履约扣减为派生口径（delivery_valid），历史保留；与受付确认回收为不同动作（endForRecovery 独立路径）。

最终结果：

PARTIAL

问题说明：

P2：代码新增 baselineAction 必选输入（keep/clear），Spec 未规定；需确认产品基准月清除策略是否应作为解除关联的一部分暴露给营业。

---

## REQ-048

需求：新建/编辑订单提交（校验失败无数据变化且保留输入；编辑保留订单身份与交付归属）。

代码实现：normalizeCommand+validateEditedProductNames+乐观锁+事务回滚（BR-013～BR-017）；校验失败整体回滚。

涉及文件：PropOrderServiceImpl.java、form.vue

涉及方法：create、update

验证：

正常流程：PASS

异常流程：PASS

业务规则：PASS

最终结果：

PASS

问题说明：

“校验失败保留输入”为前端行为（不跳转即保留），未逐行核对但 form 未在失败时清空，符合常规实现。

---

## REQ-049

需求：注文管理番号 [I/R/D][YY][NNNN]，年度共用序列，新年重置，历史编号原值保留。

代码实现：assignNumber 按 prop_fulfillment_sequence(scope='order') 行锁递增；前缀 I/R/D；取消/编辑不更换（BR-009）；无任何重编号/迁移逻辑。

涉及文件：PropOrderServiceImpl.java、PropOrderMapper.xml

涉及方法：assignNumber

验证：

正常流程：PASS

异常流程：PASS

序列未配置（sequenceUnconfigured）与耗尽（>9999）均有显式报错。

业务规则：PASS

历史编号保留：代码不回写 order_no（generated_no 并存），无迁移。

最终结果：

PASS

问题说明：

无。

---

## REQ-050

需求：交付进度口径（订单数量/当前有效交付/剩余可发/历史累计出货；三种进度状态；剩余可发不显负数）。

代码实现：派生列 total_quantity/fulfilled_quantity/historical_quantity（PropOrderMapper.xml:32-36）；三态筛选（BR-003）；create 寄送时阻止超剩余可发（BR-029）。

涉及文件：PropOrderMapper.xml、PropShipmentService.java、detail.vue、index.vue

涉及方法：selectOrderList、loadAggregate、create（shipment）

验证：

正常流程：PASS

异常流程：PASS

业务规则：PARTIAL

后端口径齐全；“剩余可发不显示负数”属前端展示，未逐行确认前端是否做 max(0) 处理（UNKNOWN 项见行为模型第 5 节）。

最终结果：

PASS

问题说明：

P3：前端负数防显示未逐行确认，建议运行态抽查。

---

## REQ-051

需求：寄送记录（SH 编号、快递公司二选一、寄送日期、箱数、面单张数 1-99、运单号可多个、文件版本）。

代码实现：SH 独立年度序列（BR-028）；carrier 白名单（BR-032）；boxCount 正整数可空（BR-034）；运单号去重可空多个（BR-034）；面单张数 copies 1-99 一版本（BR-045）；文件版本递增不覆盖（BR-047）；收货快照只读（BR-030）。

涉及文件：PropShipmentService.java、PropShipmentDocumentService.java、ShipmentDrawer.vue

涉及方法：create、save、applyFields

验证：

正常流程：PASS

异常流程：PASS

业务规则：PASS

运单号唯一消费场景为邮件正文（createMail 快照含 trackingNumbers）。

最终结果：

PASS

问题说明：

无。

---

## REQ-052

需求：寄送抽屉产品与文件管理（准备中增删、移除确认、文件版本行、已寄出无操作列、收货只读、底部提示）。

代码实现：addProducts/removeProduct 仅准备中（BR-036/038）；文件版本列表随 aggregate 返回；前端 locked 态隐藏操作（ShipmentDrawer.vue locked 绑定）；底部“打印不代表寄出”提示存在（ShipmentDrawer.vue:168,273）。

涉及文件：PropShipmentService.java、ShipmentDrawer.vue

涉及方法：addProducts、removeProduct、aggregate

验证：

正常流程：PASS

异常流程：PASS

业务规则：PASS

最终结果：

PASS

问题说明：

无。

---

## REQ-053

需求：寄送文件生成（面单 N 张一版本、纳品书、保障确认书；无产品按钮不可用；不登记寄出）。

代码实现：documents create 生成版本并冻结快照（BR-045～047）；服务端要求清单非空（products() require，BR-045）；PDF 强制 1 部、waybill 1-99；文件生成不改状态。

涉及文件：PropShipmentDocumentService.java、PropShipmentDocumentController.java

涉及方法：prepare、create、result、content

验证：

正常流程：PASS

异常流程：PASS

无产品时服务端拒绝（属 Spec 未明确但一致的保护）；前端按钮禁用未逐行核对。

业务规则：PASS

最终结果：

PASS

问题说明：

模板内容属部署配置（c05d_delivery_package_template_config.sql），版式未核对（Spec 声明临时内容）。

---

## REQ-054

需求：保障确认书归属单笔发货、仅含生成时该笔清单、版本独立、随准备删除。

代码实现：products(id) 仅取本寄送清单（BR-045）；版本按 shipment+type 递增（BR-047）；删除准备 clearFiles 级联删除全部文件含保障确认书（BR-039）。

涉及文件：PropShipmentDocumentService.java、PropShipmentService.java

涉及方法：products、delete

验证：

正常流程：PASS

异常流程：PASS

业务规则：PASS

最终结果：

PASS

问题说明：

无。

---

## REQ-055

需求：确认寄出（前置：快递公司已选、≥1 台；登记事实、冻结清单、建立关系、生成邮件 v1、履约增加、首次出货基准月）。

代码实现：confirm 全部前置校验（BR-040）、幂等（BR-041）、关系建立+adoptFirst 基准写入+邮件 v1（BR-042/043）；运单号重复拦截（trackingDuplicate，BR-034）。

涉及文件：PropShipmentService.java、ShipmentDrawer.vue

涉及方法：confirm、createMail、adoptFirst、insertRelation

验证：

正常流程：PASS

异常流程：PASS

业务规则：PASS

确认后无撤回/冲正入口（仅 release 否定交付路径）。

最终结果：

PASS

问题说明：

无。

---

## REQ-056

需求：已寄出后有限字段维护（快递公司/日期/箱数/运单号）+准备删除（级联、已寄出前后端禁止删除）。

代码实现：save 白名单四字段（BR-031）；已寄出改日期同步更正产品基准（BR-033）；邮件新版本手动生成（BR-044）；delete 仅准备中，服务端 shippedCannotDelete（BR-039）；前端已寄出无删除入口（ShipmentDrawer.vue locked）。

涉及文件：PropShipmentService.java、ShipmentDrawer.vue

涉及方法：save、delete、generateMail

验证：

正常流程：PASS

异常流程：PASS

业务规则：PASS

最终结果：

PASS

问题说明：

无。

---

## REQ-103

需求：订单批量打印面单（仅准备中、快递公司必选、逐笔一张数 1-99 一版本、回写快递公司、不登记寄出、汇总栏）。

代码实现：batchPreparations 仅准备中+有效订单（BR-049）；batchCreate carrier 必选、逐笔一版本、revision 条件回写快递公司、幂等（BR-050）；前端 batchPrint.vue 汇总栏与张数 1-99（:72-74,181-185）。

涉及文件：PropShipmentDocumentService.java、PropShipmentMapper.xml、batchPrint.vue

涉及方法：preparations、batchPrepare、batchCreate、batchResult、batchContent

验证：

正常流程：PASS

异常流程：PASS

未勾选时 items 空被拒（“発送準備を選択してください”）；切换快递公司为前端状态不影响已勾选。

业务规则：PASS

无打印批次台账（仅文件版本行）；无纳品书/保障确认书批量入口。

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

- REQ-047：解除产品关联要求 baselineAction（keep/clear）必选输入，Spec 声明“不要求选择原因”且未定义基准处理选项；需业务确认清除产品首次出货/基准月的适用场景（PropOrderRelationService.java:62-63）。

### P3

- REQ-050：前端“剩余可发”负数防显示未逐行确认，建议运行态抽查（order-code-behavior.md 第 5 节 UNKNOWN-1）。
- 各空态/提示文案以 i18n 资源为准，未逐字核对（展示低风险）。
- 历史 SHP 形态寄送号按原值保留：代码无重编号逻辑，但历史数据是否存在无法确认。
