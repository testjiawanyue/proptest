# Spec → Code Validation

验证时间：2026年10月12日 15:05:49 CST。  
验证范围：基础设置模块，对应 REQ-018～REQ-024。  
需求输入：`ai-test/01-requirement/requirement-baseline.md`。  
代码输入：`ai-test/02-code-analysis/masterdata-code-behavior.md`。  
判定原则：只依据需求基线与已记录的代码行为；函数名、注释和推测不作为通过依据。未记录的实际运行联调证据列为验证缺口，不外推为通过。

## REQ-018

需求：

部件资料必须支持衣体、气囊、传感器、充气发生器四类资料定义；新建后建立首版本；每次编辑产生包含部件名称、规格、厂商、编号前缀的完整新版本，旧版本保留；部件类型建立后不可改；编号前缀选填、最多 32 个 Unicode 码点、不限字符种类、不自动转换或删除字符；`null`、空串、全空白前缀按未填处理；停用/启用只改状态，不产生版本。

代码实现：

后端使用 `POST /prop/part-profile` 新建资料，Service 在事务中先插入 `prop_part_profile`，再插入 `version_no=1` 的 `prop_part_profile_version`，最后把 `current_version_id` 指向新版本。编辑使用 `selectPartProfileForUpdate` 锁定主档，校验类型不可改，再按 `当前版本号 + 1` 插入新完整版本并切换当前版本指针。状态接口只更新 `prop_part_profile.status`，不插入版本。启用资料查询通过 `p.status = '0'` 过滤。

涉及文件：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropPartProfileController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropPartProfileServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropPartProfileMapper.xml`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/domain/PropPartProfile.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/domain/PropPartProfileVersion.java`

涉及方法：

- `PropPartProfileController.add`
- `PropPartProfileController.edit`
- `PropPartProfileController.changeStatus`
- `PropPartProfileController.enabled`
- `PropPartProfileServiceImpl.createPartProfile`
- `PropPartProfileServiceImpl.updatePartProfile`
- `PropPartProfileServiceImpl.changeStatus`
- `PropPartProfileServiceImpl.normalize`
- `PropPartProfileServiceImpl.normalizeOptionalPrefix`
- `PropPartProfileServiceImpl.buildVersion`
- `PropPartProfileMapper.insertPartProfile`
- `PropPartProfileMapper.insertPartProfileVersion`
- `PropPartProfileMapper.updateCurrentVersion`
- `PropPartProfileMapper.selectEnabledPartProfiles`

验证：

正常流程：PASS

`createPartProfile` 明确创建主档、首版本和当前版本指针；`updatePartProfile` 明确追加新版本并切换指针；列表和详情 SQL 都 Join 当前版本，读取最新内容。

异常流程：PASS

请求体使用 `@Validated`；Service 再次校验部件类型、必填名称、必填规格和前缀长度。前端 `PartProfileModal.vue` 在提交前调用表单校验；校验失败时不提交，弹窗不关闭，表单值不重置。编号前缀使用 `numberPrefixValidator.js` 按 Unicode code point 检查最大 32。

业务规则：PASS

部件类型只允许四类；编辑时当前类型与请求类型不一致会抛出「部件类型建立后不可修改」。前缀空白经 `StringUtils.isBlank()` 转为 `null`，非空白不做裁剪、大小写转换或字符类型限制，按 code point 校验不超过 32。状态变更不生成版本。

最终结果：

PASS

问题说明：

代码与迁移脚本允许空白前缀写 `null`。部署数据库是否已经执行可空前缀迁移属于环境确认项，不影响当前代码实现判断，但上线前必须确认。

---

## REQ-019

需求：

部件资料页面必须支持新建、编辑、停用、启用；编辑时类型不可改；表格按四类分组、默认展开；列包含部件名称、厂商、规格、编号前缀、状态和操作；厂商为空显示占位；规格允许完整文本换行；前缀不因数字、中文、符号或大小写混合被拒绝；不提供动态规格参数配置、独立颜色字典或规格解析。

代码实现：

前端部件资料页从 `/prop/part-profile/list` 读取当前版本数据，按四类构造分组行，默认展开四组；页面提供新建、行内编辑、停用/启用确认；编辑弹窗在编辑模式下禁用部件类型。后端对应新增、编辑、状态切换和启用查询接口。

涉及文件：

- `ruoyi-ui/src/views/prop/settings/part-profile/index.vue`
- `ruoyi-ui/src/views/prop/settings/part-profile/PartProfileModal.vue`
- `ruoyi-ui/src/views/prop/settings/part-profile/numberPrefixValidator.js`
- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropPartProfileController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropPartProfileServiceImpl.java`

涉及方法：

- `index.vue` 的 `loadData`、`groupedRows`、`confirmStatus`
- `PartProfileModal.vue` 的 `openAdd`、`openEdit`、`submit`
- `numberPrefixValidator.js` 的 `validateNumberPrefix`
- `PropPartProfileController.list`
- `PropPartProfileController.add`
- `PropPartProfileController.edit`
- `PropPartProfileController.changeStatus`
- `PropPartProfileServiceImpl.createPartProfile`
- `PropPartProfileServiceImpl.updatePartProfile`
- `PropPartProfileServiceImpl.changeStatus`

验证：

正常流程：PASS

页面具备四类分组、默认展开、新建入口、编辑入口和行内状态操作；编辑弹窗在编辑模式禁用部件类型；保存后调用对应新增或编辑 API。

异常流程：PASS

表单必填项、前缀长度在提交前校验；`submit()` 中校验失败不提交，保存中禁止重复提交；服务端错误不会触发成功后的关闭和重置。

业务规则：PASS

页面列与需求一致，空厂商显示占位，规格使用可换行展示；前缀校验只限制长度，不限制字符种类；状态标签区分启用和已停用。代码中没有删除接口和删除按钮。

最终结果：

PASS

问题说明：

未发现基础设置代码内的需求冲突。真实浏览器运行验证不在本报告证据范围内。

---

## REQ-020

需求：

维护对外产品名称字典；新增值保存为启用状态并立即可供订单选择；值去首尾空白后为空不可保存；重复按 REQ-022 提示；不提供删除，仅停用/启用；停用后不出现在新建选择中，已引用历史继续显示原值。

代码实现：

基础数据后端允许 `data_type=external_product_name`；新增时归一化、判重并保存为 `status="0"`；启用查询只返回启用项；状态接口更新状态；没有删除接口。基础数据页面支持类型切换、新增、启用/停用。订单消费端是否实际调用启用接口、是否保留历史原值，不在基础设置代码行为模型中记录。

涉及文件：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropBaseDataController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropBaseDataServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropBaseDataMapper.xml`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/support/OptionValueNormalizer.java`
- `ruoyi-ui/src/views/prop/settings/base-data/index.vue`
- `ruoyi-ui/src/api/prop/baseData.js`

涉及方法：

- `PropBaseDataController.list`
- `PropBaseDataController.add`
- `PropBaseDataController.status`
- `PropBaseDataController.enabled`
- `PropBaseDataServiceImpl.selectByType`
- `PropBaseDataServiceImpl.create`
- `PropBaseDataServiceImpl.changeStatus`
- `PropBaseDataServiceImpl.selectEnabledByType`
- `OptionValueNormalizer.normalize`
- `base-data/index.vue` 的 `load`、`save`、`confirmStatus`

验证：

正常流程：PARTIAL

基础数据维护端可新增对外产品名称并保存为启用状态；`/prop/base-data/enabled/external_product_name` 可提供启用值。但当前输入没有记录 FEAT-10 订单创建或表单如何消费该接口，也没有记录历史订单引用停用值后的展示行为。

异常流程：PASS

服务端先 `strip()`，空白后抛出「值不能为空」；同类型归一化哈希命中启用项提示「该值已存在」，命中停用项提示「该值已存在且已停用，请使用现有启用操作」；不会自动新建或自动启用。

业务规则：PARTIAL

维护端无删除接口，仅支持状态更新；不同类型可同名。订单不删除、历史原值保留属于 FEAT-10 消费行为，本模块代码证据不足。

最终结果：

PARTIAL

问题说明：

基础设置部分已实现；对外产品名称在订单中的实际选择和历史展示需要用 FEAT-10 代码行为证据补充验证。

---

## REQ-021

需求：

维护传感器固件版本字典；新增后立即启用并可供作业管理选择；空值不可保存；重复按 REQ-022 处理；不可删除，仅停用/启用；停用不影响历史；页面只维护对外产品名称和传感器固件版本两类字典。

代码实现：

基础数据后端只接受 `external_product_name` 与 `sensor_firmware_version` 两类 `dataType`；固件版本新增后状态为启用；启用查询过滤 `status='0'`；状态接口更新状态；没有删除接口。页面类型列表只定义这两类。

涉及文件：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropBaseDataController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropBaseDataServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropBaseDataMapper.xml`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/support/OptionValueNormalizer.java`
- `ruoyi-ui/src/views/prop/settings/base-data/index.vue`

涉及方法：

- `PropBaseDataController.add`
- `PropBaseDataController.status`
- `PropBaseDataController.enabled`
- `PropBaseDataServiceImpl.create`
- `PropBaseDataServiceImpl.changeStatus`
- `PropBaseDataServiceImpl.selectEnabledByType`
- `PropBaseDataServiceImpl.validateType`
- `OptionValueNormalizer.normalize`
- `base-data/index.vue` 的类型定义与 `save`

验证：

正常流程：PARTIAL

维护端可新增启用状态的传感器固件版本，启用查询也可返回启用项。但当前输入没有记录 FEAT-16 作业管理下拉是否调用该启用接口，也没有记录作业历史在字典停用后的展示行为。

异常流程：PASS

空白值、重复值和停用重复值的处理与 REQ-022 相同；服务端和数据库唯一约束共同限制同类型归一化值。

业务规则：PARTIAL

页面只允许两类字典，代码无删除接口，停用/启用状态可更新。作业管理只能选择启用版本和历史原值保留的证据不在本模块输入中。

最终结果：

PARTIAL

问题说明：

需要补充 FEAT-16 作业管理对 `/prop/base-data/enabled/sensor_firmware_version` 的消费和历史展示验证。

---

## REQ-022

需求：

基础数据新增前去首尾空白；同一类型内按英文字母大小写不敏感判重；不同类型允许同名；启用和停用项都参与判重；空值不可保存；重复提示区分启用与停用；服务端校验和数据库唯一约束使用相同口径；并发同值最多建立一条；停用/启用经确认；被引用项允许停用。

代码实现：

`OptionValueNormalizer.normalize` 使用 `strip()` 保存显示值，归一化键只将 ASCII `A-Z` 折叠为 `a-z`，再计算 UTF-8 SHA-256 哈希。数据库唯一键是 `(data_type, normalized_hash)`。新增先普通查询重复，再插入；目标唯一键冲突后用 `SELECT ... FOR UPDATE` 重新查询并发记录，并按现有记录状态返回重复提示。全量列表包含停用项，启用查询排除停用项。前端提供状态确认后调用状态接口。

涉及文件：

- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/support/OptionValueNormalizer.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/support/DuplicateKeySupport.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropBaseDataServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropBaseDataMapper.xml`
- `sql/c01_master_data_and_customer.sql`
- `ruoyi-ui/src/views/prop/settings/base-data/index.vue`

涉及方法：

- `OptionValueNormalizer.normalize`
- `DuplicateKeySupport.isConstraint`
- `PropBaseDataServiceImpl.create`
- `PropBaseDataServiceImpl.duplicate`
- `PropBaseDataServiceImpl.changeStatus`
- `PropBaseDataMapper.selectByScopeHash`
- `PropBaseDataMapper.insertBaseData`
- `PropBaseDataMapper.selectByScopeHashForUpdate`
- `base-data/index.vue` 的 `confirmStatus`

验证：

正常流程：PASS

`" Test "` 与 `"test"` 归入同一条；显示值保留裁剪后原大小写；不同 `data_type` 使用不同唯一键范围。全量查询包含启用和停用项，启用查询只返回启用项。

异常流程：PASS

空白值拒绝；启用重复提示「该值已存在」；停用重复提示「该值已存在且已停用，请使用现有启用操作」；不自动启用或复用旧记录。唯一键冲突只识别 `uk_base_data_scope_hash`，其他数据库冲突原样抛出。

业务规则：PASS

服务端哈希和数据库唯一键使用同一 `(type, normalized_hash)` 口径；`"A B"` 与 `"AB"` 哈希不同；并发路径有普通查重、唯一约束和锁读兜底。前端在状态变更前有确认。

最终结果：

PASS

问题说明：

代码对字典值额外施加 200 字符上限，需求基线注明 Spec 未规定长度上限。该限制不与已明确业务规则冲突，但属于实现-added 边界，应作为测试边界确认项。

---

## REQ-023

需求：

作业 NG 与处置清单只能按縫製、センサ、組立三组维护；空值不可保存；重复按同类规则提示；可停用/启用；无删除；现场输入新值只保存到作业记录，不回写清单；停用项不出现在现场选择。

代码实现：

作业选项 Service 的 `scope(...)` 只接受 `disposition` 和 `work_ng` 两个类别，并只接受 `sewing|sensor|assembly` 工作组；新增时设置 `source="admin"`、`status="0"`；唯一键为 `(option_category, work_group, normalized_hash)`；启用查询按类别、工作组并过滤启用状态；没有删除接口。

涉及文件：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropWorkOptionController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropWorkOptionServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropWorkOptionMapper.xml`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/support/OptionValueNormalizer.java`
- `ruoyi-ui/src/views/prop/settings/work-option/index.vue`

涉及方法：

- `PropWorkOptionController.list`
- `PropWorkOptionController.enabled`
- `PropWorkOptionController.add`
- `PropWorkOptionController.status`
- `PropWorkOptionServiceImpl.select`
- `PropWorkOptionServiceImpl.scope`
- `PropWorkOptionServiceImpl.create`
- `PropWorkOptionServiceImpl.changeStatus`
- `PropWorkOptionMapper.selectByScope`
- `PropWorkOptionMapper.insertOption`
- `work-option/index.vue` 的 `switchCategory`、`switchWorkGroup`、`save`、`toggle`

验证：

正常流程：PARTIAL

维护端支持三组类别和工作组下新增、查询、启用/停用；启用查询可返回启用项。FEAT-16 作业现场如何消费该清单没有记录，因此「现场从清单选择」和「现场输入新值不回写」无法在本报告确认。

异常流程：PASS

空白值拒绝；同类别、同工作组内归一化重复会被拦截，启用/停用项提示口径与 REQ-022 一致；不同工作组允许同名。

业务规则：PARTIAL

后端和页面限制为三组；无删除接口；现场录入来源不再由基础设置新增接口产生。但作业现场不回写清单、停用项不进入现场选择的实际行为缺少 FEAT-16 证据。

最终结果：

PARTIAL

问题说明：

基础设置维护端已实现；需要补充 FEAT-16 作业登记消费清单、现场输入隔离和历史展示验证。

---

## REQ-024

需求：

受付 NG 快捷选项为全局清单，不分工作组；新增后启用；空值不可保存；全局大小写不敏感判重；重复提示同 REQ-022；可停用/启用，不提供删除；FEAT-14 受付弹窗点击启用项填充 NG 内容且填入后可编辑；已登记 NG 不受字典后续变化影响。

代码实现：

作业选项 Service 对 `reception_ng` 类别固定返回 `global`，忽略请求中的 `workGroup`；新增保存为启用项；唯一键为 `(option_category, work_group, normalized_hash)`；启用查询过滤 `status='0'`；没有删除接口。页面选择受付 NG 时不传工作组。

涉及文件：

- `ruoyi-admin/src/main/java/com/ruoyi/web/controller/prop/PropWorkOptionController.java`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/service/impl/PropWorkOptionServiceImpl.java`
- `ruoyi-prop/src/main/resources/mapper/prop/masterdata/PropWorkOptionMapper.xml`
- `ruoyi-prop/src/main/java/com/ruoyi/prop/masterdata/support/OptionValueNormalizer.java`
- `ruoyi-ui/src/views/prop/settings/work-option/index.vue`

涉及方法：

- `PropWorkOptionController.enabled`
- `PropWorkOptionController.add`
- `PropWorkOptionController.status`
- `PropWorkOptionServiceImpl.select`
- `PropWorkOptionServiceImpl.scope`
- `PropWorkOptionServiceImpl.create`
- `PropWorkOptionServiceImpl.changeStatus`
- `OptionValueNormalizer.normalize`

验证：

正常流程：PARTIAL

维护端可新增全局启用项，启用查询也可返回全局启用项。FEAT-14 受付工作台是否调用启用接口、是否渲染可点击胶囊、填入后是否可编辑，未出现在基础设置代码行为输入中。

异常流程：PASS

空白值拒绝；全局范围内同归一化值重复被拦截；启用/停用重复提示与 REQ-022 一致；状态更新只改变状态。

业务规则：PARTIAL

`reception_ng` 固定使用 `global`，无删除接口，登记历史快照与字典变化不回写的规则属于 FEAT-14 保存行为，当前输入没有证据。

最终结果：

PARTIAL

问题说明：

需要补充 FEAT-14 受付 NG 弹窗消费 `/prop/work-option/enabled?category=reception_ng` 以及 NG 文本快照行为的验证。

---

## 问题汇总

### P0

无。

### P1

| REQ | 问题 | 影响 | 建议 |
|---|---|---|---|
| REQ-020 | FEAT-10 订单对启用对外产品名称的消费和历史原值展示缺少代码行为证据。 | 无法确认字典新增后「立即可供订单选择」和停用后历史保留的完整闭环。 | 补充订单模块代码行为分析，并验证订单表单消费、提交快照和历史展示。 |
| REQ-021 | FEAT-16 作业管理对启用固件版本的消费和历史展示缺少代码行为证据。 | 无法确认作业下拉只含启用项、历史原值不受停用影响。 | 补充作业管理代码行为分析，并验证下拉来源、提交快照和历史展示。 |

### P2

| REQ | 问题 | 影响 | 建议 |
|---|---|---|---|
| REQ-023 | FEAT-16 作业现场从清单选择、现场输入不回写清单缺少证据。 | 无法确认基础设置清单与作业登记的隔离闭环。 | 在 FEAT-16 代码行为分析中验证清单消费、现场新值仅保存到作业记录、停用项不出现在选择。 |
| REQ-024 | FEAT-14 受付 NG 弹窗对启用项的点击填充和文本快照缺少证据。 | 无法确认快捷选项仅作输入辅助且不回写已登记 NG。 | 在 FEAT-14 代码行为分析中验证启用胶囊渲染、点击填充、继续编辑和保存快照。 |

### P3

| REQ | 问题 | 影响 | 建议 |
|---|---|---|---|
| REQ-018 | 部署数据库的 `number_prefix` 可空迁移状态未知。 | 若迁移未执行，空白前缀写入 `null` 可能在运行环境失败。 | 上线前直接查询目标库表结构，并测试空白前缀保存。 |
| REQ-022 | 字典值代码限制 200 字符，需求基线注明 Spec 未规定长度。 | 超过 200 字符的输入会被拒绝，需确认是否接受该实现边界。 | 将 200 字符作为边界用例，必要时要求产品裁决或调整 Spec。 |

## 结论

REQ-018、REQ-019、REQ-022 为 PASS。  
REQ-020、REQ-021、REQ-023、REQ-024 为 PARTIAL，原因是基础设置维护端已实现，但跨模块消费行为没有包含在当前代码行为输入中，不能据此判定完整闭环通过。  
无 FAIL。
