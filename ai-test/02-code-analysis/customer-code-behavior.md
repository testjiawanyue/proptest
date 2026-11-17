# Code Behavior Model

分析时间：2026-10-19（CST）。  
分析范围：当前工作区提交 `dbcfbaf` 下的客户管理模块前后端代码、MyBatis SQL 和数据库 DDL。  
分析方法：依据实际 Controller、Service、Mapper、XML、实体、SQL、Vue 页面和 API 封装判断；不根据需求、注释或方法名反推。

## 1. 系统业务模块

| 模块 | 当前代码实际能力 | 主要持久化对象 |
|---|---|---|
| 客户列表 | 按编号/名称、地址、联系人、客户区分组合查询；公司分页；公司下挂支店；返回公司总页数和“公司+支店”合计行数。 | `prop_customer_subject`、`prop_customer_address`、`prop_customer_contact` |
| 公司维护 | 新建公司，自动生成共享客户编号，维护默认客户区分、资料路径、地址和联系人；无公司删除入口。 | 客户主体、地址、联系人表 |
| 支店/现场维护 | 在公司下新建支店；支店显示时继承公司客户区分；支店可编辑、删除并级联删除地址联系人。 | 客户主体、地址、联系人表 |
| 客户编辑工作区 | 公司/支店、地址、联系人在同一弹窗整体提交；编辑按最终内容增删改。 | 三张客户主档表 |
| 客户详情 | 展示公司及全部支店的地址、联系人；提供编辑、新建支店、删除支店、订单跳转入口。 | 三张客户主档表 |
| 客户主体选择 | 提供公司/支店树、编号/名称搜索、资料预览；选择动作不写客户主档。 | 只读查询三张表 |
| 客户编号分配 | 公司和支店共用 `C + 五位数字` 序列；通过单行数据库锁串行分配。 | `prop_customer_number_lock`、`prop_customer_subject` |

当前代码明确不存在：客户启用/停用、客户更正履历、公司删除接口、地址/联系人转移接口、名称唯一性检查、下游业务引用删除拦截、乐观锁或“他人已修改”检测。

## 2. API清单

| ID | 方法 | 路径 | Controller 方法 | 权限表达式 | 主要结果 |
|---|---|---|---|---|---|
| API-001 | GET | `/prop/customer/list` | `PropCustomerController.list` | `prop:customer:page` | 公司分页、公司下支店、`total` 与 `rowTotal` |
| API-002 | GET | `/prop/customer/{subjectId}` | `PropCustomerController.detail` | `prop:customer:page` | 公司或支店详情；公司包含全部支店 |
| API-003 | GET | `/prop/customer/selector/{subjectId}/preview` | `PropCustomerController.selectorPreview` | `prop:customer:page` 或 `prop:order:page` | 主体选择预览资料 |
| API-004 | POST | `/prop/customer/company` | `PropCustomerController.createCompany` | `prop:customer:page` | 新公司 `subjectId` |
| API-005 | POST | `/prop/customer/company/{companyId}/site` | `PropCustomerController.createSite` | `prop:customer:page` | 新支店 `subjectId` |
| API-006 | PUT | `/prop/customer/{subjectId}` | `PropCustomerController.update` | `prop:customer:page` | 整体保存成功响应 |
| API-007 | GET | `/prop/customer/site/{siteId}/delete-impact` | `PropCustomerController.deleteImpact` | `prop:customer:page` | 待删除支店的地址数、联系人数 |
| API-008 | DELETE | `/prop/customer/site/{siteId}` | `PropCustomerController.deleteSite` | `prop:customer:page` | 支店级联删除成功响应 |
| API-009 | GET | `/prop/customer/selector/tree` | `PropCustomerController.selectorTree` | `prop:customer:page` 或 `prop:order:page` | 公司/支店选择树 |

Controller 当前未使用 `@Validated`；写接口参数校验主要由 Service 完成。

## 3. 业务功能

### 功能001：客户列表查询

#### 入口

- 页面：`ruoyi-ui/src/views/prop/customer/index.vue`
- API 封装：`ruoyi-ui/src/api/prop/customer.js` 的 `listCustomers`
- HTTP：`GET /prop/customer/list`
- Controller：`PropCustomerController.list`（`PropCustomerController.java:35`）

#### Controller

权限通过后启动 PageHelper 分页，调用 `service.selectPage(query)`，把 PageHelper 公司总数放入 `total`，把 Service 计算的公司+支店行数放入 `rowTotal`。

#### Service

`PropCustomerServiceImpl.selectPage`（`PropCustomerServiceImpl.java:27`）：

1. 裁剪关键词、地址、联系人；空值归一为无条件。
2. 校验客户区分只能为 `direct`、`agency` 或空。
3. 查询当前页公司。
4. 公司自身命中时加载全部支店；仅支店命中时加载命中支店。
5. 再次查询全部匹配公司 ID，计算 `rowTotal`。

#### 数据访问

`PropCustomerMapper.xml`：

- `subjectSummaryColumns`（`:39`）计算首个邮编、首个地址、地址数、联系人数。
- `subjectMatch`（`:47`）实现主体、地址、联系人条件。
- `companyFilter`（`:60`）在公司自身或任一支店命中时保留公司。
- `selectCompanyPage`（`:75`）按 `create_time DESC, subject_id DESC` 查询公司。
- `selectSitesForCompany`（`:84`）按 `create_time ASC, subject_id ASC` 查询支店。

#### 正常流程

1. 权限通过。
2. 条件裁剪后按交集过滤。
3. 公司按固定倒序分页，支店按固定正序挂接。
4. 前端固定每页 10 个公司，展示客户编号、客户、地址信息、联系资料、操作五列。
5. 搜索后自动展开有支店结果的公司；无搜索默认收起。
6. 页面显示 `共 rowTotal 条`。

#### 异常流程

- 非法客户区分：`ServiceException("客户区分不正确")`。
- 后端/数据库异常：进入 RuoYi 全局异常链。
- 前端查询失败：已有成功列表时保留旧列表并提示新查询未生效；否则显示读取失败和重试。

#### 条件分支

- 关键词非空：匹配公司/支店编号或名称，英文大小写不敏感。
- 地址非空：移除 ASCII `-` 后匹配邮编，同时匹配地址1、地址2。
- 联系人非空：匹配姓名、电话、传真、邮箱。
- 客户区分非空：只按公司默认客户区分过滤。
- 公司自身命中：返回全部支店；仅支店命中：只返回命中支店。

#### 参数校验

查询词无长度限制；客户区分有枚举校验；分页参数由 PageHelper 处理。

#### 权限校验

必须有 `prop:customer:page`。

#### 数据变化

无。

#### 第三方依赖

无客户模块直接第三方调用；仅使用认证上下文和数据库。

#### 错误处理

业务错误使用 `ServiceException`；前端用请求序号丢弃过期响应，失败时保留上一次成功数据。

#### 涉及代码文件

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropCustomerController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/service/impl/PropCustomerServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/customer/PropCustomerMapper.xml`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/customer/domain/PropCustomerQuery.java`
- `ruoyi-ui/src/views/prop/customer/index.vue`

#### 涉及方法

`list`、`selectPage`、`normalizeQuery`、`selectCompanyPage`、`selectSitesForCompany`、`index.vue load/search/resetSearch`

### 功能002：客户详情查询

#### 入口

列表“查看详情”或保存后跳转 `/customer/detail/{subjectId}`；支店列表行跳转所属公司详情。

#### Controller

`PropCustomerController.detail` 要求 `prop:customer:page`。

#### Service

`selectDetail`（`PropCustomerServiceImpl.java:46`）查询主体并加载地址联系人；主体为公司时再加载全部支店及其地址联系人。

#### 数据访问

`selectSubjectById` 联查公司名，支店显示时继承公司客户区分；地址按 `sort_order,address_id`，联系人按 `sort_order,contact_id`。

#### 正常流程

1. 权限通过且主体存在。
2. 公司详情返回公司、全部支店及各级地址联系人。
3. 支店详情返回支店自身、所属公司名和公司客户区分。
4. 前端展示公司/支店卡片、地址、联系人。
5. 邮编格式化为 `〒XXX-XXXX`；无地址或无联系人显示空状态。

#### 异常流程

- 主体不存在：抛出“客户主体不存在”。
- 前端路由 ID 非正整数：不调用后端，提示“客户地址无效，请返回客户列表”。
- 后端返回 ID 与页面 ID 不一致：前端视为资料不完整并进入重试状态。

#### 条件分支

公司加载支店集合；支店不加载同级支店。

#### 参数校验

后端依赖 Spring `Long` 转换和存在性检查；前端额外检查正整数。

#### 权限校验

必须有 `prop:customer:page`。

#### 数据变化

无。

#### 第三方依赖

无。

#### 错误处理

读取失败显示重试和返回列表；页面用 epoch 与请求序号避免旧响应覆盖新页面。

#### 涉及代码文件

`PropCustomerController.java`、`PropCustomerServiceImpl.java`、`PropCustomerMapper.xml`、`ruoyi-ui/src/views/prop/customer/detail.vue`

#### 涉及方法

`detail`、`selectDetail`、`loadAddresses`、`detail.vue load/SubjectCard/Addresses`

### 功能003：新建公司

#### 入口

客户列表“新建公司” → `CustomerEditor.openAddCompany()` → `POST /prop/customer/company`。

#### Controller

`createCompany` 要求 `prop:customer:page`，返回新主体 ID。

#### Service

`createCompany`（`PropCustomerServiceImpl.java:69`）强制 `subjectType=company`、`companyId=null`，校验后调用事务内 `insertAggregate`。

#### 数据访问

`insertAggregate`（`PropCustomerServiceImpl.java:146`）：

1. `prop_customer_number_lock lock_id=1 FOR UPDATE`。
2. 查询符合 `^C[0-9]+$` 的最大编号数字。
3. 生成 `C%05d`。
4. 插入主体，再插入地址和联系人。

#### 正常流程

权限、表单和服务端校验通过后，分配下一 C 编号，并在同一事务保存公司、地址、联系人；前端跳转新公司详情。

#### 异常流程

- 名称为空或全空白：抛出必填错误。
- 客户区分非法：抛出“默认客户区分不正确”。
- 编号锁缺失：抛出“客户编号互斥锁未初始化”。
- 邮编、地址1、联系人姓名不合法：抛出带地址/联系人位置的错误。
- 任一写入失败：整体回滚。

#### 条件分支

客户区分为空默认 `direct`；地址列表和联系人列表允许为空。

#### 参数校验

- 名称裁剪后必填；前端 `maxlength=200`，数据库 `VARCHAR(200)`。
- 资料路径裁剪，空值写 `null`。
- 邮编精确匹配 `[0-9]{7}`。
- 地址1裁剪后必填；地址2裁剪。
- 联系人姓名裁剪后必填；可选字段仅裁剪。
- 邮箱无格式校验。
- 无公司名称唯一性检查。

#### 权限校验

必须有 `prop:customer:page`。

#### 数据变化

新增主体、地址、联系人；写入创建人和创建时间。

#### 第三方依赖

无。

#### 错误处理

`@Transactional(rollbackFor = Exception.class)`，业务错误抛 `ServiceException`。

#### 涉及代码文件

`PropCustomerController.java`、`PropCustomerServiceImpl.java`、`PropCustomerMapper.xml`、`CustomerEditor.vue`

#### 涉及方法

`createCompany`、`validateSubject`、`insertAggregate`、`CustomerEditor openAddCompany/submit`

### 功能004：新建支店/现场

#### 入口

公司详情“新建支店／现场” → `CustomerEditor.openAddSite(parent)` → `POST /prop/customer/company/{companyId}/site`。

#### Controller

要求 `prop:customer:page`。

#### Service

`createSite`（`PropCustomerServiceImpl.java:80`）查询所属主体；不存在抛“客户主体不存在”，非公司抛“所属公司不存在”。随后强制 `subjectType=site`、`companyId=companyId`、`defaultCustomerType=null` 并插入聚合。

#### 数据访问

与公司新建共用编号锁、编号最大值、主体/地址/联系人插入 SQL。

#### 正常流程

有效公司下创建支店，分配同一 C 序列下一编号，同事务保存地址联系人，前端跳新支店详情。

#### 异常流程

公司 ID 不存在或指向支店、支店必填项或地址联系人校验失败、任一写入失败，均拒绝并回滚。

#### 条件分支

仅允许挂到有效公司；支店不保存独立客户区分，显示时从公司联查。

#### 参数校验

与公司新建一致，但支店工作区没有客户区分输入。

#### 权限校验

必须有 `prop:customer:page`。

#### 数据变化

新增支店主体并写 `company_id`；可选新增地址和联系人。

#### 第三方依赖

无。

#### 错误处理

事务整体回滚。

#### 涉及代码文件

`PropCustomerController.java`、`PropCustomerServiceImpl.java`、`detail.vue`、`CustomerEditor.vue`

#### 涉及方法

`createSite`、`detail.vue openEditor`、`CustomerEditor openAddSite/submit`

### 功能005：客户整体编辑

#### 入口

详情页公司或支店“编辑” → `CustomerEditor.openEdit()` 加载详情 → `PUT /prop/customer/{subjectId}`。

#### Controller

要求 `prop:customer:page`，以路径 ID 为准。

#### Service

`update`（`PropCustomerServiceImpl.java:94`）：

1. `FOR UPDATE` 锁定当前主体。
2. 主体类型或所属公司变化则拒绝。
3. 强制使用当前主体 ID、类型、所属公司和客户编号。
4. 支店强制客户区分为空。
5. 校验提交内容。
6. 更新主体后执行地址/联系人差异保存。

#### 数据访问

- `selectSubjectForUpdate` 锁定主体。
- `updateSubject` 只更新名称、客户区分、路径、修改人、修改时间。
- `saveAddressDiff` 按地址 ID 判断新增、更新、删除。
- `saveContactDiff` 按联系人 ID 判断新增、更新、删除。

#### 正常流程

1. 权限通过且主体存在。
2. 不可变字段校验通过。
3. 无 ID 项插入，有 ID 且归属正确的项更新。
4. 未保留联系人删除；未保留地址先级联删除联系人再删除地址。
5. 前端保存成功停留详情并刷新。

#### 异常流程

主体不存在、类型变化、所属公司变化、地址/联系人归属错误、重复提交同一 ID、更新或删除行数异常，均抛业务异常并回滚。

#### 条件分支

`addressId/contactId` 为空表示新增；存在且归属正确表示更新；数据库有但请求未保留表示删除。

#### 参数校验

与新建相同；客户编号由后端强制保持当前值，前端编号框只读。

#### 权限校验

必须有 `prop:customer:page`。

#### 数据变化

主体修改审计信息更新；地址联系人按最终提交内容增删改；创建信息和客户编号不变。

#### 第三方依赖

无。

#### 错误处理

事务整体回滚。没有乐观锁或版本比较；行锁只串行化保存，不能向第二个提交者提示“他人已修改”。

#### 涉及代码文件

`PropCustomerController.java`、`PropCustomerServiceImpl.java`、`PropCustomerMapper.xml`、`CustomerEditor.vue`、`detail.vue`

#### 涉及方法

`update`、`saveAddressDiff`、`saveContactDiff`、`CustomerEditor openEdit/payload/submit`

### 功能006：支店删除影响查询与删除

#### 入口

详情支店卡“删除” → `GET /prop/customer/site/{siteId}/delete-impact` → 确认后 `DELETE /prop/customer/site/{siteId}`。

#### Controller

两个接口均要求 `prop:customer:page`。

#### Service

`deleteImpact` 只允许支店并返回地址数、联系人数。`deleteSite`（`PropCustomerServiceImpl.java:122`）锁定主体、确认支店，先统计数量，再依次删除联系人、地址和支店主体。

#### 数据访问

`deleteContactsBySubjectId` 通过地址关联删除联系人；`deleteAddressesBySubjectId` 删除地址；`deleteSubject` 限定 `subject_type='site'`。

#### 正常流程

影响查询返回数量，前端确认弹窗说明级联范围及“历史业务不受影响”；确认后事务删除联系人、地址、支店，前端刷新详情。

#### 异常流程

- 主体不存在：客户主体不存在。
- 公司 ID：公司不可删除。
- 删除行数与预统计不一致：删除不完整并回滚。
- 删除请求失败：前端要求重新读取详情核对。

#### 条件分支

仅支店可删；地址或联系人为 0 时允许对应删除影响行数为 0。

#### 参数校验

路径 ID 类型由 Spring 转换，Service 做存在性和类型校验。

#### 权限校验

必须有 `prop:customer:page`。

#### 数据变化

物理删除支店、地址、联系人。

#### 第三方依赖

无。

#### 错误处理

事务整体回滚；不检查订单、通知、受付、出货、返送等业务引用。

#### 涉及代码文件

`PropCustomerController.java`、`PropCustomerServiceImpl.java`、`PropCustomerMapper.xml`、`detail.vue`

#### 涉及方法

`deleteImpact`、`deleteSite`、`requireSiteForUpdate`、`detail.vue confirmDelete`

### 功能007：客户主体选择树

#### 入口

`CustomerSubjectSelector.vue` → `GET /prop/customer/selector/tree`。

#### Controller

`selectorTree` 允许 `prop:customer:page` 或 `prop:order:page`。

#### Service

`selectTree`（`PropCustomerServiceImpl.java:135`）裁剪关键词，查询公司，再为每家公司查询匹配支店，返回嵌套树。

#### 数据访问

公司按创建时间倒序；支店按创建时间正序；关键词只匹配编号和名称，英文大小写不敏感。

#### 正常流程

无关键词返回全部公司/支店；有关键词时保留公司命中或支店命中的公司；有支店的公司前端默认展开。

#### 异常流程

无匹配时前端显示“无匹配客户”；后端异常进入全局异常链。

#### 条件分支

关键词为空查全部；公司自身或支店命中均保留父公司。

#### 参数校验

关键词只裁剪，无长度限制。

#### 权限校验

`prop:customer:page` 或 `prop:order:page` 任一。

#### 数据变化

无。

#### 第三方依赖

无。

#### 错误处理

加载中禁用树；加载失败由共享请求层提示。

#### 涉及代码文件

`PropCustomerController.java`、`PropCustomerServiceImpl.java`、`PropCustomerMapper.xml`、`CustomerSubjectSelector.vue`

#### 涉及方法

`selectorTree`、`selectTree`、`CustomerSubjectSelector load`

### 功能008：客户主体预览与选择

#### 入口

选择树节点 → `GET /prop/customer/selector/{subjectId}/preview`。

#### Controller

`selectorPreview` 允许客户管理或订单页面权限。

#### Service

`selectPreview` 查询主体并加载其地址联系人；公司预览不加载支店集合。

#### 数据访问

使用主体、地址、联系人只读查询。

#### 正常流程

选择公司或支店后请求预览，展示主体类型、客户区分、编号、所属公司、地址、联系人；点击“选择”只向调用方发出 `selected` 事件。

#### 异常流程

主体不存在提示重新选择；预览失败清空选中并显示错误；加载期间确认按钮禁用。

#### 条件分支

支店显示“公司名 / 支店名”；无地址联系人显示空状态。

#### 参数校验

后端依赖主体存在性；前端用异步序号避免旧预览覆盖新选择。

#### 权限校验

`prop:customer:page` 或 `prop:order:page` 任一。

#### 数据变化

无；选择动作不调用客户主档写接口。

#### 第三方依赖

无。

#### 错误处理

会话序号与预览序号防止重复打开或快速切换导致状态错乱。

#### 涉及代码文件

`PropCustomerController.java`、`PropCustomerServiceImpl.java`、`CustomerSubjectSelector.vue`

#### 涉及方法

`selectorPreview`、`selectPreview`、`CustomerSubjectSelector select/confirm`

### 功能009：客户编辑工作区前端行为

#### 入口

列表新建公司；详情新建支店、编辑公司、编辑支店；组件为 `CustomerEditor.vue`。

#### Controller

前端最终调用新建公司、新建支店或整体编辑 API。

#### Service

由功能003～005对应服务处理。

#### 数据访问

编辑打开时先调用详情接口；保存时提交最终表单快照。

#### 正常流程

可连续添加多个地址和联系人；前端校验通过才调用 API；成功后提示、关闭并触发父页面刷新或跳转。

#### 异常流程

表单校验失败不调用 API；API 保存失败不触发成功事件；保存中禁止关闭和重复提交。

#### 条件分支

移除草稿地址不确认；移除已有地址先确认；取消或关闭只重置本地草稿。

#### 参数校验

前端校验名称、邮编、地址1、联系人姓名；名称限制 200 字符；邮箱不做格式校验；后端仍完整校验。

#### 权限校验

按钮未做独立按钮权限，最终由后端接口权限控制。

#### 数据变化

只有保存 API 成功后数据库才变化。

#### 第三方依赖

无。

#### 错误处理

编辑请求序号避免旧详情响应覆盖新表单。

#### 涉及代码文件

`CustomerEditor.vue`、`index.vue`、`detail.vue`

#### 涉及方法

`reset`、`close`、`addAddress`、`addContact`、`removeAddress`、`openEdit`、`payload`、`submit`

## 4. 代码行为分支清单

| BR-ID | 行为分支 | 代码证据 |
|---|---|---|
| BR-001 | 客户列表接口要求 `prop:customer:page` | `PropCustomerController.list` |
| BR-002 | 查询关键词、地址、联系人先做首尾空白裁剪 | `normalizeQuery` |
| BR-003 | 客户区分仅允许 `direct`、`agency`，非空时过滤公司 | `normalizeQuery`、`companyFilter` |
| BR-004 | 非法客户区分抛出“客户区分不正确” | `normalizeQuery` |
| BR-005 | 编号/名称对公司或支店做大小写不敏感部分匹配 | `subjectMatch` |
| BR-006 | 地址搜索移除 ASCII `-` 匹配邮编，同时匹配地址1/地址2 | `PropCustomerQuery.getPostalSearch`、`subjectMatch` |
| BR-007 | 联系人搜索匹配姓名、电话、传真、邮箱 | `subjectMatch` |
| BR-008 | 公司自身或任一支店满足全部搜索条件时保留公司 | `companyFilter` |
| BR-009 | 公司自身命中返回全部支店；仅支店命中时过滤支店 | `selectPage`、`selectSitesForCompany` |
| BR-010 | 公司按创建时间倒序、同时间按主体 ID 倒序 | `selectCompanyPage` |
| BR-011 | 支店按创建时间正序、同时间按主体 ID 正序 | `selectSitesForCompany` |
| BR-012 | 后端按公司分页，前端固定每页 10 个公司 | `startCustomerPage`、`index.vue` |
| BR-013 | `total` 为公司数，`rowTotal` 为公司+支店展示行数 | Controller、`selectPage` |
| BR-014 | 有搜索条件自动展开有支店结果的公司；无搜索默认收起 | `index.vue load` |
| BR-015 | 重置清空全部条件并回到第 1 页 | `index.vue resetSearch` |
| BR-016 | 新查询失败时保留上一次成功列表并提供重试 | `index.vue load` |
| BR-017 | 支店点击详情时跳转所属公司详情 | `index.vue goDetail` |
| BR-018 | 列表汇总首个地址、地址数和联系人数 | `subjectSummaryColumns` |
| BR-019 | 详情接口要求 `prop:customer:page` | `PropCustomerController.detail` |
| BR-020 | 主体不存在抛出“客户主体不存在” | `requireSubject` |
| BR-021 | 公司详情加载全部支店及各级地址联系人 | `selectDetail` |
| BR-022 | 支店详情显示所属公司名并继承公司客户区分 | `selectSubjectById` |
| BR-023 | 前端非法详情 ID 不调用后端并提示无效地址 | `detail.vue load` |
| BR-024 | 详情邮编显示为 `〒XXX-XXXX`，空值显示占位或空状态 | `detail.vue postal` |
| BR-025 | 订单关联跳转存在；受付、通知当前显示“后续功能” | `detail.vue related` |
| BR-026 | 新建公司强制主体类型为公司、所属公司为空 | `createCompany` |
| BR-027 | 新建支店要求所属主体存在且必须为公司 | `createSite` |
| BR-028 | 公司与支店通过编号锁串行共用编号序列 | `insertAggregate` |
| BR-029 | 新编号取现有 `C[0-9]+` 最大数字 +1，格式 `C%05d` | `selectMaxSystemCustomerNumber` |
| BR-030 | 编号锁缺失时新建失败 | `insertAggregate` |
| BR-031 | 主体名称裁剪后必填 | `validateSubject` |
| BR-032 | 资料路径裁剪，空值保存为 `null` | `validateSubject` |
| BR-033 | 公司默认客户区分缺省为 `direct`，仅允许 `direct/agency` | `validateSubject` |
| BR-034 | 支店客户区分强制为空 | `createSite`、`update` |
| BR-035 | 地址列表允许为空 | `validateSubject` |
| BR-036 | 邮编必须是 7 位 ASCII 数字 | `validateSubject`、前端规则 |
| BR-037 | 地址1裁剪后必填，地址2裁剪可空 | `validateSubject` |
| BR-038 | 联系人列表允许为空，联系人姓名裁剪后必填 | `validateSubject` |
| BR-039 | 联系人可选字段仅裁剪，邮箱不做格式校验 | `validateSubject` |
| BR-040 | 新建主体、地址、联系人在一个事务中完成 | `createCompany/createSite`、`insertAggregate` |
| BR-041 | 没有公司名或支店名唯一性检查 | 新建与校验全路径 |
| BR-042 | 前端主体名称最多输入 200 字符，数据库同为 200 字符 | `CustomerEditor.vue`、DDL |
| BR-043 | 取消或关闭编辑弹窗只重置草稿，不调用写接口 | `CustomerEditor.vue close` |
| BR-044 | 编辑接口要求 `prop:customer:page` | `PropCustomerController.update` |
| BR-045 | 编辑前使用 `FOR UPDATE` 锁定当前主体 | `selectSubjectForUpdate` |
| BR-046 | 主体类型不可变更 | `update` |
| BR-047 | 支店所属公司不可变更 | `update` |
| BR-048 | 客户编号不可变更，提交值被当前值覆盖 | `update` |
| BR-049 | 编辑支店时客户区分强制为空 | `update` |
| BR-050 | 主体更新只写名称、客户区分、路径和修改审计信息 | `updateSubject` |
| BR-051 | 已提交地址 ID 必须属于当前主体且不可重复 | `saveAddressDiff` |
| BR-052 | 已存在地址按 ID 更新，保存新排序 | `saveAddressDiff`、`updateAddress` |
| BR-053 | 已提交联系人 ID 必须属于当前地址且不可重复 | `saveContactDiff` |
| BR-054 | 已存在联系人按 ID 更新，保存新排序 | `saveContactDiff`、`updateContact` |
| BR-055 | 无 ID 的地址、联系人作为新增项插入 | `saveAddressDiff`、`saveContactDiff` |
| BR-056 | 移除已有地址时先删除其联系人，再删除地址 | `saveAddressDiff` |
| BR-057 | 移除已有联系人时物理删除联系人 | `saveContactDiff` |
| BR-058 | 编辑整体在同一事务中，任一失败全部回滚 | `@Transactional` |
| BR-059 | 编辑无乐观锁或版本一致性检查，不能提示他人已修改 | `update` 全路径 |
| BR-060 | 编辑不写客户更正履历 | Service、Mapper、DDL 全路径 |
| BR-061 | 删除影响查询要求 `prop:customer:page` | `deleteImpact` Controller |
| BR-062 | 删除影响查询只允许支店，公司返回“公司不可删除” | `requireSite` |
| BR-063 | 删除影响返回地址数和联系人数 | `deleteImpact` |
| BR-064 | 支店删除接口要求 `prop:customer:page` | `deleteSite` Controller |
| BR-065 | 删除前锁定主体并再次确认主体类型为支店 | `requireSiteForUpdate` |
| BR-066 | 删除不检查订单、通知、受付、出货、返送引用 | `deleteSite` 全路径 |
| BR-067 | 删除按联系人、地址、支店顺序执行并核对影响行数 | `deleteSite` |
| BR-068 | 删除不写客户更正履历 | Service、Mapper、DDL 全路径 |
| BR-069 | 主体选择树允许客户管理或订单页面权限 | `selectorTree` Controller |
| BR-070 | 选择树关键词按公司/支店编号或名称匹配 | 选择器 SQL |
| BR-071 | 选择树公司倒序、支店正序 | 选择器 SQL |
| BR-072 | 选择树返回公司及嵌套支店，不写数据 | `selectTree` |
| BR-073 | 主体预览允许客户管理或订单页面权限 | `selectorPreview` Controller |
| BR-074 | 主体预览返回所选主体地址联系人，不写数据 | `selectPreview` |
| BR-075 | 前端确认选择只发出 `selected` 事件，不调用主档写接口 | `CustomerSubjectSelector.confirm` |
| BR-076 | 选择器处理无匹配、读取失败和异步响应过期 | `CustomerSubjectSelector.vue` |
| BR-077 | 列表无匹配时表格显示无数据，`rowTotal` 为 0 | `index.vue`、后端合计逻辑 |
| BR-078 | 移除已有地址先确认；移除草稿地址直接删除本地块 | `CustomerEditor.removeAddress` |
| BR-079 | 前端表单校验失败不调用写接口且保留草稿 | `CustomerEditor.submit` |

## 5. 无法确认的代码行为

| 编号 | 无法确认项 | 原因 |
|---|---|---|
| UNKNOWN-001 | 实际角色是否被授予客户或订单页面权限 | 代码只有权限表达式和菜单脚本，当前角色授权数据不在代码库内。 |
| UNKNOWN-002 | 历史导入客户编号如何导入、是否保留原始创建时间 | 当前模块只有 `customer_no`，没有导入程序或历史编号独立字段。 |
| UNKNOWN-003 | 订单、通知、受付、出货、返送是否保存客户快照 | 属于下游业务模块，客户管理代码无法证明。 |
| UNKNOWN-004 | 当前环境是否已执行客户模块 DDL 和编号锁初始化 | SQL 文件存在，但部署执行状态无法静态确认。 |
| UNKNOWN-005 | 真实浏览器中的菜单、登录跳转和前端权限展示 | 路由守卫、角色数据和运行环境未在本模块范围完整验证。 |
| UNKNOWN-006 | 下游业务是否容忍客户主档已被物理删除 | 客户代码不做引用检查，下游容错逻辑不在本模型范围。 |

## 6. 总体行为结论

客户管理模块已实现客户主档的新建、查询、详情、整体编辑、支店级联删除和主体选择。核心数据一致性行为包括共享编号锁、整体事务、归属校验和级联删除。明确缺失或与部分测试预期相反的行为包括：名称重复不拦截、被业务引用仍可删除、无更正履历、无并发编辑提示、受付和通知详情跳转未实现。
