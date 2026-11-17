/**
 * 订单列表查询-015 单条补跑脚本。
 */
import { ResultBook, DbClient, launchAdminSession, finishSession, compactText } from "./order-runtime-utils.js";
const book = new ResultBook("reports/order-runtime-results-A-015.json");
const db = new DbClient();
await db.connect();
const { browser, session } = await launchAdminSession("verify-order-A-015");
const page = session.page;
try {
  await book.run("订单列表查询-015", "查询无匹配结果", "FEAT-10-order §列表查询", async () => {
    await page.goto("/orders/index");
    const keyword = page.getByPlaceholder("注文管理番号／お客様注文番号／注文先／納品先");
    await keyword.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1800);
    const responsePromise = page.waitForResponse(
      (r) => r.url().includes("/prop/order/list") && r.request().method() === "GET" && r.url().includes("keyword=ZZZ-NO-MATCH-ORDER-A"),
      { timeout: 15000 },
    );
    await keyword.fill("ZZZ-NO-MATCH-ORDER-A");
    await page.locator(".search-actions button", { hasText: "検索" }).first().click();
    const response = await responsePromise;
    const body = await response.json() as { total?: number; rows?: unknown[] };
    await page.waitForTimeout(700);
    const emptyText = compactText(await page.locator(".ant-empty").last().innerText().catch(() => ""), 300);
    const ok = Number(body.total) === 0 && Array.isArray(body.rows) && body.rows.length === 0 && /データがありません|データなし/.test(emptyText);
    return {
      status: ok ? "通过" : "不通过",
      actual: `关键词无匹配时接口 total=${body.total ?? "?"}、rows=${Array.isArray(body.rows) ? body.rows.length : "?"}；页面空态=${emptyText || "(无)"}。`,
      evidence: "UI /orders/index 输入 ZZZ-NO-MATCH-ORDER-A 后点击検索；捕获关键词查询 GET /prop/order/list 响应与 .ant-empty 文案。",
    };
  });
} finally {
  await finishSession(browser, session, "verify-order-A-015");
  await db.close();
}
