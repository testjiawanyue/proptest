# PROP 基础设置模块架构分析

分析时间：2026-10-12 14:16:36 CST。  
分析对象：当前工作树，Git 提交 `dbcfbaf`。  
分析方法：仅基于源码、MyBatis XML、数据库脚本和前端调用链做静态审查；不根据产品规格反推实现行为。

## 1. 分析范围

本文覆盖 PROP `基础设置` 菜单下的三个模块：

| 模块 | 源码包 | 主要数据表 |
|---|---|---|
| 部件资料 | `com.ruoyi.prop.masterdata` | `prop_part_profile`、`prop_part_profile_version` |
| 基础数据 | `com.ruoyi.prop.masterdata` | `prop_base_data` |
| 作业选项 | `com.ruoyi.prop.masterdata` | `prop_work_option` |

客户管理不在本文范围内。虽然客户管理也位于 `masterdata` 包，但它属于 C01 客户业务模块，而不是上述三个基础设置页面。

## 2. 运行结构

```text
Vue 基础设置页面
  -> src/api/prop/*.js 中的 axios 请求封装
  -> HTTP 请求
  -> Spring Security 登录上下文 / JWT
  -> @PreAuthorize 权限校验
  -> PROP Controller
  -> Service 实现
  -> 业务归一化 / 业务分支
  -> MyBatis Mapper 接口
  -> MyBatis XML SQL
  -> MySQL 数据表
  -> Service 返回值或 ServiceException
  -> AjaxResult 响应
```

该模块使用 RuoYi 既有技术栈，没有另建独立架构：

- 前端：Vue 3、Ant Design Vue、axios。
- Controller 层：`@RestController`、`@PreAuthorize`，并通过 `BaseController` 辅助返回。
- Service 层：构造器注入 Mapper，承载业务规则。
- 持久层：Java Mapper 接口加 MyBatis XML。
- 数据库：`sql/c01_master_data_and_customer.sql` 中定义的 MySQL 表。
- 响应结构：所有已分析的基础设置接口都返回 `AjaxResult`；这些列表接口均未使用分页结构 `TableDataInfo`。

## 3. 模块入口

### 3.1 部件资料

- Controller：`ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropPartProfileController.java`
- API 根路径：`/prop/part-profile`
- Service：`ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropPartProfileServiceImpl.java`
- Mapper XML：`ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropPartProfileMapper.xml`
- 页面：`ruoyi-ui/src/views/prop/settings/part-profile/index.vue`

代码中实际实现的接口如下：

| HTTP 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/prop/part-profile/list` | `prop:partProfile:page` |
| GET | `/prop/part-profile/{profileId}` | `prop:partProfile:page` |
| POST | `/prop/part-profile` | `prop:partProfile:page` |
| PUT | `/prop/part-profile` | `prop:partProfile:page` |
| PUT | `/prop/part-profile/{profileId}/status` | `prop:partProfile:page` |
| GET | `/prop/part-profile/enabled/{partType}` | 以下任一权限：`prop:partProfile:page`、`prop:intake:page`、`prop:assembly:page`、`prop:product:page`、`prop:part:page` |

### 3.2 基础数据

- Controller：`ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropBaseDataController.java`
- API 根路径：`/prop/base-data`
- Service：`ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropBaseDataServiceImpl.java`
- Mapper XML：`ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropBaseDataMapper.xml`
- 页面：`ruoyi-ui/src/views/prop/settings/base-data/index.vue`

代码中实际实现的接口如下：

| HTTP 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/prop/base-data/list/{dataType}` | `prop:baseData:page` |
| POST | `/prop/base-data` | `prop:baseData:page` |
| PUT | `/prop/base-data/{dataId}/status` | `prop:baseData:page` |
| GET | `/prop/base-data/enabled/{dataType}` | 以下任一权限：`prop:baseData:page`、`prop:assembly:page`、`prop:product:page` |

### 3.3 作业选项

- Controller：`ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropWorkOptionController.java`
- API 根路径：`/prop/work-option`
- Service：`ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropWorkOptionServiceImpl.java`
- Mapper XML：`ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropWorkOptionMapper.xml`
- 页面：`ruoyi-ui/src/views/prop/settings/work-option/index.vue`

代码中实际实现的接口如下：

| HTTP 方法 | 路径 | 权限 |
|---|---|---|
| GET | `/prop/work-option/list?category=&workGroup=` | `prop:workOption:page` |
| GET | `/prop/work-option/enabled?category=&workGroup=` | `prop:workOption:page` |
| POST | `/prop/work-option` | `prop:workOption:page` |
| PUT | `/prop/work-option/{id}/status` | `prop:workOption:page` |

Controller 层的 `workGroup` 参数声明为可选。是否必填由 `PropWorkOptionServiceImpl.scope(...)` 根据类别决定。

## 4. 持久化模型

### 4.1 部件资料

`prop_part_profile` 保存稳定的部件身份、类型、启停状态和当前版本指针：

- `profile_id`
- `part_type`
- `status`
- `current_version_id`

`prop_part_profile_version` 保存不可变的历史内容：

- `version_id`
- `profile_id`
- `version_no`
- `part_name`
- `specification`
- `manufacturer`
- `number_prefix`

Mapper 查询始终通过 `prop_part_profile.current_version_id` 关联当前版本。编辑操作不会修改既有版本行，而是插入新版本并移动当前版本指针。

基础 SQL 中的约束包括：

- `prop_part_profile_version` 的 `(profile_id, version_no)` 唯一键。
- 版本表到 profile 表的外键。
- profile 当前版本到版本表的外键。
- `(part_type, status)` 索引。

初始脚本将 `number_prefix` 定义为 `NOT NULL`。后续迁移脚本将其放宽为可空。Java 服务在空白前缀时会写入 `null`。仅凭 Java 代码无法证明某个部署环境已经执行了可空前缀迁移。

### 4.2 基础数据

`prop_base_data` 保存以下字段：

- `data_id`
- `data_type`
- `display_value`
- `normalized_hash`
- `status`

数据库唯一键为 `uk_base_data_scope_hash(data_type, normalized_hash)`。因此，相同文本可以存在于不同数据类型下；但在同一数据类型内，归一化后的文本只能存在一次。

### 4.3 作业选项

`prop_work_option` 保存以下字段：

- `option_id`
- `option_category`
- `work_group`
- `display_value`
- `normalized_hash`
- `source`
- `status`

数据库唯一键为 `uk_work_option_scope_hash(option_category, work_group, normalized_hash)`。因此，相同值可以存在于不同类别或工作组下。

## 5. 共性行为

### 5.1 值归一化

基础数据和作业选项都使用 `OptionValueNormalizer.normalize(...)`：

- 拒绝 `null` 或仅包含空白字符的输入。
- 使用 Java 的 `String.strip()` 生成最终保存的显示值。
- 归一化键只将 ASCII `A-Z` 折叠为 `a-z`。
- 不执行 Unicode 大小写折叠、全角/半角转换、内部空白压缩或标点归一化。
- 使用 UTF-8 编码的 SHA-256 生成哈希。

代码和单元测试支持的示例：

| 输入 | 保存的显示值 | 去重归属 |
|---|---|---|
| `" Test "` | `"Test"` | `"test"` |
| `"TEST"` | `"TEST"` | `"test"` |
| `"Ｔｅｓｔ"` | `"Ｔｅｓｔ"` | 与 `"test"` 不同 |
| `"A B"` | `"A B"` | 与 `"AB"` 不同 |

### 5.2 重复值处理

基础数据和作业选项的新增逻辑采用相同模式：

1. 归一化并计算哈希。
2. 按范围和哈希查询现有记录。
3. 如果存在，拒绝新增。
4. 否则插入。
5. 如果 MySQL 返回唯一键冲突，使用 `SELECT ... FOR UPDATE` 重新查询。
6. 如果找到并发产生的记录，返回相同的重复值错误。
7. 如果未找到，重新抛出原始数据库异常。

错误消息根据现有记录当前状态变化：

- 启用（`0`）：`该值已存在`
- 停用（`1`）：`该值已存在且已停用，请使用现有启用操作`

新增操作不会自动启用已停用记录，也不会复用旧记录。

`DuplicateKeySupport.isConstraint(...)` 会遍历异常链查找约束名。与目标约束无关的重复键异常会被原样抛出，不会转换成重复值业务消息。

### 5.3 状态语义

三个模块均使用字符状态：

- `0`：启用
- `1`：停用

已分析的基础设置 API 没有删除接口。可变更状态只有启用/停用；部件资料还可通过追加新版本更新内容。

没有任何状态接口强制执行真实状态迁移。例如，重复提交当前状态仍会被视为有效更新。

### 5.4 事务

使用事务的方法如下：

- `PropBaseDataServiceImpl.create`
- `PropPartProfileServiceImpl.createPartProfile`
- `PropPartProfileServiceImpl.updatePartProfile`
- `PropPartProfileServiceImpl.changeStatus`
- `PropWorkOptionServiceImpl.create`

上述方法均使用 `@Transactional(rollbackFor = Exception.class)`。

基础数据和作业选项的状态变更方法没有显式事务注解。它们各执行一条更新语句；单条数据库语句是原子的，但这不等同于声明式服务事务。

### 5.5 权限校验

Controller 使用 RuoYi 的 `@ss.hasPermi(...)` 或 `@ss.hasAnyPermi(...)` 进行 Spring 方法级权限校验。

- 单权限接口必须拥有指定权限字符串。
- `hasAnyPermi` 只要求拥有列表中的任意一个权限。
- 权限字符串由 SQL 作为页面权限初始化；本次源码审查无法证明运行环境中哪些角色已被授予这些权限。

已分析的基础设置 Service 没有额外的角色过滤或数据范围过滤。SQL 查询会返回当前权限可见范围内的所有匹配记录。

### 5.6 参数校验

校验分布在多层：

1. Controller 请求体上的 Bean Validation。
2. Service 中的显式校验和归一化。
3. 数据库约束。

关键规则如下：

| 模块 | Bean Validation | Service 追加行为 |
|---|---|---|
| 部件资料 | `partType` 必须为四个值之一；`partName`、`specification` 必填；名称/厂商最大 200 字符 | Service 会裁剪必填名称/规格；厂商空白转为 `null`；前缀空白转为 `null`；前缀最大 32 个 Unicode code point |
| 基础数据 | `dataType` 必须匹配指定模式；显示值必填且最大 200 字符 | Service 再次校验类型，裁剪显示值并计算哈希 |
| 作业选项 | 类别必填；显示值必填且最大 200 字符 | Service 校验类别/工作组范围并归一化值 |

`PropPartProfile.numberPrefix` 没有 Bean Validation 注解。其长度由 Service 使用 Java code point 数量校验。

### 5.7 错误处理

业务规则抛出 `ServiceException`，由 RuoYi 全局异常处理器转换为 `AjaxResult` 错误响应。

全局处理器还会处理：

- `AccessDeniedException`：权限失败。
- `BindException` 和 `MethodArgumentNotValidException`：返回第一个校验错误消息。
- 缺少路径变量和参数类型不匹配。
- 通用运行时异常和受检异常。

除基础数据和作业选项新增时对预期重复键异常的处理外，已分析 Service 没有本地 try/catch。

## 6. 模块级明确不存在的能力

基于已分析源码，基础设置模块没有直接实现以下能力：

- 调用第三方系统 HTTP 接口。
- 消息队列生产者或消费者。
- 本地文件读写。
- 定时任务。
- 文件上传或下载。
- 邮件发送。

该模块间接依赖框架基础设施，例如认证、操作日志和数据库配置。

## 7. 面向测试的横切观察点

1. 基础数据和作业选项的值不是全局唯一。去重范围由类型、类别或工作组决定。
2. 重复值校验只对 ASCII 大写字母做大小写折叠。
3. 部件资料新增时，名称、规格或编号前缀没有应用层唯一性校验。
4. 部件资料类型创建后不可修改。
5. 部件资料每次成功编辑都会追加新版本，即使提交内容完全相同。
6. 停用状态的基础数据和作业选项仍出现在全量列表中；启用查询会排除它们。
7. 部件资料历史版本没有恢复/启用接口；编辑操作只会创建更新的版本。
8. 没有删除接口，因此无法从 API 推断清理行为。
9. 部署环境的部件资料前缀字段是否可空，必须在对应环境中直接确认。

## 8. 代码文件索引

Controller：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropPartProfileController.java`
- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropBaseDataController.java`
- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropWorkOptionController.java`

Service：

- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropPartProfileServiceImpl.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropBaseDataServiceImpl.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropWorkOptionServiceImpl.java`

Mapper 接口：

- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/mapper/PropPartProfileMapper.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/mapper/PropBaseDataMapper.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/mapper/PropWorkOptionMapper.java`

MyBatis XML：

- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropPartProfileMapper.xml`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropBaseDataMapper.xml`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropWorkOptionMapper.xml`

领域模型：

- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/domain/PropPartProfile.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/domain/PropPartProfileVersion.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/domain/PropBaseData.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/domain/PropWorkOption.java`

支撑类：

- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/support/OptionValueNormalizer.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/support/DuplicateKeySupport.java`

前端 API 封装：

- `ruoyi-ui/src/api/prop/partProfile.js`
- `ruoyi-ui/src/api/prop/baseData.js`
- `ruoyi-ui/src/api/prop/workOption.js`
