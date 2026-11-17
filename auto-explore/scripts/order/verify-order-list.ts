/**
 * 订单管理·列表查询方向运行时验证
 * 来源：用例 订单列表查询-001~015；高风险冲突 订单列表查询-006（关键词搜索产品名称/颜色，BR-001）
 * 方法：DB 幂等种数（3 笔 AUTO 订单）+ 真实 UI 查询 + list 接口请求/响应捕获
 * 测试数据：AUTO-ORD-KW1(sale/direct/active,受注10-20,预计10-30,行 一命多助/AUTO-紫色×2)
 *           AUTO-ORD-KW2(rental/agency/active,受注10-21,预计NULL)
 *           AUTO-ORD-KW3(cancelled,受注10-22)
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

interface OrderRow { orderId?: number; orderNo?: string; customerOrderNo?: string | null; totalQuantity?: number; fulfilledQuantity?: number; }

const KW1 = { gen: "I26T001", co: "AUTO-CO-001", ordering: "AUTO-下单方甲", recipient: "AUTO-收货方乙", color: "AUTO-紫色" };
const KW2 = { gen: "R26T001", co: "AUTO-CO-002", ordering: "AUTO-下单方丙", color: "AUTO-绿色" };
const KW3 = { gen: "I26T002", co: "AUTO-CO-003", ordering: "AUTO-下单方丁", color: "AUTO-红色" };

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-order-list" });
  const page = session.page;
  const api500: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/prop/order/list")) console.log("[req]", r.url()); });
  page.on("response", (r) => { if (r.status() >= 500) api500.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  try {
    // ---- 幂等种数 ----
    const snapshotOf = (name: string, subjectId: number, customerNo: string, subjectType: string, companyId: number | null, companyName: string | null) =>
      JSON.stringify({ subjectId, subjectType, customerNo, name, companyId, companyName, customerType: "direct" });
    const addrSnapshot = JSON.stringify({ addressId: 1, subjectId: 1, postalCode: "1111111", addressLine1: "AUTO-配送地址1", addressLine2: null });
    const contactSnapshot = JSON.stringify({ contactId: 1, addressId: 1, contactName: "AUTO-联系人", jobTitle: null, phone: null, fax: null, email: null, note: null });
    const seedOrder = async (co: string, gen: string, type: string, ctype: string, status: string, orderDate: string, expected: string | null, ordering: string, recipient: string, color: string, qty: number) => {
      const exist = await db.snapshot("chk", "SELECT order_id FROM prop_order WHERE customer_order_no=?", [co]);
      if (exist.rows.length) return;
      const ins: any = await db.snapshot("seed", `INSERT INTO prop_order
        (order_no, generated_no, customer_order_no, order_date, expected_ship_date, order_type, customer_type, order_status,
         ordering_party_id, ordering_party_snapshot, recipient_id, recipient_snapshot, billing_party_id, billing_party_snapshot,
         delivery_address_id, delivery_address_snapshot, delivery_contact_id, delivery_contact_snapshot,
         cancel_reason, cancelled_by, cancelled_time, create_by, create_time)
        VALUES (?,?,?,?,?,?,?,?, 1,?, 2,?, 1,?, 1,?, 1,?, ?,?,?, 'admin', NOW())`, [
        gen, gen, co, orderDate, expected, type, ctype, status,
        snapshotOf(ordering, 1, "C00001", "company", null, null),
        snapshotOf(recipient, 2, "C00002", "site", 1, "测试公司1"),
        snapshotOf(ordering, 1, "C00001", "company", null, null),
        addrSnapshot, contactSnapshot,
        status === "cancelled" ? "AUTO-测试取消" : null,
        status === "cancelled" ? "admin" : null,
        status === "cancelled" ? new Date() : null,
      ]);
      const orderId = Number(ins.rows.insertId);
      await db.snapshot("seed-line", "INSERT INTO prop_order_line (order_id, sort_order, product_name_id, product_name, color_note, quantity, create_by, create_time) VALUES (?,0,2,'一命多助',?,?,'admin',NOW())", [orderId, color, qty]);
      console.log(`[seed] order ${co} (${gen}) id=${orderId}`);
    };
    await seedOrder(KW1.co, KW1.gen, "sale", "direct", "active", "2026-10-20", "2026-10-30", KW1.ordering, KW1.recipient, KW1.color, 2);
    await seedOrder(KW2.co, KW2.gen, "rental", "agency", "active", "2026-10-21", null, KW2.ordering, KW2.ordering, KW2.color, 1);
    await seedOrder(KW3.co, KW3.gen, "sale", "direct", "cancelled", "2026-10-22", null, KW3.ordering, KW3.ordering, KW3.color, 1);

    await login(page);
    const waitList = () => page.waitForResponse((r) => r.url().includes("/prop/order/list") && r.request().method() === "GET", { timeout: 12000 });
    const listNos = (body: { rows?: OrderRow[] }) => (body.rows || []).map((r) => String(r.orderNo));
    const field = (label: string) => page.locator(".search-field", { has: page.locator(".search-label-text", { hasText: label }) });
    const selectOption = async (label: string, option: string) => {
      await field(label).locator(".ant-select").click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: option }).first().click();
    };
    const searchWith = async (fn: () => Promise<void>) => {
      const p = waitList();
      await fn();
      await page.locator(".search-actions button", { hasText: "検索" }).first().click();
      const resp = await p;
      const body = JSON.parse(await resp.text());
      await page.waitForTimeout(500);
      return { url: decodeURIComponent(resp.request().url()), body, nos: listNos(body) };
    };

    // ---- 1. 默认加载（用例-001）----
    let respPromise = waitList();
    await page.goto("/orders/index");
    let resp = await respPromise;
    const defaultBody = JSON.parse(await resp.text());
    console.log("[list] default total:", defaultBody.total, "rows:", listNos(defaultBody).join(","), "| pageSize<=10:", (defaultBody.rows || []).length <= 10);
    await page.waitForTimeout(800);

    // ---- 2~5. 关键词四项命中（用例-002/003/004/005）----
    const kwInput = () => page.getByPlaceholder("注文管理番号／お客様注文番号／注文先／納品先");
    const kwOrderNo = await searchWith(async () => kwInput().fill(KW1.gen));
    console.log("[kw] orderNo ->", kwOrderNo.nos.join(","));
    const kwCo = await searchWith(async () => kwInput().fill(KW1.co));
    console.log("[kw] customerOrderNo ->", kwCo.nos.join(","));
    const kwOrdering = await searchWith(async () => kwInput().fill(KW1.ordering));
    console.log("[kw] orderingName ->", kwOrdering.nos.join(","));
    const kwRecipient = await searchWith(async () => kwInput().fill(KW1.recipient));
    console.log("[kw] recipientName ->", kwRecipient.nos.join(","));

    // ---- 6. 冲突复验（用例-006）：关键词搜产品颜色/名称 ----
    const kwColor = await searchWith(async () => kwInput().fill(KW1.color));
    console.log("[kw] color AUTO-紫色 ->", kwColor.nos.join(","), "total:", kwColor.body.total);
    const kwProdName = await searchWith(async () => kwInput().fill("一命多助"));
    console.log("[kw] productName 一命多助 ->", kwProdName.nos.join(","), "total:", kwProdName.body.total);

    // ---- 7. 制造番号反查（用例-007）----
    await kwInput().fill("");
    const kwMno = await searchWith(async () => page.getByPlaceholder("製造番号を入力").fill("111"));
    console.log("[mno] 111 ->", kwMno.nos.join(","));
    await page.getByPlaceholder("製造番号を入力").fill("");

    // ---- 8. 类型筛选（用例-008）----
    const typeSale = await searchWith(async () => selectOption("注文種別", "販売"));
    console.log("[type] sale ->", typeSale.nos.join(","));
    const typeRental = await searchWith(async () => selectOption("注文種別", "レンタル"));
    console.log("[type] rental ->", typeRental.nos.join(","));
    await field("注文種別").locator(".ant-select").hover();
    await field("注文種別").locator(".ant-select-clear").click();

    // ---- 9. 客户区分（用例-009）----
    const ctypeAgency = await searchWith(async () => selectOption("顧客区分", "代理店"));
    console.log("[ctype] agency ->", ctypeAgency.nos.join(","));
    await field("顧客区分").locator(".ant-select").hover();
    await field("顧客区分").locator(".ant-select-clear").click();

    // ---- 10. 履约三态（用例-010）----
    const fulUnshipped = await searchWith(async () => selectOption("出荷状況", "未出荷"));
    console.log("[ful] unshipped ->", fulUnshipped.nos.join(","));
    const fulCompleted = await searchWith(async () => selectOption("出荷状況", "完了"));
    console.log("[ful] completed ->", fulCompleted.nos.join(","));
    await field("出荷状況").locator(".ant-select").hover();
    await field("出荷状況").locator(".ant-select-clear").click();

    // ---- 11. 状态筛选（用例-011）----
    const stCancelled = await searchWith(async () => selectOption("注文状態", "キャンセル"));
    console.log("[status] cancelled ->", stCancelled.nos.join(","));
    await field("注文状態").locator(".ant-select").hover();
    await field("注文状態").locator(".ant-select-clear").click();

    // ---- 12. 受注日范围含边界（用例-012）----
    const fillRange = async (label: string, from: string, to: string) => {
      const picker = field(label).locator(".ant-picker");
      await picker.locator("input").first().click();
      await picker.locator("input").first().fill(from);
      await page.keyboard.press("Enter");
      await picker.locator("input").nth(1).fill(to);
      await page.keyboard.press("Enter");
    };
    const dateRange = await searchWith(async () => fillRange("受注日", "2026-10-20", "2026-10-21"));
    console.log("[date] orderDate 10-20~10-21 ->", dateRange.nos.join(","), "url:", dateRange.url);
    await field("受注日").locator(".ant-picker").hover();
    const clearBtn = field("受注日").locator(".ant-picker-clear");
    if (await clearBtn.isVisible().catch(() => false)) await clearBtn.click();

    // ---- 13. 预计发货日范围排除 NULL（用例-013，BR-005）----
    const expRange = await searchWith(async () => fillRange("発送予定日", "2026-10-29", "2026-10-31"));
    console.log("[date] expected 10-29~10-31 ->", expRange.nos.join(","), "url:", expRange.url);

    // ---- 14. 重置（用例-014）----
    respPromise = waitList();
    await page.locator(".search-actions button", { hasText: "リセット" }).first().click();
    resp = await respPromise;
    const resetUrl = decodeURIComponent(resp.request().url());
    const kwVal = await kwInput().inputValue();
    console.log("[reset] url:", resetUrl, "| keyword input:", JSON.stringify(kwVal));

    // ---- 15. 查询空态（用例-015 部分：有条件空态）----
    const emptyKw = await searchWith(async () => kwInput().fill("ZZZ-NO-MATCH"));
    const emptyText = await page.locator(".ant-empty").last().innerText().catch(() => "(无空态)");
    console.log("[empty] total:", emptyKw.body.total, "empty text:", JSON.stringify(emptyText));

    console.log("---- VERDICT ----");
    console.log((defaultBody.rows || []).length <= 10 && defaultBody.total >= 8
      ? `PASS 用例-001：默认每页 10 条并显示总数（total=${defaultBody.total}）。`
      : `CHECK 用例-001：total=${defaultBody.total} rows=${(defaultBody.rows || []).length}`);
    console.log(kwOrderNo.nos.includes(KW1.gen) ? "PASS 用例-002：关键词命中注文管理番号。" : `CHECK 用例-002：${kwOrderNo.nos.join(",")}`);
    console.log(kwCo.nos.includes(KW1.gen) ? "PASS 用例-003：关键词命中客户订单号。" : `CHECK 用例-003：${kwCo.nos.join(",")}`);
    console.log(kwOrdering.nos.includes(KW1.gen) ? "PASS 用例-004：关键词命中下单方快照名。" : `CHECK 用例-004：${kwOrdering.nos.join(",")}`);
    console.log(kwRecipient.nos.includes(KW1.gen) ? "PASS 用例-005：关键词命中納品先快照名。" : `CHECK 用例-005：${kwRecipient.nos.join(",")}`);
    console.log(!kwColor.nos.includes(KW1.gen) && Number(kwColor.body.total) === 0
      ? "冲突确认 用例-006：关键词搜产品颜色（AUTO-紫色）0 命中——代码关键词不含颜色（BR-001），与用例预期相反。"
      : `CHECK 用例-006(颜色)：命中=${kwColor.nos.join(",")}`);
    console.log(Number(kwProdName.body.total) === 0
      ? "冲突确认 用例-006：关键词搜产品名称（一命多助）0 命中——代码关键词不含产品名称（BR-001），与用例预期相反。"
      : `CHECK 用例-006(名称)：命中=${kwProdName.nos.join(",")}`);
    console.log(kwMno.nos.includes("I261001") ? "PASS 用例-007：制造番号 111 反查命中订单 I261001。" : `CHECK 用例-007：${kwMno.nos.join(",")}`);
    console.log(typeSale.nos.includes(KW1.gen) && !typeSale.nos.includes(KW2.gen) ? "PASS 用例-008：类型=sale 精确匹配。" : `CHECK 用例-008：${typeSale.nos.join(",")}`);
    console.log(typeRental.nos.includes(KW2.gen) && !typeRental.nos.includes(KW1.gen) ? "PASS 用例-008b：类型=rental 精确匹配。" : `CHECK 用例-008b：${typeRental.nos.join(",")}`);
    console.log(ctypeAgency.nos.includes(KW2.gen) && !ctypeAgency.nos.includes(KW1.gen) ? "PASS 用例-009：客户区分=agency 精确匹配。" : `CHECK 用例-009：${ctypeAgency.nos.join(",")}`);
    console.log(fulUnshipped.nos.includes(KW1.gen) && fulUnshipped.nos.includes(KW2.gen) && !fulUnshipped.nos.includes("I261001") ? "PASS 用例-010：履约=未出货命中未履约订单，排除已发足订单。" : `CHECK 用例-010：${fulUnshipped.nos.join(",")}`);
    console.log(fulCompleted.nos.includes("I261001") && !fulCompleted.nos.includes(KW1.gen) ? "PASS 用例-010b：履约=已发足命中 I261001。" : `CHECK 用例-010b：${fulCompleted.nos.join(",")}`);
    console.log(stCancelled.nos.includes(KW3.gen) && !stCancelled.nos.includes(KW1.gen) ? "PASS 用例-011：状态=已取消精确匹配。" : `CHECK 用例-011：${stCancelled.nos.join(",")}`);
    console.log(dateRange.nos.includes(KW1.gen) && dateRange.nos.includes(KW2.gen) && !dateRange.nos.includes("I261001") && !dateRange.nos.includes(KW3.gen)
      ? "PASS 用例-012：受注日 10-20~10-21 含边界命中 KW1/KW2。"
      : `CHECK 用例-012：${dateRange.nos.join(",")}`);
    console.log(expRange.nos.includes(KW1.gen) && !expRange.nos.includes(KW2.gen)
      ? "PASS 用例-013：预计发货日范围命中 KW1，KW2（未填）被排除（BR-005）。"
      : `CHECK 用例-013：${expRange.nos.join(",")}`);
    console.log(!kwVal && /keyword=&/.test(resetUrl) && !resetUrl.includes("expectedDateFrom") && !resetUrl.includes("orderType=")
      ? "PASS 用例-014：重置清空全部条件并重新查询。"
      : `CHECK 用例-014：keyword=${kwVal} url=${resetUrl}`);
    console.log(Number(emptyKw.body.total) === 0 && String(emptyText).includes("データがありません")
      ? "PASS 用例-015(部分)：有条件空态文案正确；默认空态（无任何订单）受环境限制未验证。"
      : `CHECK 用例-015：total=${emptyKw.body.total} text=${JSON.stringify(emptyText)}`);
    console.log(api500.length ? `API-5xx 巡检命中：${api500.join(" ; ")}` : "API-5xx 巡检：列表方向无 5xx。");
  } finally {
    const tracePath = await closeSession(session, "verify-order-list");
    console.log("[list] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[list] FAILED:", e.message); process.exit(1); });
