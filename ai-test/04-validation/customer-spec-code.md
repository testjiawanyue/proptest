# Spec → Code Validation

验证时间：2026-10-19（CST）。  
验证范围：客户管理模块，对应 REQ-009～REQ-017。  
需求输入：`ai-test/01-requirement/requirement-baseline.md`。  
代码输入：`ai-test/02-code-analysis/customer-code-behavior.md`。  
判定原则：只依据需求基线和已记录的代码行为；函数名、注释、行业常识和推测不作为通过依据。下游模块或运行环境证据不足时不外推为通过。

## REQ-009

需求：

建立公司级客户主档。公司名称为必填，默认客户区分限定直販/代理且新建默认直販，资料路径仅记录展示。系统新建编号为 `C + 连续数字`，公司与支店共用序列，编号终身不变；历史导入客户沿用原编号；系统记录创建和修改信息；公司无删除入口。

代码实现：

`POST /prop/customer/company` 创建公司。Service 强制主体类型为 `company`、所属公司为空；名称裁剪后必填；客户区分为空时默认 `direct`，仅允许 `direct/agency`；资料路径裁剪后保存。编号通过 `prop_customer_number_lock` 行锁串行分配，从现有 `C[0-9]+` 最大数字加 1，并格式化为 `C%05d`。编辑时后端用当前数据库值覆盖提交的客户编号，前端编号输入框只读。数据库 `customer_no` 有唯一约束，可保存非 C 格式编号；但当前代码库没有历史导入程序。

涉及文件：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropCustomerController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/service/impl/PropCustomerServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/customer/PropCustomerMapper.xml`
- `prop_new/sql/c01_master_data_and_customer.sql`
- `ruoyi-ui/src/views/prop/customer/components/CustomerEditor.vue`
- `ruoyi-ui/src/views/prop/customer/index.vue`

涉及方法：

- `PropCustomerController.createCompany`
- `PropCustomerServiceImpl.createCompany`
- `PropCustomerServiceImpl.validateSubject`
- `PropCustomerServiceImpl.insertAggregate`
- `PropCustomerServiceImpl.update`
- `CustomerEditor.vue` 的 `openAddCompany`、`submit`

验证：

正常流程：PASS

公司新建、默认客户区分、资料路径、共享编号生成、创建审计字段和保存后跳详情均有明确实现。

异常流程：PASS

名称、客户区分、地址、联系人校验失败会拒绝提交；新建整体在事务中，任一失败回滚。编号锁缺失有明确错误。

业务规则：PARTIAL

系统新建编号和编号不可变已实现；客户区分限定已实现；公司无删除入口已实现。历史导入编号只表现为 `customer_no` 字段可保存任意唯一字符串，当前代码没有导入流程，也没有独立历史编号字段，无法证明“历史导入客户直接使用原系统编号”已经落地。

最终结果：

PARTIAL

问题说明：

需要补充或确认历史数据导入实现及导入后 `customer_no` 数据。当前只能确认数据库和查询逻辑兼容非 C 编号。

---

## REQ-010

需求：

在既有公司下建立支店/现场，支店名称必填，资料路径选填；编号规则与公司共用；所属公司由上下文确定且之后不可更换；支店不保存客户区分，显示时读取公司值；支店可删除并级联删除地址、联系人。

代码实现：

`POST /prop/customer/company/{companyId}/site` 创建支店。Service 先确认路径主体存在且类型为 `company`，再强制 `subjectType=site`、写入 `companyId`、清空 `defaultCustomerType`。新建编号与公司共用同一锁和最大 C 编号逻辑。编辑时所属公司变化会被拒绝，支店客户区分被强制为空。支店详情 SQL 联查公司并返回公司的默认客户区分。`DELETE /prop/customer/site/{siteId}` 只允许支店，并按联系人、地址、支店顺序级联删除。

涉及文件：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropCustomerController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/service/impl/PropCustomerServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/customer/PropCustomerMapper.xml`
- `ruoyi-ui/src/views/prop/customer/detail.vue`
- `ruoyi-ui/src/views/prop/customer/components/CustomerEditor.vue`

涉及方法：

- `PropCustomerController.createSite`
- `PropCustomerController.deleteSite`
- `PropCustomerServiceImpl.createSite`
- `PropCustomerServiceImpl.update`
- `PropCustomerServiceImpl.deleteSite`
- `PropCustomerServiceImpl.requireSiteForUpdate`
- `CustomerEditor.vue` 的 `openAddSite`

验证：

正常流程：PASS

公司详情提供新建支店入口；支店归属上下文公司；编号共享序列；名称和资料路径保存。

异常流程：PASS

所属主体不存在、不是公司、名称为空、地址联系人校验失败均拒绝；删除公司被明确拒绝。

业务规则：PASS

所属公司不可变更、支店客户区分强制为空、显示继承公司值、支店删除级联地址联系人均有明确代码。

最终结果：

PASS

问题说明：

未发现与 REQ-010 冲突的实现。下游历史单据是否真不受支店删除影响属于 REQ-017 的跨模块验证项。

---

## REQ-011

需求：

公司或支店下可维护地址；邮编必填且严格 7 位数字，不接受符号、空格、全角数字；地址1必填，地址2选填；保存后展示为 `〒XXX-XXXX`；地址只能归属一个主体且归属不可更换；删除地址时联系人一并删除。

代码实现：

前端编辑工作区对邮编使用 `^[0-9]{7}$`，对地址1使用必填规则。后端 `validateSubject` 再次使用精确正则 `[0-9]{7}`，地址1裁剪后必填，地址2裁剪可空。地址表通过 `subject_id` 归属一个客户主体，更新 SQL 只允许按 `address_id + subject_id` 更新，不提供更换所属主体的字段。编辑时移除已有地址会先删除其联系人再删除地址。详情页将 7 位邮编格式化为 `〒XXX-XXXX`。

涉及文件：

- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/service/impl/PropCustomerServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/customer/PropCustomerMapper.xml`
- `prop_new/sql/c01_master_data_and_customer.sql`
- `ruoyi-ui/src/views/prop/customer/components/CustomerEditor.vue`
- `ruoyi-ui/src/views/prop/customer/detail.vue`

涉及方法：

- `PropCustomerServiceImpl.validateSubject`
- `PropCustomerServiceImpl.saveAddressDiff`
- `PropCustomerServiceImpl.insertAddress`
- `CustomerEditor.vue` 的 `removeAddress`、`submit`
- `detail.vue` 的 `postal`

验证：

正常流程：PASS

地址新增、编辑、排序保存和详情展示均有实现。

异常流程：PASS

邮编长度、字符类型、地址1为空在前后端均被拒绝；任一校验失败导致整体不提交。

业务规则：PASS

严格 7 位 ASCII 数字、展示格式、单一归属、归属不可更换、地址删除级联联系人均与需求一致。

最终结果：

PASS

问题说明：

未发现 REQ-011 范围内的代码缺口。

---

## REQ-012

需求：

地址下维护联系人；姓名必填，职称、电话、传真、邮箱、备注选填且按文本保存；邮箱不做格式校验；联系人只能属于一个地址，所属地址不可更换；联系人可删除。

代码实现：

联系人表通过 `address_id` 归属一个地址。后端要求联系人姓名裁剪后必填；职称、电话、传真、邮箱、备注只裁剪，不做格式或疑似重复校验。编辑时联系人 ID 必须属于当前地址，重复 ID 会被拒绝；未保留的联系人被物理删除。更新 SQL 以 `contact_id + address_id` 为条件，不提供更换地址的更新字段。

涉及文件：

- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/service/impl/PropCustomerServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/customer/PropCustomerMapper.xml`
- `prop_new/sql/c01_master_data_and_customer.sql`
- `ruoyi-ui/src/views/prop/customer/components/CustomerEditor.vue`

涉及方法：

- `PropCustomerServiceImpl.validateSubject`
- `PropCustomerServiceImpl.saveContactDiff`
- `PropCustomerServiceImpl.insertContact`
- `CustomerEditor.vue` 的 `addContact`、`submit`

验证：

正常流程：PASS

联系人可新增、编辑、删除并归属当前地址。

异常流程：PASS

联系人姓名为空时前后端均拒绝；联系人 ID 不属于当前地址时后端拒绝。

业务规则：PASS

邮箱等文本原样作为可选字段保存，不做邮箱格式校验；归属不可更换；无重复提示逻辑。

最终结果：

PASS

问题说明：

V5 用例中存在“非法邮箱保存失败”的预期，但该预期与 REQ-012 的“Spec 明确不做邮箱格式校验”冲突；代码按需求实现。

---

## REQ-013

需求：

客户列表支持编号/名称、地址、联系人搜索和客户区分筛选；统一部分匹配并忽略英文大小写；地址邮编允许带或不带 ASCII `-`；公司可展开支店，搜索命中自动展开，无搜索默认收起；公司按创建时间倒序，支店按创建时间正序；分页以公司为单位，每页 10 个公司；总条数为公司+支店合计；提供重置和详情入口。

代码实现：

后端 `subjectMatch` 对编号/名称、地址、联系人做部分匹配，使用 `LOWER` 处理英文大小写。地址搜索通过 `getPostalSearch` 移除 ASCII `-` 后匹配邮编，同时匹配地址1、地址2。`companyFilter` 要求公司自身或任一支店满足全部条件。公司 SQL 按 `create_time DESC, subject_id DESC`，支店 SQL 按 `create_time ASC, subject_id ASC`。前端固定 `pageSize=10`，有搜索自动展开、无搜索收起，重置清空条件。Controller 返回公司总数 `total` 和合计行数 `rowTotal`。

涉及文件：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropCustomerController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/service/impl/PropCustomerServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/customer/PropCustomerMapper.xml`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/domain/PropCustomerQuery.java`
- `ruoyi-ui/src/views/prop/customer/index.vue`

涉及方法：

- `PropCustomerController.list`
- `PropCustomerServiceImpl.selectPage`
- `PropCustomerServiceImpl.normalizeQuery`
- `PropCustomerQuery.getPostalSearch`
- `index.vue` 的 `load`、`search`、`resetSearch`、`goDetail`

验证：

正常流程：PASS

三类搜索、客户区分筛选、组合交集、层级展示、自动展开、固定排序、公司分页和合计行数均有明确实现。

异常流程：PASS

无结果由表格空状态呈现；非法客户区分由后端拒绝；新查询失败保留上一次成功列表并提供重试。

业务规则：PASS

匹配字段、连字符处理、大小写处理、排序、分页和编辑不改变创建时间均与需求一致。编号 SQL 不限制格式，因此兼容导入原编号存储在 `customer_no` 的查询。

最终结果：

PASS

问题说明：

“导入数据是否保留原始创建时间”在需求中标记待裁决，当前代码也没有导入流程；该项不构成 REQ-013 已实现查询行为的失败。

---

## REQ-014

需求：

详情页查看公司、支店、地址、联系人；提供公司编辑、新建支店、支店编辑/删除；公司卡展示编号、名称、默认客户区分、资料路径；支店卡统一标题；联系人六字段常显；空地址/空联系人有统一状态；点击订单、受付、通知关联业务跳转并按公司名搜索；删除支店弹窗说明级联范围和历史业务不受影响。

代码实现：

详情接口返回公司、支店及各级地址联系人。前端公司卡、支店卡、地址和联系人展示均已实现；联系人展示职称、电话、传真、邮箱、备注和时间尾项；无地址/联系人显示空状态。支店删除先查询地址数、联系人数，再弹出固定说明，确认后级联删除。关联业务中订单管理配置了 `/orders/index` 并按公司名传 `keyword`；受付履历和通知管理没有 `route`，页面显示“后续功能”，不可跳转。

涉及文件：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropCustomerController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/service/impl/PropCustomerServiceImpl.java`
- `ruoyi-ui/src/views/prop/customer/detail.vue`

涉及方法：

- `PropCustomerController.detail`
- `PropCustomerController.deleteImpact`
- `PropCustomerController.deleteSite`
- `PropCustomerServiceImpl.selectDetail`
- `detail.vue` 的 `related`、`openRelated`、`confirmDelete`、`SubjectCard`

验证：

正常流程：PARTIAL

公司/支店/地址/联系人详情和支店维护已实现；订单跳转已实现；受付和通知跳转未实现。

异常流程：PASS

支店删除影响查询、确认弹窗、取消和删除失败后的重新读取处理均有实现。

业务规则：PARTIAL

展示字段、支店标题、联系人字段、空状态和删除说明符合需求；但三个关联入口只有两个占位、一个可跳转，不满足“订单/受付/通知”均可跳转。

最终结果：

PARTIAL

问题说明：

`detail.vue` 的 `related` 数组中，受付履历和通知管理未配置 `route`，模板显示“后续功能”。这是明确代码缺失，不是运行环境问题。

---

## REQ-015

需求：

新建与编辑共用同一工作区；可连续维护多个地址和联系人；校验失败指出具体对象并整体不提交、保留草稿；编辑保存按最终内容一次生效，移除地址级联删除联系人，客户编号不变；新建成功后跳详情，编辑保存停留详情刷新；取消不写数据；系统自动记录修改信息；无启用/停用和更正履历。

代码实现：

`CustomerEditor.vue` 同时承担公司/支店新建和编辑，支持多个地址及联系人。前端先执行表单校验，失败不调用 API；服务端仍完整校验并返回带地址/联系人位置的错误。编辑 Service 在同一事务中更新主体并按提交内容对地址、联系人执行增删改，客户编号用当前数据库值覆盖提交值。取消或关闭只重置本地表单，不调用写接口。新建成功跳详情，编辑成功由详情页刷新。数据库和服务层没有客户状态字段或更正履历表。

涉及文件：

- `ruoyi-ui/src/views/prop/customer/components/CustomerEditor.vue`
- `ruoyi-ui/src/views/prop/customer/detail.vue`
- `ruoyi-ui/src/views/prop/customer/index.vue`
- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropCustomerController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/service/impl/PropCustomerServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/customer/PropCustomerMapper.xml`

涉及方法：

- `CustomerEditor.vue` 的 `openAddCompany`、`openAddSite`、`openEdit`、`removeAddress`、`close`、`submit`
- `PropCustomerController.update`
- `PropCustomerServiceImpl.update`
- `PropCustomerServiceImpl.saveAddressDiff`
- `PropCustomerServiceImpl.saveContactDiff`

验证：

正常流程：PASS

共用工作区、连续维护、整体提交、编辑差异保存、编号不变、保存后跳转或刷新均有实现。

异常流程：PASS

校验失败不发请求，服务端失败不触发成功事件；事务保证任一失败整体回滚；草稿保留。

业务规则：PASS

新建/编辑数据变化口径、地址联系人级联删除、取消不写数据、无状态字段、无更正履历均与需求一致。

最终结果：

PASS

问题说明：

代码没有并发编辑版本提示，但 REQ-015 未提出该要求；该项属于 V5 测试用例与需求基线之间的额外差异。

---

## REQ-016

需求：

为订单等业务提供统一客户主体选择；可按公司→支店层级选择，不选支店即选择公司；支持名称、编号搜索和选择前资料预览；无匹配显示空状态；选择动作不修改客户主档；不支持直接选择地址作为主体。

代码实现：

`CustomerSubjectSelector.vue` 使用 `/selector/tree` 返回公司及嵌套支店，关键词匹配编号和名称。选择节点后调用 `/selector/{subjectId}/preview`，预览主体类型、客户区分、编号、所属公司、地址和联系人。确认按钮只发出 `selected` 事件，不调用新增、编辑或删除接口。树只包含公司和支店，地址不是可选择节点。无匹配时显示“无匹配客户”。

涉及文件：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropCustomerController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/service/impl/PropCustomerServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/customer/PropCustomerMapper.xml`
- `ruoyi-ui/src/views/prop/customer/components/CustomerSubjectSelector.vue`
- `ruoyi-ui/src/api/prop/customer.js`

涉及方法：

- `PropCustomerController.selectorTree`
- `PropCustomerController.selectorPreview`
- `PropCustomerServiceImpl.selectTree`
- `PropCustomerServiceImpl.selectPreview`
- `CustomerSubjectSelector.vue` 的 `load`、`select`、`confirm`

验证：

正常流程：PASS

公司/支店层级、搜索、预览、公司或支店选择和空状态均有实现。

异常流程：PASS

无匹配有前端空状态；预览主体不存在或读取失败会清空选择并提示。

业务规则：PASS

选择动作不写主档；地址不作为主体节点；接口只读。

最终结果：

PASS

问题说明：

选择后调用页面如何保存当时客户信息属于 REQ-017，需由各业务模块单独验证。

---

## REQ-017

需求：

订单、通知、受付、出货、返送成立时各自保存当时客户信息；客户主档之后更正或删除不回写历史单据；历史业务继续显示成立时信息。

代码实现：

客户管理模块只提供主体选择树和预览只读接口，选择动作本身不写客户主档。客户编辑只修改客户主档表，支店删除只删除客户主档表。当前客户模块代码没有订单、通知、受付、出货、返送单据表写入逻辑，也没有跨模块快照表或快照字段证据。详情删除确认文案声称“历史业务不受影响”，但该文案本身不能证明下游模块已实现快照。

涉及文件：

- `ruoyi-ui/src/views/prop/customer/components/CustomerSubjectSelector.vue`
- `ruoyi-ui/src/views/prop/customer/detail.vue`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/service/impl/PropCustomerServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/customer/PropCustomerMapper.xml`

涉及方法：

- `PropCustomerServiceImpl.selectTree`
- `PropCustomerServiceImpl.selectPreview`
- `PropCustomerServiceImpl.update`
- `PropCustomerServiceImpl.deleteSite`
- `CustomerSubjectSelector.vue` 的 `confirm`

验证：

正常流程：UNKNOWN

客户模块证据不足以确认订单、通知、受付、出货、返送成立时是否保存客户快照。

异常流程：UNKNOWN

需求未明确异常流程，客户模块也没有跨模块单据写入证据。

业务规则：UNKNOWN

“主档更正或删除不回写历史单据”需要检查各下游单据表字段、保存逻辑和查询逻辑，当前输入不包含这些模块证据。

最终结果：

UNKNOWN

问题说明：

不能仅凭客户模块只读选择器或删除弹窗文案判定 PASS。需要补充订单、通知、受付、出货、返送模块的代码行为模型后再做最终判定。

---

## 问题汇总

### P0

- REQ-017：跨模块客户快照实现无法确认。影响历史订单、通知、受付、出货、返送的数据稳定性，必须补充下游模块代码证据。

### P1

- REQ-009：历史导入客户编号的导入实现无法确认；当前只有 `customer_no` 字段兼容任意唯一编号。
- REQ-014：受付履历和通知管理关联跳转未实现，页面仅显示“后续功能”。

### P2

- 实际角色授权和未登录访问表现需结合运行环境、路由守卫和角色数据确认；客户模块仅有接口权限表达式。

### P3

- 数据库部署是否已执行客户 DDL 和编号锁初始化需要上线前确认；代码库内脚本已提供，但环境执行状态未知。
