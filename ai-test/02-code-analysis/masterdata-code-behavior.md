# Code Behavior Model

Analysis time: 2026-10-12 14:19:28 CST.  
Scope: PROP basic settings in the current working tree at commit `dbcfbaf`.  
Method: actual Java Controller, Service, Mapper, MyBatis XML, domain, SQL, and Vue API/page source review. Product specifications were not used to infer behavior.

## 1. 系统业务模块

| 模块 | 当前代码实际能力 | 主要持久化对象 |
|---|---|---|
| 部件资料 / Part Profile | 查询当前版本、按 ID 查询、新建并写入第 1 版、编辑追加新版本、启用/停用、按类型查询启用项。没有删除和历史版本切换接口。 | `prop_part_profile`, `prop_part_profile_version` |
| 基础数据 / Base Data | 按 `external_product_name` 或 `sensor_firmware_version` 查询全部/启用项、新增去重值、启用/停用。没有编辑值和删除接口。 | `prop_base_data` |
| 作业选项 / Work Option | 按类别/工作组查询全部/启用项、新增去重值、启用/停用。没有编辑值和删除接口。 | `prop_work_option` |

三个模块均使用 RuoYi `AjaxResult` 返回 `{code,msg,data}`。列表接口直接返回数组，没有分页结构。

本模型只覆盖基础设置三个子模块。客户管理也位于 `masterdata` 包，但属于客户业务模块，不在这里展开。

## 2. API清单

| ID | 方法 | 路径 | Controller 方法 | 权限表达式 | 主要结果 |
|---|---|---|---|---|---|
| API-001 | GET | `/prop/part-profile/list` | `PropPartProfileController.list` | `prop:partProfile:page` | 当前版本部件资料数组 |
| API-002 | GET | `/prop/part-profile/{profileId}` | `PropPartProfileController.getInfo` | `prop:partProfile:page` | 单条当前版本部件资料 |
| API-003 | POST | `/prop/part-profile` | `PropPartProfileController.add` | `prop:partProfile:page` | 新 `profileId` |
| API-004 | PUT | `/prop/part-profile` | `PropPartProfileController.edit` | `prop:partProfile:page` | 成功响应 |
| API-005 | PUT | `/prop/part-profile/{profileId}/status` | `PropPartProfileController.changeStatus` | `prop:partProfile:page` | 成功响应 |
| API-006 | GET | `/prop/part-profile/enabled/{partType}` | `PropPartProfileController.enabled` | 下列任一权限：`prop:partProfile:page`, `prop:intake:page`, `prop:assembly:page`, `prop:product:page`, `prop:part:page` | 指定类型的启用资料数组 |
| API-007 | GET | `/prop/base-data/list/{dataType}` | `PropBaseDataController.list` | `prop:baseData:page` | 指定类型全部值数组 |
| API-008 | POST | `/prop/base-data` | `PropBaseDataController.add` | `prop:baseData:page` | 新 `dataId` |
| API-009 | PUT | `/prop/base-data/{dataId}/status` | `PropBaseDataController.status` | `prop:baseData:page` | 成功响应 |
| API-010 | GET | `/prop/base-data/enabled/{dataType}` | `PropBaseDataController.enabled` | 下列任一权限：`prop:baseData:page`, `prop:assembly:page`, `prop:product:page` | 指定类型启用值数组 |
| API-011 | GET | `/prop/work-option/list?category=&workGroup=` | `PropWorkOptionController.list` | `prop:workOption:page` | 含停用项的作业选项数组 |
| API-012 | GET | `/prop/work-option/enabled?category=&workGroup=` | `PropWorkOptionController.enabled` | `prop:workOption:page` | 仅启用项的作业选项数组 |
| API-013 | POST | `/prop/work-option` | `PropWorkOptionController.add` | `prop:workOption:page` | 新 `optionId` |
| API-014 | PUT | `/prop/work-option/{id}/status` | `PropWorkOptionController.status` | `prop:workOption:page` | 成功响应 |

Controller 操作日志注解：

- Part Profile：新增、编辑、状态变更有 `@Log`。
- Base Data：新增、状态变更有 `@Log`。
- Work Option：当前 Controller 源码没有任何 `@Log` 注解。

## 3. 业务功能

### 功能001：查询全部部件资料当前版本

#### 入口

- 页面：`ruoyi-ui/src/views/prop/settings/part-profile/index.vue`
- API 封装：`ruoyi-ui/src/api/prop/partProfile.js` 的 `listPartProfiles()`
- HTTP：`GET /prop/part-profile/list`

#### Controller

`PropPartProfileController.list()` 在 `@PreAuthorize("@ss.hasPermi('prop:partProfile:page')")` 通过后调用 `partProfileService.selectPartProfileList()`，并用 `success(...)` 包装返回值。

#### Service

`PropPartProfileServiceImpl.selectPartProfileList()` 不做业务校验，直接委托 Mapper。

#### 数据访问

`PropPartProfileMapper.selectPartProfileList()` 执行 `PropPartProfileMapper.xml` 中的 `selectPartProfileList`：

- Join `prop_part_profile.current_version_id` 与 `prop_part_profile_version.version_id`。
- 返回 profile 状态和当前版本内容。
- 按 `field(p.part_type, 'jacket', 'airbag', 'sensor', 'inflator'), p.profile_id` 排序。

#### 正常流程

1. 权限通过。
2. 查询所有 profile 的当前版本。
3. Controller 返回 `AjaxResult.success(data)`。

#### 异常流程

- 数据库连接、SQL 或映射异常进入 RuoYi 全局异常处理。

#### 条件分支

- 服务层没有业务条件分支。
- 排序由数据库 `FIELD(...)` 决定；若数据库存在不在四个枚举内的 `part_type`，其排序位置由 SQL `FIELD` 语义决定。

#### 参数校验

无请求参数，Controller 和 Service 不做参数校验。

#### 权限校验

必须有 `prop:partProfile:page`。权限实现检查登录用户权限集合是否包含该字符串；若用户权限集合包含全量权限常量，也允许通过。

#### 数据变化

无。

#### 第三方依赖

模块代码无直接第三方调用。认证上下文和数据库由框架提供。

#### 错误处理

无本地 try/catch。运行时错误交给 `GlobalExceptionHandler`。

#### 涉及代码文件

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropPartProfileController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropPartProfileServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropPartProfileMapper.xml`

#### 涉及方法

- `PropPartProfileController.list`
- `PropPartProfileServiceImpl.selectPartProfileList`
- `PropPartProfileMapper.selectPartProfileList`

### 功能002：按 ID 查询部件资料当前版本

#### 入口

- 编辑弹窗：`ruoyi-ui/src/views/prop/settings/part-profile/PartProfileModal.vue`
- API 封装：`getPartProfile(profileId)`
- HTTP：`GET /prop/part-profile/{profileId}`

#### Controller

`PropPartProfileController.getInfo(@PathVariable Long profileId)` 要求 `prop:partProfile:page`。

#### Service

`PropPartProfileServiceImpl.selectPartProfileById(profileId)` 查询后判断结果是否为 `null`；为空抛出 `ServiceException("部件资料不存在")`。

#### 数据访问

`selectPartProfileById` 使用与列表相同的当前版本 Join，按 `p.profile_id = #{profileId}` 过滤。

#### 正常流程

1. 权限通过。
2. ID 类型转换成功。
3. 查到 profile 与当前版本。
4. 返回单条数据。

#### 异常流程

- ID 不是 `Long`：由 Spring 的参数类型异常链处理。
- ID 查不到：`ServiceException("部件资料不存在")`。
- 数据库异常：全局异常处理。

#### 条件分支

- `profile == null`：抛异常。
- 否则返回 profile。

#### 参数校验

- 服务层不检查 `profileId` 是否为空；SQL 对 `null` 不会命中记录，最终表现为“部件资料不存在”。
- Controller 使用 Spring 路径变量类型转换。

#### 权限校验

必须有 `prop:partProfile:page`。

#### 数据变化

无。

#### 第三方依赖

模块代码无直接第三方调用。

#### 错误处理

业务不存在时由 `GlobalExceptionHandler` 转为错误响应。

#### 涉及代码文件

与功能001相同。

#### 涉及方法

- `PropPartProfileController.getInfo`
- `PropPartProfileServiceImpl.selectPartProfileById`
- `PropPartProfileMapper.selectPartProfileById`

### 功能003：新建部件资料

#### 入口

- 页面：`PartProfileModal.vue` 的 `openAdd()` / `submit()`
- API 封装：`addPartProfile(data)`
- HTTP：`POST /prop/part-profile`

#### Controller

`PropPartProfileController.add(@Validated @RequestBody PropPartProfile profile)` 要求 `prop:partProfile:page`，带 `@Log(title="部件资料", businessType=INSERT)`。

#### Service

`PropPartProfileServiceImpl.createPartProfile(profile, username)` 使用 `@Transactional(rollbackFor = Exception.class)`：

1. 获取秒级截断的当前时间 `eventTime`。
2. 调用 `normalize(profile)`。
3. 设置 `status="0"`、`createBy=username`。
4. 插入 profile 主记录。
5. 用 `buildVersion(profile, 1, username)` 构造第 1 版。
6. 插入版本记录。
7. 调用 `updateCurrentVersion(...)`。
8. 更新影响行数不是 1 时抛出 `ServiceException("部件资料当前版本切换失败")`。
9. 返回数据库生成的 `profileId`。

#### 数据访问

- `insertPartProfile`：插入 `part_type`、`status`、`create_by`、`create_time`。
- `insertPartProfileVersion`：插入版本号、名称、规格、厂商、编号前缀、创建人、创建时间。
- `updateCurrentVersion`：把新 `version_id` 写入 profile 的 `current_version_id`，同时写更新人和更新时间。

#### 正常流程

1. Bean Validation 通过。
2. 服务归一化通过。
3. 创建 profile、version、current pointer。
4. 整个事务提交。
5. 返回新 ID。

#### 异常流程

- Bean Validation 失败：未进入 Service。
- `normalize(profile)` 内任何校验失败：事务回滚。
- 任一插入或更新失败：事务回滚或以异常结束。
- `updateCurrentVersion` 返回非 1：显式 `ServiceException`。
- 数据库唯一键或外键冲突：未在服务层捕获，进入全局异常处理。

#### 条件分支

- `partType` 必须精确匹配 `jacket|airbag|sensor|inflator`。
- `partName` 和 `specification` 在服务层再做空字符串检查并 `strip()`。
- `manufacturer`：`StringUtils.isBlank()` 为真时写 `null`；否则 `strip()` 后保存。
- `numberPrefix`：`StringUtils.isBlank()` 为真时写 `null`；否则不做空白裁剪；按 Unicode code point 数量检查不超过 32。
- 第 1 版 `versionNo` 固定为 1。

#### 参数校验

Bean Validation：

- `partType` 必填且限四类。
- `partName` 必填，最多 200 字符。
- `specification` 必填。
- `manufacturer` 可空，最多 200 字符。
- `numberPrefix` 没有 Bean Validation 注解。

服务校验：

- 名称/规格空白拒绝。
- 编号前缀按 code point 最大 32。

#### 权限校验

必须有 `prop:partProfile:page`。

#### 数据变化

成功时新增：

- 一条 `prop_part_profile`。
- 一条 `prop_part_profile_version`，`version_no=1`。
- 将 profile 当前版本指向新版本。

不更新其他业务表，不删除已有数据。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

无重复值检查，也没有内容唯一约束。数据库错误未被本地转换。

#### 涉及代码文件

- Controller、Service、Mapper XML 同前。
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/domain/PropPartProfile.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/domain/PropPartProfileVersion.java`

#### 涉及方法

- `PropPartProfileController.add`
- `PropPartProfileServiceImpl.createPartProfile`
- `PropPartProfileServiceImpl.normalize`
- `PropPartProfileServiceImpl.stripRequired`
- `PropPartProfileServiceImpl.normalizeOptionalPrefix`
- `PropPartProfileServiceImpl.buildVersion`
- Mapper 的 `insertPartProfile`, `insertPartProfileVersion`, `updateCurrentVersion`

### 功能004：编辑部件资料并追加版本

#### 入口

- 页面：`PartProfileModal.vue` 的 `openEdit(record)` / `submit()`
- API 封装：`updatePartProfile(data)`
- HTTP：`PUT /prop/part-profile`

#### Controller

`PropPartProfileController.edit(@Validated @RequestBody PropPartProfile profile)` 要求 `prop:partProfile:page`，带 `@Log(... UPDATE)`。

#### Service

`PropPartProfileServiceImpl.updatePartProfile(profile, username)` 使用事务：

1. `normalize(profile)`。
2. `selectPartProfileForUpdate(profile.getProfileId())` 锁定/读取当前记录。
3. 不存在抛出 `ServiceException("部件资料不存在")`。
4. 类型不同抛出 `ServiceException("部件类型建立后不可修改")`。
5. 用当前版本号加 1 构造新版本。
6. 插入新版本。
7. 更新当前版本指针；影响行数不是 1 时抛异常。

#### 数据访问

- `selectPartProfileForUpdate`：当前版本 Join 后执行 `FOR UPDATE`。
- `insertPartProfileVersion`：追加新版本。
- `updateCurrentVersion`：切换当前版本。

#### 正常流程

1. 权限和 Bean Validation 通过。
2. 归一化通过。
3. 锁定现有 profile。
4. 类型一致。
5. 追加下一版本并切换指针。
6. 事务提交。

#### 异常流程

- profile 不存在。
- 部件类型试图修改。
- 插入或切换失败。
- 数据库唯一键 `(profile_id, version_no)` 冲突时，服务层不特殊处理。

#### 条件分支

- 当前记录存在与否。
- 当前 `partType` 与请求 `partType` 是否一致。
- 当前 `versionNo + 1` 作为新版本号。
- 服务层不比较新旧内容；即使内容完全不变也会追加新版本。
- 服务层不检查当前 profile 是否停用；停用资料仍可编辑。

#### 参数校验

与新建相同的 Bean Validation 和服务归一化规则。`profileId` 没有 Bean Validation 必填注解；为空时查询不到记录。

#### 权限校验

必须有 `prop:partProfile:page`。

#### 数据变化

成功时：

- 新增一条版本记录。
- 更新 profile 的 `current_version_id`、`update_by`、`update_time`。
- 不修改 profile 的 `status`。
- 不修改任何历史版本记录。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

主要错误为 `ServiceException`；数据库异常不转换。

#### 涉及代码文件

与功能003相同。

#### 涉及方法

- `PropPartProfileController.edit`
- `PropPartProfileServiceImpl.updatePartProfile`
- `PropPartProfileServiceImpl.normalize`
- `PropPartProfileServiceImpl.buildVersion`
- Mapper 的 `selectPartProfileForUpdate`, `insertPartProfileVersion`, `updateCurrentVersion`

### 功能005：切换部件资料状态

#### 入口

- 列表页操作列。
- API 封装：`changePartProfileStatus(profileId, status)`
- HTTP：`PUT /prop/part-profile/{profileId}/status?status=0|1`

#### Controller

`PropPartProfileController.changeStatus(@PathVariable Long profileId, @RequestParam String status)` 要求 `prop:partProfile:page`，带 `@Log(... UPDATE)`。

#### Service

`PropPartProfileServiceImpl.changeStatus(profileId, status, username)` 使用事务：

1. 校验 `status` 只能是 `"0"` 或 `"1"`。
2. 执行状态更新。
3. 更新影响行数为 0 时抛出 `ServiceException("部件资料不存在")`。

#### 数据访问

`updateStatus` 直接按 `profile_id` 更新 `status`、`update_by`、`update_time`。

#### 正常流程

1. 状态合法。
2. ID 命中记录。
3. 状态和审计字段被更新。

#### 异常流程

- 状态非法。
- ID 不存在。
- 数据库异常。

#### 条件分支

- 状态值是否为 `0` 或 `1`。
- 更新影响行数是否为 1。
- 不判断前后状态是否变化；重复设置相同状态也会更新审计字段。

#### 参数校验

服务层显式校验状态字符串。`profileId` 依赖 Spring 路径变量转换。

#### 权限校验

必须有 `prop:partProfile:page`。

#### 数据变化

更新 `prop_part_profile.status`、`update_by`、`update_time`。不新增版本，不修改版本内容。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

非法状态或 ID 不存在抛 `ServiceException`。

#### 涉及代码文件

与功能001相同。

#### 涉及方法

- `PropPartProfileController.changeStatus`
- `PropPartProfileServiceImpl.changeStatus`
- `PropPartProfileMapper.updateStatus`

### 功能006：按类型查询启用部件资料

#### 入口

- 消费页面通过 `listEnabledPartProfiles(partType)` 调用。
- HTTP：`GET /prop/part-profile/enabled/{partType}`

#### Controller

`PropPartProfileController.enabled(@PathVariable String partType)` 使用 `@ss.hasAnyPermi(...)`，允许五个页面权限之一。

#### Service

`selectEnabledPartProfiles(partType)` 校验类型后查询。

#### 数据访问

SQL 在当前版本 Join 基础上追加：

- `p.status = '0'`
- `p.part_type = #{partType}`

按 `v.part_name, p.profile_id` 排序。

#### 正常流程

1. 权限通过。
2. 类型合法。
3. 返回该类型启用资料的当前版本。

#### 异常流程

- 类型非法：`ServiceException("部件类型不正确")`。
- 数据库异常：全局处理。

#### 条件分支

- 类型是否属于四类。
- SQL 只返回启用记录。

#### 参数校验

服务层正则校验 `jacket|airbag|sensor|inflator`。

#### 权限校验

五个列出的权限满足任一即可。

#### 数据变化

无。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

业务异常交给全局处理器。

#### 涉及代码文件

与功能001相同。

#### 涉及方法

- `PropPartProfileController.enabled`
- `PropPartProfileServiceImpl.selectEnabledPartProfiles`
- `PropPartProfileServiceImpl.validatePartType`
- `PropPartProfileMapper.selectEnabledPartProfiles`

### 功能007：查询指定类型基础数据

#### 入口

- 页面：`ruoyi-ui/src/views/prop/settings/base-data/index.vue`
- API 封装：`listBaseData(type)`
- HTTP：`GET /prop/base-data/list/{dataType}`

#### Controller

`PropBaseDataController.list(@PathVariable String dataType)` 要求 `prop:baseData:page`。

#### Service

`PropBaseDataServiceImpl.selectByType(dataType)` 校验 `dataType` 后委托 Mapper。

#### 数据访问

`selectByType` 查询 `prop_base_data`，按 `data_id` 升序返回全部状态。

#### 正常流程

返回指定类型全部启用和停用值。

#### 异常流程

- 类型非法：`ServiceException("基础数据类型不正确")`。
- 数据库异常：全局处理。

#### 条件分支

类型必须是：

- `external_product_name`
- `sensor_firmware_version`

#### 参数校验

服务层正则校验路径类型。本接口没有请求体。

#### 权限校验

必须有 `prop:baseData:page`。

#### 数据变化

无。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

服务异常交给全局处理器。

#### 涉及代码文件

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropBaseDataController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropBaseDataServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropBaseDataMapper.xml`

#### 涉及方法

- `PropBaseDataController.list`
- `PropBaseDataServiceImpl.selectByType`
- `PropBaseDataServiceImpl.validateType`
- `PropBaseDataMapper.selectByType`

### 功能008：新增基础数据

#### 入口

- 页面新增输入框。
- API 封装：`addBaseData(data)`
- HTTP：`POST /prop/base-data`

#### Controller

`PropBaseDataController.add(@Validated @RequestBody PropBaseData data)` 要求 `prop:baseData:page`，带 `@Log(... INSERT)`。

#### Service

`PropBaseDataServiceImpl.create(baseData, username)` 使用事务：

1. 校验 `dataType`。
2. 调用 `OptionValueNormalizer.normalize(displayValue)`。
3. 按 `(data_type, normalized_hash)` 查询现有记录。
4. 存在则抛重复异常。
5. 设置裁剪后的 `displayValue`、`normalizedHash`、`status="0"`、`createBy=username`。
6. 插入记录。
7. 若唯一键冲突且约束名匹配，则 `SELECT ... FOR UPDATE` 重新查询并发记录；找到则抛对应重复消息，找不到则重新抛出原数据库异常。
8. 返回生成 ID。

#### 数据访问

- `selectByScopeHash`：普通查询。
- `insertBaseData`：插入并返回生成主键。
- `selectByScopeHashForUpdate`：唯一冲突后的当前读。

#### 正常流程

1. 权限和 Bean Validation 通过。
2. 值非空白。
3. 同类型下无归一化冲突。
4. 插入成功。
5. 返回新 ID。

#### 异常流程

- 值空白。
- 类型非法。
- 同类型已有相同归一化键。
- 并发插入触发唯一键冲突。
- 数据库异常。

#### 条件分支

`OptionValueNormalizer.normalize`：

- `null` 或 `strip()` 后为空：拒绝。
- `displayValue = input.strip()`。
- 归一化键只把 ASCII `A-Z` 折叠为 `a-z`。
- 不折叠 Unicode 大小写，不转换全角/半角，不压缩内部空白。
- 使用 UTF-8 SHA-256 生成 32 字节哈希。

重复消息：

- 现有状态 `"0"`：`该值已存在`。
- 现有状态 `"1"`：`该值已存在且已停用，请使用现有启用操作`。

不会自动启用已停用重复项，也不会复用旧记录。

#### 参数校验

Bean Validation：

- `dataType` 必填且必须匹配两个允许值。
- `displayValue` 必填且最多 200 字符。

服务层再次校验类型和空白。

#### 权限校验

必须有 `prop:baseData:page`。

#### 数据变化

成功时新增一条启用状态的基础数据。不更新已有记录。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

只捕获匹配 `uk_base_data_scope_hash` 的 `DuplicateKeyException`；其他键冲突直接重新抛出。

#### 涉及代码文件

- 基础数据 Controller/Service/Mapper XML。
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/support/OptionValueNormalizer.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/support/DuplicateKeySupport.java`

#### 涉及方法

- `PropBaseDataController.add`
- `PropBaseDataServiceImpl.create`
- `PropBaseDataServiceImpl.duplicate`
- `OptionValueNormalizer.normalize`
- `DuplicateKeySupport.isConstraint`
- Mapper 的 `selectByScopeHash`, `insertBaseData`, `selectByScopeHashForUpdate`

### 功能009：切换基础数据状态

#### 入口

- 基础数据页面操作列。
- API 封装：`changeBaseDataStatus(id, status)`
- HTTP：`PUT /prop/base-data/{dataId}/status?status=0|1`

#### Controller

`PropBaseDataController.status(...)` 要求 `prop:baseData:page`，带 `@Log(... UPDATE)`。

#### Service

`PropBaseDataServiceImpl.changeStatus(dataId, status, username)`：

1. 校验状态只能是 `"0"` 或 `"1"`。
2. 更新状态。
3. 更新影响行数为 0 时抛 `ServiceException("基础数据不存在")`。

#### 数据访问

`updateStatus` 按 `data_id` 更新 `status`、`update_by`、`update_time`。

#### 正常流程

状态合法且 ID 存在时更新成功。

#### 异常流程

状态非法、ID 不存在或数据库异常。

#### 条件分支

- 状态值合法性。
- 更新影响行数。
- 不阻止重复设置当前状态。

#### 参数校验

服务层校验状态；路径 ID 依赖 Spring 类型转换。

#### 权限校验

必须有 `prop:baseData:page`。

#### 数据变化

更新状态和审计字段，不修改显示值或哈希。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

业务异常交给全局处理器。

#### 涉及方法

- `PropBaseDataController.status`
- `PropBaseDataServiceImpl.changeStatus`
- `PropBaseDataMapper.updateStatus`

### 功能010：查询指定类型启用基础数据

#### 入口

- 消费页面通过 `listEnabledBaseData(type)` 调用。
- HTTP：`GET /prop/base-data/enabled/{dataType}`

#### Controller

`PropBaseDataController.enabled(...)` 使用 `@ss.hasAnyPermi(...)`，允许基础数据、装配、产品三个页面权限之一。

#### Service

`selectEnabledByType(dataType)` 校验类型后委托 Mapper。

#### 数据访问

SQL 限定 `status='0'` 和指定 `data_type`，按 `data_id` 排序。

#### 正常流程

返回指定类型启用值。

#### 异常流程

类型非法或数据库异常。

#### 条件分支

- 类型必须为两个允许值之一。
- SQL 只返回启用状态。

#### 参数校验

服务层校验类型。

#### 权限校验

三个列出的权限满足任一即可。

#### 数据变化

无。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

全局异常处理。

#### 涉及方法

- `PropBaseDataController.enabled`
- `PropBaseDataServiceImpl.selectEnabledByType`
- `PropBaseDataMapper.selectEnabledByType`

### 功能011：查询作业选项（含停用项）

#### 入口

- 页面：`ruoyi-ui/src/views/prop/settings/work-option/index.vue`
- API 封装：`listWorkOptions(params)`
- HTTP：`GET /prop/work-option/list`

#### Controller

`PropWorkOptionController.list(@RequestParam String category, @RequestParam(required=false) String workGroup)` 要求 `prop:workOption:page`。

#### Service

`PropWorkOptionServiceImpl.select(category, workGroup, false)` 先通过 `scope(...)` 解析真实工作组，再查询。

`scope(...)` 的实际行为：

- `category == "reception_ng"`：忽略传入的 `workGroup`，返回 `"global"`。
- `category == "disposition"` 或 `"work_ng"`：`workGroup` 必须精确匹配 `sewing|sensor|assembly`。
- 其他 `category`：拒绝。

#### 数据访问

`selectByScope` 按类别、真实工作组和 `enabledOnly=false` 查询，按 `option_id` 排序。

#### 正常流程

返回该范围下全部状态记录。

#### 异常流程

- 类别非法。
- 分组类别缺少工作组或工作组非法。
- 数据库异常。

#### 条件分支

- 受付 NG 使用固定 `global`。
- 处置与作业 NG 使用 sewing/sensor/assembly。
- 其他类别拒绝。

#### 参数校验

Bean Validation 只要求 `category` 非空，`workGroup` 允许缺失；精确范围由服务层校验。

#### 权限校验

必须有 `prop:workOption:page`。

#### 数据变化

无。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

业务异常交给全局处理器。

#### 涉及代码文件

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropWorkOptionController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropWorkOptionServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropWorkOptionMapper.xml`

#### 涉及方法

- `PropWorkOptionController.list`
- `PropWorkOptionServiceImpl.select`
- `PropWorkOptionServiceImpl.scope`
- `PropWorkOptionMapper.selectByScope`

### 功能012：查询启用作业选项

#### 入口

- 消费页面通过 `listEnabledWorkOptions(params)` 调用。
- HTTP：`GET /prop/work-option/enabled`

#### Controller

`PropWorkOptionController.enabled(...)` 要求 `prop:workOption:page`。

#### Service

与功能011相同，但 `enabledOnly=true`。

#### 数据访问

`selectByScope` 在相同范围条件下追加 `status='0'`。

#### 正常流程

返回启用作业选项。

#### 异常流程

与功能011相同。

#### 条件分支

- 范围解析规则与功能011相同。
- SQL 额外过滤启用状态。

#### 参数校验

与功能011相同。

#### 权限校验

必须有 `prop:workOption:page`。

#### 数据变化

无。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

全局异常处理。

#### 涉及方法

- `PropWorkOptionController.enabled`
- `PropWorkOptionServiceImpl.select`
- `PropWorkOptionServiceImpl.scope`
- `PropWorkOptionMapper.selectByScope`

### 功能013：新增作业选项

#### 入口

- 作业选项页面新增输入框。
- API 封装：`addWorkOption(data)`
- HTTP：`POST /prop/work-option`

#### Controller

`PropWorkOptionController.add(@Validated @RequestBody PropWorkOption option)` 要求 `prop:workOption:page`。当前源码没有 `@Log`。

#### Service

`PropWorkOptionServiceImpl.create(option, username)` 使用事务：

1. 解析类别/工作组范围。
2. 归一化显示值。
3. 按 `(option_category, work_group, normalized_hash)` 查询现有记录。
4. 存在则抛重复异常。
5. 设置真实工作组、裁剪后的显示值、哈希、`source="admin"`、`status="0"`、`createBy=username`。
6. 插入。
7. 唯一键冲突后按约束名重新查询并发记录；找到则抛对应重复消息，找不到则重新抛出原异常。
8. 返回生成 ID。

#### 数据访问

- `selectByScopeHash`
- `insertOption`
- `selectByScopeHashForUpdate`

#### 正常流程

同范围内无重复值时新增一条启用记录。

#### 异常流程

- 范围非法。
- 值空白。
- 重复值。
- 并发唯一键冲突。
- 数据库异常。

#### 条件分支

重复消息：

- 现有状态 `"0"`：`该值已存在`。
- 现有状态 `"1"`：`该值已存在且已停用，请使用现有启用操作`。

归一化规则与基础数据相同：只做首尾裁剪和 ASCII 大写折叠。

#### 参数校验

Bean Validation：

- `optionCategory` 必填。
- `displayValue` 必填且最多 200 字符。

服务层：

- 精确校验类别和工作组。
- 值空白拒绝。

#### 权限校验

必须有 `prop:workOption:page`。

#### 数据变化

新增一条启用状态的作业选项，来源固定为 `"admin"`。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

只处理 `uk_work_option_scope_hash` 冲突；其他数据库异常直接抛出。

#### 涉及方法

- `PropWorkOptionController.add`
- `PropWorkOptionServiceImpl.create`
- `PropWorkOptionServiceImpl.scope`
- `PropWorkOptionServiceImpl.duplicate`
- `OptionValueNormalizer.normalize`
- `DuplicateKeySupport.isConstraint`
- Mapper 的 `selectByScopeHash`, `insertOption`, `selectByScopeHashForUpdate`

### 功能014：切换作业选项状态

#### 入口

- 作业选项页面操作列。
- API 封装：`changeWorkOptionStatus(id, status)`
- HTTP：`PUT /prop/work-option/{id}/status?status=0|1`

#### Controller

`PropWorkOptionController.status(...)` 要求 `prop:workOption:page`。当前源码没有 `@Log`。

#### Service

`PropWorkOptionServiceImpl.changeStatus(optionId, status, username)`：

1. 校验状态只能是 `"0"` 或 `"1"`。
2. 更新状态。
3. 更新影响行数为 0 时抛 `ServiceException("作业选项不存在")`。

#### 数据访问

`updateStatus` 按 `option_id` 更新 `status`、`update_by`、`update_time`。

#### 正常流程

状态合法且 ID 存在时更新成功。

#### 异常流程

状态非法、ID 不存在或数据库异常。

#### 条件分支

- 状态值合法性。
- 更新影响行数。
- 不阻止重复设置当前状态。

#### 参数校验

服务层校验状态字符串。

#### 权限校验

必须有 `prop:workOption:page`。

#### 数据变化

更新状态和审计字段。

#### 第三方依赖

无模块级第三方调用。

#### 错误处理

业务异常交给全局处理器。

#### 涉及方法

- `PropWorkOptionController.status`
- `PropWorkOptionServiceImpl.changeStatus`
- `PropWorkOptionMapper.updateStatus`

## 4. 代码行为分支清单

| 分支ID | 模块 | 条件/行为 | 代码证据 |
|---|---|---|---|
| BR-001 | Part Profile | 查询列表无业务条件，直接返回所有当前版本。 | `selectPartProfileList` |
| BR-002 | Part Profile | 按 ID 能查到当前版本时返回记录。 | `selectPartProfileById` |
| BR-003 | Part Profile | 按 ID 查不到时抛“部件资料不存在”。 | `selectPartProfileById` |
| BR-004 | Part Profile | 新建时 `partType` 必须是四类之一。 | `validatePartType` |
| BR-005 | Part Profile | 名称或规格裁剪后为空时拒绝。 | `stripRequired` |
| BR-006 | Part Profile | 厂商空白写 `null`，非空白写 `strip()` 结果。 | `normalize` |
| BR-007 | Part Profile | 编号前缀空白写 `null`，非空白不裁剪。 | `normalizeOptionalPrefix` |
| BR-008 | Part Profile | 编号前缀超过 32 个 code point 拒绝。 | `normalizeOptionalPrefix` |
| BR-009 | Part Profile | 新建固定创建 `version_no=1` 并切换当前版本。 | `createPartProfile` |
| BR-010 | Part Profile | 当前版本切换影响行数非 1 时失败。 | `createPartProfile` / `updatePartProfile` |
| BR-011 | Part Profile | 编辑前对 profile 行执行 `FOR UPDATE`。 | `selectPartProfileForUpdate` |
| BR-012 | Part Profile | 编辑时类型不可改变。 | `updatePartProfile` |
| BR-013 | Part Profile | 编辑内容即使与当前版本相同也追加新版本。 | `updatePartProfile` |
| BR-014 | Part Profile | 停用资料仍可编辑。 | `updatePartProfile` 不检查 `status` |
| BR-015 | Part Profile | 状态只允许 0/1。 | `changeStatus` |
| BR-016 | Part Profile | 状态更新影响行数 0 视为不存在。 | `changeStatus` |
| BR-017 | Part Profile | 重复设置相同状态仍执行更新。 | `updateStatus` SQL |
| BR-018 | Part Profile | 启用查询只返回 `status=0` 且指定类型。 | `selectEnabledPartProfiles` |
| BR-019 | Part Profile | 启用查询允许维护页或四个消费页权限之一。 | `PropPartProfileController.enabled` |
| BR-020 | Base Data | 类型只允许 `external_product_name` 或 `sensor_firmware_version`。 | `validateType` |
| BR-021 | Base Data | 全量查询包含启用和停用。 | `selectByType` |
| BR-022 | Base Data | 值 `null` 或裁剪后空白拒绝。 | `OptionValueNormalizer.normalize` |
| BR-023 | Base Data | 显示值保存 `strip()` 结果。 | `OptionValueNormalizer.normalize` |
| BR-024 | Base Data | 归一化只折叠 ASCII A-Z；Unicode 大小写和全角/半角不折叠。 | `OptionValueNormalizer.normalize` |
| BR-025 | Base Data | 同类型同归一化哈希视为重复。 | `selectByScopeHash` |
| BR-026 | Base Data | 启用重复提示“该值已存在”。 | `duplicate` |
| BR-027 | Base Data | 停用重复提示引导启用现有记录。 | `duplicate` |
| BR-028 | Base Data | 重复不自动启用旧记录，也不新增。 | `create` 提前抛异常 |
| BR-029 | Base Data | 预查无冲突但插入命中目标唯一键时，锁读重新查询。 | `create` + `selectByScopeHashForUpdate` |
| BR-030 | Base Data | 非目标唯一键冲突不转换业务消息。 | `DuplicateKeySupport.isConstraint` |
| BR-031 | Base Data | 状态只允许 0/1。 | `changeStatus` |
| BR-032 | Base Data | 状态更新影响行数 0 视为不存在。 | `changeStatus` |
| BR-033 | Base Data | 启用查询只返回 `status=0` 且指定类型。 | `selectEnabledByType` |
| BR-034 | Base Data | 启用查询允许维护页或两个消费页权限之一。 | `PropBaseDataController.enabled` |
| BR-035 | Work Option | `reception_ng` 固定映射为 `global`。 | `scope` |
| BR-036 | Work Option | `reception_ng` 忽略请求中的 `workGroup`。 | `scope` |
| BR-037 | Work Option | `disposition` / `work_ng` 必须使用 sewing/sensor/assembly。 | `scope` |
| BR-038 | Work Option | 其他类别拒绝。 | `scope` |
| BR-039 | Work Option | 全量查询包含停用项，启用查询排除停用项。 | `selectByScope` |
| BR-040 | Work Option | 值空白拒绝，显示值裁剪保存。 | `OptionValueNormalizer.normalize` |
| BR-041 | Work Option | 同类别同工作组同归一化哈希重复。 | `selectByScopeHash` |
| BR-042 | Work Option | 不同工作组可以存在相同显示值。 | 唯一键和 `scope` |
| BR-043 | Work Option | 新增来源固定为 `admin`。 | `create` |
| BR-044 | Work Option | 目标唯一键冲突后锁读并发记录并返回重复消息。 | `create` |
| BR-045 | Work Option | 状态只允许 0/1。 | `changeStatus` |
| BR-046 | Work Option | 状态更新影响行数 0 视为不存在。 | `changeStatus` |
| BR-047 | 全局 | 权限失败由全局处理器返回权限错误响应。 | `GlobalExceptionHandler.handleAccessDeniedException` |
| BR-048 | 全局 | Bean Validation 失败返回第一个错误默认消息。 | `GlobalExceptionHandler.handleMethodArgumentNotValidException` |
| BR-049 | 全局 | `ServiceException` 转为 RuoYi 错误响应。 | `GlobalExceptionHandler.handleServiceException` |
| BR-050 | 全局 | 未声明权限或权限集合为空时方法安全判断失败。 | `PermissionService.hasPermi` |

## 5. 无法确认的代码行为

| ID | 无法确认点 | 原因 |
|---|---|---|
| UNKNOWN-001 | 指定部署环境是否已执行“编号前缀可空”迁移。 | 初始 SQL 定义 `number_prefix NOT NULL`，后续迁移允许 `NULL`；Java 代码会写 `null`，但运行库实际结构必须单独查询。 |
| UNKNOWN-002 | 运行环境实际授予了哪些角色哪些基础设置权限。 | SQL 只能看到菜单/权限种子和注释，不能证明当前角色授权状态。 |
| UNKNOWN-003 | 数据库实际隔离级别下并发插入、锁等待和死锁的完整运行结果。 | 代码和表结构能证明语句与锁意图，但不能替代真实 MySQL 并发验证。 |
| UNKNOWN-004 | 应用服务器、JDBC 会话与 MySQL 会话的最终时区表现。 | 服务层使用 Java `Instant.now()` 截断秒级时间；实际持久化表现还取决于运行配置和数据库会话。 |
| UNKNOWN-005 | 操作日志在异常或并发场景下的完整落库结果。 | `@Log` 和 `LogAspect` 属于框架链路；本次只确认基础设置 Controller 的注解存在与否，没有展开完整日志事务行为。 |
| UNKNOWN-006 | 数据库中是否存在违反当前 Java 枚举假设的历史数据。 | Java 校验不约束数据库已有行；XML 除部分类型校验外不强制枚举。 |
| UNKNOWN-007 | 前端页面与后端 API 是否在当前运行环境完成真实联调。 | 本次是静态代码分析，未启动服务或执行浏览器验证。 |
| UNKNOWN-008 | 框架认证过滤器、Redis 会话和 JWT 的实际失败顺序。 | 基础设置模块只调用登录上下文；安全基础设施未在本次范围内完整追踪。 |
| UNKNOWN-009 | MySQL 对 `number_prefix` 长度与 Java code point 计数在所有 Unicode 边界上的完全一致性。 | 代码使用 Java code point 计数，数据库长度语义依赖字符集和版本行为。 |
