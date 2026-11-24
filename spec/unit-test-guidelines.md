# PROP 单元测试编写规范建议

> 适用范围：`prop_new` 仓库后端（Java / Spring Boot / MyBatis）和前端（Vue 3 / Node / Ant Design Vue）。
> 状态：建议文档，不是强制约束。AGENTS.md 已明确"当前仓库尚未建立稳定的一方自动测试基线"，本规范用于指导"条件允许应补充针对性测试"的场景。

---

## 1. 测试编写的决策链

单元测试不是开发流程的强制门禁，而是以下四层驱动的**定点补充**：

```
OpenSpec spec.md Requirement/Scenario
        ↓  静态代码行为分析
BR 行为规则清单（ai-test/02-code-analysis/*-code-behavior.md）
        ↓  判定"哪些能用单测支撑"
V5 用例静态支撑表（ai-test/04-validation/*-code-test-v5.md）
        ↓  人工挑选"不需要真实 DB/容器就能跑通"的条目
单元测试代码（就近复用同类已有测试的范式）
```

**不满足上述条件的**，留给 `auto-explore` 运行时验证（Playwright + UI/DB/API 全链路）或人工验收。

### 1.1 优先级排序（高 → 低）

| 优先级 | 测试对象 | 为什么 | 项目内已有示例 |
|---|---|---|---|
| P0 | 纯业务规则、状态机、必填校验 | 不依赖数据库、启动快、改坏立即暴露 | `ReceptionRulesTest`、`WorkRulesTest` |
| P0 | Service 层"失败不写入"路径 | 事务回滚逻辑用 Mock 能精确验证 | `PropCustomerServiceImplTest.historyRejectsMissingNumber...` |
| P0 | 请求取消 / 防重放 / 迟到响应处理 | 前端竞态最容易回归 | `customer-presentation.test.mjs` 的 stale list response 测试 |
| P1 | MyBatis XML 的 SQL 契约（ORDER BY、WHERE 拼接） | 改坏了前端看不出来 | `PropCustomerMapperOrderingTest` 直接读 XML 文本断言 |
| P1 | 文档渲染（PDF 页数/坐标、Excel 行数） | 真实调用渲染器，比截图验收精确 | `InspectionReportRendererTest`、`WaybillWorkbookWriterTest` |
| P1 | 编号分配、时间锁定、快照序列化 | 有明确输入输出契约 | `PropOrderServiceImplTest.orderCreationUsesBusinessTime...` |
| P2 | Controller 参数解析、分页透传 | MockMvc 可 standaloneSetup，不需要完整容器 | `PropCustomerControllerPagingTest` |
| P2 | 权限拦截和异常码映射 | Mock 静态 SecurityUtils 可覆盖 | `PropBatchReportControllerTest` |
| P3 | UI 渲染字段存在性、空值占位、HTML 转义 | SSR 渲染后字符串匹配 | `customer-presentation.test.mjs` 的 ContactView 六字段测试 |

### 1.2 不适合写单元测试的场景

以下内容**不建议**用单测覆盖，直接跳过：

- 需要真实 MySQL 事务隔离、行锁、唯一约束才能验证的并发场景（交给 Playwright 多浏览器会话验证）
- 依赖 Redis / 外部文件存储 / 邮件发送的功能
- 权限完整链路（SecurityFilterChain + 菜单 + 角色）——用代码分析 + 接口级验证
- 视觉样式、布局密度、滚动边界——用 `auto-explore` Playwright 截图比对或人工验收
- 纯 getter/setter 的 DTO 类
- 已经在其他层级覆盖过的测试路径（避免重复）

---

## 2. 测试来源与需求的追溯方式

### 2.1 每个测试方法名应能直接定位到 spec / BR / 用例

测试方法命名格式：

```
[被测对象]_[行为]_[边界/条件]
```

示例——来源追溯链：

| 测试方法 | 对应来源 |
|---|---|
| `PropCustomerServiceImplTest.allocationLocksSharedSequenceAndUsesCurrentMaximum` | OpenSpec `customer-management/spec.md` Requirement"客户编号共享分配" Scenario"公司与支店连续编号" → BR-028/BR-029 → V5"公司维护-008" |
| `PropCustomerMapperOrderingTest.companyQueriesOrderBeforePagingByCreationAndStableId` | BR-010 公司按创建时间倒序 → V5"客户列表查询-030" |
| `ReceptionRulesTest.rejectsIllegalValuesWithoutRounding` | OpenSpec `FEAT-14-reception/spec.md` 的受付规则校验 Requirement |
| `customer-presentation.test.mjs` 的"历史 403 后超时保留 earlier uncertainty" | OpenSpec `FEAT-01-customer/spec.md` 的"客户页面级授权" + BR-059"无乐观锁" |

### 2.2 注释可以补充"不做什么"的负向行为

BR 清单里有大量"**不做**"类规则（BR-041 无名称唯一性检查、BR-059 无乐观锁、BR-043 取消不调写接口）。测试必须**显式断言它没做**，而不是只测正向路径。

```java
// 示例：断言"没写入任何数据"
verify(mapper, never()).insertSubject(any(), any());

// 示例：断言"没有发起写请求"（前端）
assert.equal(writes, 0);
```

---

## 3. 后端编写范式（Java / JUnit 5 / Mockito）

### 3.1 范式一：纯规则测试

适用场景：静态方法、状态机、必填校验、枚举合法性。

参考：`ruoyi-prop/src/test/java/com/ruoyi/prop/reception/service/ReceptionRulesTest.java`

```java
@ExtendWith(JapaneseMessagesExtension.class)
class ReceptionRulesTest {

    @Test
    void rejectsIllegalValuesWithoutRounding() {
        Reception r = new Reception();
        // 边界值 + 非法值
        assertThrows(ServiceException.class, () -> ReceptionRules.apply(r, "box", 0));
        assertThrows(ServiceException.class, () -> ReceptionRules.apply(r, "box", -1));
        assertThrows(ServiceException.class, () -> ReceptionRules.apply(r, "box", 1.5));
        assertThrows(ServiceException.class, () -> ReceptionRules.apply(r, "box", null));
    }
}
```

**要点**：
- 只 new 域对象，不启动 Spring
- 用 `@ExtendWith(JapaneseMessagesExtension.class)` 装载日文消息，使 `ServiceException` 抛出的是真实日文提示而非默认英文
- 边界值要覆盖：0、负数、小数、null、超长、全角、带空格
- 同时测"合法值可以通过"和"非法值被拒绝"

### 3.2 范式二：Service 层 Mock 测试（最常用）

适用场景：有 Mapper 依赖、事务注解、加锁序列、请求幂等。

参考：`ruoyi-prop/src/test/java/com/ruoyi/prop/customer/service/PropCustomerServiceImplTest.java`

```java
@ExtendWith({MockitoExtension.class, JapaneseMessagesExtension.class})
class PropOrderServiceImplTest {

    @Mock private PropOrderMapper mapper;
    @Mock private PropCustomerMapper customerMapper;
    @InjectMocks private PropOrderServiceImpl service;

    @BeforeEach
    void setUp() {
        service = new PropOrderServiceImpl(mapper, customerMapper,
                new ObjectMapper(), transactionTemplate,
                mock(PropShipmentService.class));
    }

    @Test
    void historyRejectsMissingNumberAndUnsafeSystemNumberBeforeAnyWrite() {
        // 1. 输入非法
        for (String number : List.of(null, " ", "x".repeat(65), "C9223372036854775807")) {
            var input = company("旧会社");
            input.setCustomerNo(number);
            assertEquals(400, assertThrows(ServiceException.class,
                    () -> service.createHistoricalCompany(input, "tester")).getCode());
        }
        // 2. 关键：失败路径不触发任何写操作
        verify(mapper, never()).lockCustomerNumber();
        verify(mapper, never()).insertSubject(any(), any(java.util.Date.class));
    }
}
```

**要点**：
- `@InjectMocks` 自动注入 `@Mock`，但如果 Service 有复杂构造器（如 `PropOrderServiceImpl` 需要手动传多个参数），就在 `@BeforeEach` 里显式 new，更清晰
- **失败路径必须加 `verify(mapper, never()).xxx()`**——这是"事务完整性"的核心证据
- 用 `InOrder` 验证加锁 → 写主表 → 写子表的顺序
- 用 `ArgumentCaptor` 捕获实际传入 Mapper 的参数，断言快照字段、审计时间、锁定值
- 需要控制当前时间时，用 `mockStatic(DateUtils.class)` 在测试内 mock，退出 try 块自动恢复
- `@Transactional(rollbackFor = Exception.class)` 等注解用反射读取验证（这是 Mock 测试无法覆盖的——只能验证注解存在）

### 3.3 范式三：MyBatis XML 契约测试

适用场景：SQL 排序、WHERE 条件拼接、UPDATE 字段列表。

参考：`ruoyi-prop/src/test/java/com/ruoyi/prop/customer/mapper/PropCustomerMapperOrderingTest.java`

```java
class PropCustomerMapperOrderingTest {

    private static final String MAPPER_RESOURCE = "/mapper/prop/customer/PropCustomerMapper.xml";

    @Test
    void companyQueriesOrderBeforePagingByCreationAndStableId() throws IOException {
        String xml = mapperXml(); // getResourceAsStream 读 XML 文本
        assertOrderBy(selectBlock(xml, "selectCompanyPage"),
                "s.create_time DESC,s.subject_id DESC");
    }

    private String orderBy(String block) {
        String normalized = normalize(block);
        int start = normalized.lastIndexOf("ORDER BY ");
        return normalized.substring(start + "ORDER BY ".length()).trim();
    }
}
```

**要点**：
- 直接读 XML 文件字符串，不启动 MyBatis
- 这是"契约测试"——能防止有人改坏 SQL 排序，但**不能证明 SQL 在 MySQL 中执行正确**
- 用 `assertFalse(orderBy.contains("customer_no"))` 可以断言"不会按不该排序的字段排序"
- 放在 `src/test/java` 下需要确保 XML 在测试 classpath 里（Mapper XML 通常由 Maven resources 配置包含）

### 3.4 范式四：Controller MockMvc 测试

适用场景：参数解析、分页透传、请求体反序列化、异常码映射。

参考：`ruoyi-admin/src/test/java/com/ruoyi/web/controller/prop/PropCustomerControllerPagingTest.java`

```java
@ExtendWith(PublicMessagesExtension.class)
class PropCustomerControllerPagingTest {

    @Test
    void customerNumberAndUpdateTimeParametersCannotOverrideFixedMapperOrder() throws Exception {
        IPropCustomerService service = mock(IPropCustomerService.class);
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(
                new PropCustomerController(service)).build();

        mockMvc.perform(get("/prop/customer/list?pageNum=2&pageSize=7"
                + "&orderByColumn=customerNo&isAsc=asc"))
            .andExpect(status().isOk());

        // PageHelper 捕获：外部排序参数被忽略
        assertEquals(null, page.getOrderBy());
    }
}
```

**要点**：
- 用 `standaloneSetup` 不需要完整 Spring 容器，只组装 Controller + 异常处理
- 配合 `PageHelper.getLocalPage()` 可以捕获 Controller 内触发的分页对象
- 需要验证权限拦截时，用 `mockStatic(SecurityUtils.class)` 让它返回一个 mock 的 `LoginUser`

### 3.5 范式五：真实输出测试

适用场景：PDF 页数/坐标、Excel 行数/单元格值、邮件 HTML。

参考：`ruoyi-prop/src/test/java/com/ruoyi/prop/inspectionreport/pdf/InspectionReportRendererTest.java`

```java
@Test
void normalPdfKeepsOriginalSheetRegionalRelationships() throws Exception {
    var snapshot = fixture(false);
    try (PdfReader pdf = new PdfReader(
            new InspectionReportRenderer().render(snapshot,
                    InspectionReportTemplate.registered("single-inspection-v1")))) {
        assertEquals(1, pdf.getNumberOfPages());
        Coordinates positions = new Coordinates();
        new PdfTextExtractor(pdf, positions).getTextFromPage(1);
        // 断言关键字的 Y 坐标关系
        assertTrue(positions.at("検証用株式会社").y()
                < positions.at("株式会社プロップ").y());
    }
}
```

**要点**：
- 真实调用渲染器，生成真实 PDF/Excel/邮件 HTML
- 断言页数、关键文字存在、坐标关系、字体大小
- 使用 `try (AutoCloseable)` 自动关闭文件流

---

## 4. 前端编写范式（Vue 3 / Node / @vue/compiler-sfc）

### 4.1 测试框架

前端使用 Node 内置测试框架：

```json
// ruoyi-ui/package.json
"test": "node --test \"tests/*.test.mjs\""
```

不引入 Vitest / Jest / jsdom —— 现有所有测试文件都在这个约束下工作。

### 4.2 范式一：纯函数测试

适用场景：utils 下的 `.mjs` / `.js` 工具函数。

参考：`ruoyi-ui/tests/business-time.test.mjs`

```mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBusinessTime, businessToday } from '../src/utils/businessTime.mjs';

test('offsets and epochs display one Japan instant', () => {
    assert.equal(formatBusinessTime('2026-10-04T02:47:46Z'), '2026-10-04 11:47:46');
    assert.equal(formatBusinessTime(null), null);
});

test('Japan midnight and year do not depend on process default zone', () => {
    for (const TZ of ['UTC', 'Asia/Shanghai', 'Asia/Tokyo']) {
        const result = spawnSync(process.execPath, [
            '--input-type=module', '-e',
            `import {businessToday} from './src/utils/businessTime.mjs';
             console.log(businessToday(new Date('2026-12-31T15:00:00Z')));`
        ], { env: { ...process.env, TZ }, encoding: 'utf8' });
        assert.equal(result.stdout.trim(), '2027-01-01');
    }
});
```

**要点**：
- `spawnSync` 起子进程是为了**换 TZ** —— Node 的 TZ 在进程启动后不能改，换时区测试只能开新进程
- 纯函数测试最稳，没有 DOM 依赖

### 4.3 范式二：Vue SFC 编译 + setup 状态/方法测试（核心范式）

适用场景：列表页查询状态机、编辑器 payload 构造、请求取消、防重放、stale response 处理。

参考：`ruoyi-ui/tests/customer-presentation.test.mjs`

```mjs
function sfc(name, injected = {}) {
    const filename = 'views/prop/customer/' + name;
    const { descriptor } = parse(
        readFileSync(new URL('../src/' + filename, import.meta.url), 'utf8'),
        { filename });
    const script = compileScript(descriptor, { id: 'customer-probe' });
    const { code } = transformSync(script.content, { loader: 'ts', format: 'cjs' });

    // mock 所有外部依赖
    const imports = {
        vue: { ...Vue, onMounted() {}, onBeforeUnmount() {} },
        '@/api/prop/customer': {},
        'vue-i18n': { useI18n },
        // ...
        ...injected,
    };
    new Function('require', 'module', 'exports', code)(
        id => Object.hasOwn(imports, id) ? imports[id] : require(id),
        module, module.exports);

    const scope = Vue.effectScope();
    return {
        state: scope.run(() =>
            module.exports.default.setup({}, { expose() {}, emit() })),
        scope, events: [],
    };
}

test('late list responses cannot overwrite new results', async () => {
    const queue = [];
    const { state: s, scope } = sfc('index.vue', {
        '@/api/prop/customer': {
            listCustomers: () => {
                const d = deferred();
                queue.push(d);
                return d.promise;
            }
        }
    });
    try {
        const a = s.load({ keyword: 'old' });
        const b = s.load({ keyword: 'new' });
        queue[1].resolve({ rows: [{ subjectId: 9 }], total: 1 });
        await b;
        queue[0].resolve({ rows: [{ subjectId: 1 }], total: 99 });
        await a;
        // 迟到响应被丢弃
        assert.equal(s.applied.keyword, 'new');
        assert.equal(s.total.value, 1);
    } finally {
        scope.stop();
    }
});
```

**要点**：
- `scope.stop()` 是 cleanup 必须的——effectScope 会清理 effect、watch、computed，否则测试间状态泄露
- 用 `deferred()` 队列控制请求 resolve/reject 的时机，精确模拟竞态
- `s.formRef.value = { validate: async() => { throw { errorFields: [...] } } }` 构造校验失败场景——直接替换 ref，不需要真的渲染组件
- `emit(...)` 收集到 events 数组，断言成功保存后 emit 了跳转事件

### 4.4 范式三：SSR 渲染 + HTML 断言

适用场景：详情页字段展示、空值占位符、HTML 转义防 XSS、表格列数。

参考：`ruoyi-ui/tests/customer-presentation.test.mjs`

```mjs
test('detail keeps all six contact fields and site name/number/path order', async () => {
    const { state: s, scope } = sfc('detail.vue');
    try {
        const html = await renderToString(
            Vue.createSSRApp(s.ContactView, {
                contact: {
                    contactName: '担当者', jobTitle: '',
                    phone: '03', fax: '', email: 'long@example.test',
                    note: '', createTime: '2026-10-19'
                }
            }).use(i18n));

        // 断言六字段都渲染了（空值显示 "—"）
        for (const text of ['役職', '電話番号', 'ファックス', 'メール', '備考', '登録日'])
            assert.ok(html.includes(text), text);
        assert.ok(html.includes('—')); // 空值占位
        assert.equal((html.match(/<th\b/g) || []).length, 6);
    } finally {
        scope.stop();
    }
});
```

**要点**：
- 不用 jsdom，直接 SSR 得到纯 HTML 字符串
- 断言字段顺序、标签数量、空值占位符
- HTML 转义防 XSS：`assert.match(html, /&lt;script&gt;user&lt;\/script&gt;/)`

### 4.5 范式四：页面 script vm 执行（订单 form 等复杂交互）

适用场景：`order/form.vue` 这种有大量辅助写入、确认弹窗、状态跳转的复杂页面。

参考：`ruoyi-ui/tests/prop-order-command-state.test.mjs`

```mjs
function pageSetup(page, bindings = {}) {
    const source = readFileSync(
        new URL(`../src/views/prop/order/${page}.vue`, import.meta.url), 'utf8');
    const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1]
        .replace(/^import[\s\S]*?;$/gm, ''); // 去掉 import

    const context = vm.createContext({
        ref: value => ({ value }),
        reactive: value => value,
        computed: read => ({ get value() { return read(); } }),
        onMounted() {}, onBeforeUnmount(cb) { unmounts.push(cb); },
        watch(...args) { watchers.push(args); },
        useRoute: () => ({ params: {} }),
        useRouter: () => ({
            push: async path => { guard && guard(); navigation.push(path); }
        }),
        // mock API
        ...bindings,
    });
    vm.runInContext(script, context);
    return {
        read: expression => vm.runInContext(expression, context),
        navigation, canLeave, switchObject,
    };
}

test('创建超时及确认再失败保留原命令', async () => {
    const page = pageSetup('form', {
        createOrder: async () => { throw { response: { status: 504 } }; }
    });
    page.read("frozenCommand.value = { requestId: 'original', quantity: 2 }");
    await page.read('submitCommand(frozenCommand.value)');
    assert.equal(page.read('commandState.value'), 'uncertain'); // 进入不确定态
    assert.equal(await page.canLeave(), false); // 不能离开
    // 确认后再失败
    await page.read('confirmUnknownResult()');
    assert.equal(page.read('commandState.value'), 'uncertain'); // 仍然不确定
});
```

**要点**：
- `<script setup>` 编译后的 setup 函数会被 Vue 编译器包一层。这里是直接读源码文本，用正则切掉 import，塞进 VM 沙箱跑
- 这样可以直接执行 `submitCommand()` 这种方法，断言 `commandState.value` 这种 ref 的变化
- `onBeforeRouteLeave`、`watch` 等 Vue 生命周期用 mock 函数收集调用参数，然后手动触发验证

### 4.6 范式五：路由/菜单拼接逻辑测试

适用场景：动态菜单 → 路由表转换、隐藏路由处理、菜单组件路径解析。

参考：`ruoyi-ui/tests/navigation-routes.test.mjs`

```mjs
import { createRouter, createMemoryHistory } from 'vue-router';
import { createRouteSources } from '../src/stores/navigationRoutes.mjs';

test('订单页面权限路由补齐隐藏的新建、编辑和详情且不进入导航', () => {
    const remote = [{ path: '/orders', children: [
        { path: 'index', name: 'PropOrderList', component: 'prop/order/index' }
    ]}];
    const expanded = appendPageInternalRoutes(remote);
    assert.deepEqual(expanded[0].children.map(r => r.name), [
        'PropOrderList', 'PropOrderNew', 'PropOrderEdit', 'PropOrderDetail'
    ]);
    assert.equal(navigationRoutes[0].children.length, 1); // 导航只显示列表
});
```

**要点**：
- `vue-router createMemoryHistory` + 复制路由对象，不需要真实 DOM
- 断言 `registrationRoutes`（注册用，含隐藏路由）和 `navigationRoutes`（菜单用，不含隐藏路由）的差异

---

## 5. 通用规则

### 5.1 命名

| 项 | 格式 | 示例 |
|---|---|---|
| 后端测试类 | `{被测类}Test` | `PropCustomerServiceImplTest` |
| 后端测试方法 | `{行为}_{条件或边界}` 或中文描述性名称 | `allocationLocksSharedSequenceAndUsesCurrentMaximum` |
| 前端测试文件 | `{模块}.test.mjs` | `customer-presentation.test.mjs` |
| 前端测试描述 | 中文、陈述事实 | `late list responses cannot overwrite new results` |

后端现有混合了 `camelCase` 方法名和中文描述名，**建议统一用英文 camelCase 方法名**，方法名本身就是行为说明。

### 5.2 夹具与数据构造

- 后端：在测试类内用 private 方法构造 Fixture 对象，不要写独立工厂类。参考 `PropCustomerServiceImplTest.company()`、`address()` 方法
- 前端：`sfc()` 函数已经是固定夹具；API mock 统一在 `imports` 对象里提供
- **不要写 `@BeforeEach` 构造真实数据库数据**

### 5.3 禁止事项

- **不要**为了跑单测去启动完整 Spring Boot 或 Docker 容器
- **不要**为了单测写 Testcontainers 或 `@SpringBootTest` 集成测试——那是另一个量级的工作
- **不要**引入 Jest / Vitest / jsdom / Vue Test Utils 新框架——现有范式足够
- **不要**写只断言 `not throw` 的空测试——必须有具体断言
- **不要**在测试里依赖时区、货币符号、平台路径分隔符等环境相关值（除非专门测试时区切换，如 `business-time.test.mjs` 的 `spawnSync` 换 TZ）
- **不要**用 `Thread.sleep` 等待异步——用 `await Promise.resolve()`、`queue[0].resolve()` 手动控制

### 5.4 运行命令

```powershell
# 后端：跑 ruoyi-prop 模块测试
mvn --no-transfer-progress -pl ruoyi-prop test

# 后端：跑 ruoyi-admin 模块测试（会带上 ruoyi-prop）
mvn --no-transfer-progress -pl ruoyi-admin -am test

# 前端：在 ruoyi-ui/ 下
npm run --silent test
```

### 5.5 何时补充新单测

1. **修改 BR 清单里标注的负向行为**（如去掉乐观锁、增加唯一性检查）——必须加测试
2. **新增 Service 方法**——至少加"正常路径"和"非法输入不写入"两条
3. **改了 MyBatis XML 的 ORDER BY / WHERE 拼接**——直接加 XML 契约测试
4. **改了 PDF / Excel 模板的排版逻辑**——真实输出测试必须跟上
5. **改了前端页面的防重复提交 / stale response 处理**——编译 SFC 测竞态
6. **改了工具函数**——直接 import 测输入输出

---

## 6. 测试 vs 运行时验证 边界

| | 单元测试 | auto-explore Playwright 运行时验证 |
|---|---|---|
| 谁写 | 开发在写代码时同步补充 | 运行时脚本逐条执行 V5 用例 |
| 能验证什么 | 纯逻辑、Mock 下的调用顺序、不启动容器的输出 | 真实 DB、真实 API、真实 UI、真实交互 |
| 不能验证什么 | 事务实际回滚、并发锁、Redis、文件存储、样式 | 具体业务规则内部的调用顺序和参数构造 |
| 运行成本 | 低（秒级） | 高（浏览器 + 前后端 + 数据库） |
| 回归定位 | 精确到方法级别 | 需要看 trace 截图 |

两者互补，不互相替代。`auto-explore` 的 verify 脚本**不依赖**单元测试，独立运行。

---

## 附录：现有测试文件与范式对应

| 文件 | 所属模块 | 使用范式 |
|---|---|---|
| `ruoyi-prop/.../ReceptionRulesTest.java` | 受付 | 范式一：纯规则 |
| `ruoyi-prop/.../PropCustomerServiceImplTest.java` | 客户 | 范式二：Service Mock |
| `ruoyi-prop/.../PropOrderServiceImplTest.java` | 订单 | 范式二：Service Mock + mockStatic 时间 |
| `ruoyi-prop/.../PropCustomerMapperOrderingTest.java` | 客户 | 范式三：XML 契约 |
| `ruoyi-admin/.../PropCustomerControllerPagingTest.java` | 客户 | 范式四：MockMvc |
| `ruoyi-prop/.../InspectionReportRendererTest.java` | 检查报告 | 范式五：真实 PDF 输出 |
| `ruoyi-ui/tests/business-time.test.mjs` | 前端 utils | 范式一：纯函数 + spawnSync 换 TZ |
| `ruoyi-ui/tests/customer-presentation.test.mjs` | 前端客户页 | 范式二 + 范式三 + 范式四 |
| `ruoyi-ui/tests/prop-order-command-state.test.mjs` | 前端订单页 | 范式五：vm 沙箱执行 |
| `ruoyi-ui/tests/navigation-routes.test.mjs` | 前端路由 | 范式五 + vue-router createMemoryHistory |
