/**
 * 产品管理·删除产品运行时验证
 * 来源：用例 产品删除-001~008（阻断四项/一次性列出/取消/成功后历史保留）
 * 测试数据：AUTO-J002(阻断：非衣体绑定+质检)；AUTO-DEL01(裸产品,删除成功用,幂等种入)
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-delete" });
  const page = session.page;
  const api500: string[] = [];
  page.on("response", (r) => { if (r.status() >= 500) api500.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  const results: string[] = [];
  try {
    // ---- 幂等种裸产品 AUTO-DEL01（无绑定/质检/发货/受付）----
    const exist = await db.snapshot("chk", "SELECT product_id FROM prop_product WHERE manufacturing_no=\x27AUTO-DEL01\x27 AND deleted_time IS NULL");
    if (!exist.rows.length) {
      await db.snapshot("seed", "INSERT INTO prop_product (manufacturing_no, active_manufacturing_no, m_no, create_by, create_time) VALUES (\x27AUTO-DEL01\x27,\x27AUTO-DEL01\x27,\x27MDEL1\x27,\x27admin\x27,NOW())");
      console.log("[seed] product AUTO-DEL01 created");
    }

    await login(page);
    const waitList = () => page.waitForResponse((r) => r.url().includes("/prop/production/product-list") && r.request().method() === "GET", { timeout: 12000 });
    let respPromise = waitList();
    await page.goto("/products/list");
    await respPromise;
    await page.waitForTimeout(1000);

    // ---- 1. 阻断一次性列出（用例-002/006/007）----
    await page.getByPlaceholder("前缀").fill("AUTO-J0");
    await page.getByPlaceholder("起始").fill("02");
    await page.getByPlaceholder("结束").fill("02");
    respPromise = waitList();
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await respPromise;
    await page.waitForTimeout(800);
    const j002Row = page.locator(".ant-table-row", { hasText: "AUTO-J002" });
    const blockersPromise = page.waitForResponse((r) => r.url().includes("/delete-blockers") && r.request().method() === "GET", { timeout: 10000 });
    await j002Row.getByRole("button", { name: "···" }).click();
    await page.locator(".ant-dropdown-menu-item", { hasText: "删除产品" }).click();
    const blockersResp = await blockersPromise;
    const blockersBody = JSON.parse(await blockersResp.text());
    console.log("[blocker] API:", blockersResp.status(), JSON.stringify(blockersBody));
    await page.waitForTimeout(500);
    const errModal = await page.locator(".ant-modal-confirm, .ant-modal").last().innerText();
    console.log("[blocker] 弹窗:", JSON.stringify(errModal.replace(/\n/g, "|")));
    const bothListed = errModal.includes("部件") && errModal.includes("质检");
    results.push(bothListed
      ? `PASS 用例-002/006/007：阻断弹窗一次性列出全部命中原因（${JSON.stringify(blockersBody.data)}）。`
      : `CHECK 阻断弹窗：${JSON.stringify(errModal)}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const j002Kept = await db.snapshot("k", "SELECT deleted_time FROM prop_product WHERE product_id=7");
    console.log("[blocker] J002 数据保留:", JSON.stringify(j002Kept.rows));

    // ---- 2. 取消删除（用例-005）----
    // AUTO-DEL01 为在制裸产品，需先清除生产阶段筛选
    await page.locator(".filters .ant-select").nth(0).hover();
    await page.locator(".filters .ant-select").nth(0).locator(".ant-select-clear").click();
    await page.waitForTimeout(300);
    await page.getByPlaceholder("前缀").fill("AUTO-DEL");
    await page.getByPlaceholder("起始").fill("01");
    await page.getByPlaceholder("结束").fill("01");
    respPromise = waitList();
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await respPromise;
    await page.waitForTimeout(800);
    const delRow = page.locator(".ant-table-row", { hasText: "AUTO-DEL01" });
    console.log("[delete] AUTO-DEL01 行数:", await delRow.count());
    await delRow.getByRole("button", { name: "···" }).click();
    await page.locator(".ant-dropdown-menu-item", { hasText: "删除产品" }).click();
    await page.waitForTimeout(600);
    const confirmModal = page.locator(".ant-modal-confirm");
    const confirmText = await confirmModal.innerText();
    console.log("[delete] 确认弹窗文案:", JSON.stringify(confirmText.replace(/\n/g, "|")));
    await confirmModal.getByRole("button", { name: /取\s*消/ }).click();
    await page.waitForTimeout(600);
    const keptAfterCancel = await db.snapshot("kc", "SELECT deleted_time FROM prop_product WHERE manufacturing_no=\x27AUTO-DEL01\x27");
    results.push((keptAfterCancel.rows[0] as Record<string, unknown>).deleted_time === null
      ? "PASS 用例-005：取消删除数据保留。"
      : "CHECK 用例-005：取消后数据异常");

    // ---- 3. 确认删除成功（用例-001/008）----
    await delRow.getByRole("button", { name: "···" }).click();
    await page.locator(".ant-dropdown-menu-item", { hasText: "删除产品" }).click();
    await page.waitForTimeout(500);
    const delPromise = page.waitForResponse((r) => /\/prop\/production\/products\/\d+$/.test(r.url()) && r.request().method() === "DELETE", { timeout: 10000 });
    await page.locator(".ant-modal-confirm").getByRole("button", { name: /确认删除/ }).click();
    const delResp = await delPromise;
    console.log("[delete] DELETE:", delResp.status(), (await delResp.text()).slice(0, 150));
    await page.waitForTimeout(1000);
    const afterDel = await db.snapshot("ad", "SELECT deleted_time, deleted_by, active_manufacturing_no, m_no FROM prop_product WHERE manufacturing_no=\x27AUTO-DEL01\x27");
    console.log("[delete] db after:", JSON.stringify(afterDel.rows));
    const rowGone = (await page.locator(".ant-table-row", { hasText: "AUTO-DEL01" }).count()) === 0;
    console.log("[delete] 列表行消失:", rowGone);
    const delId = (await db.snapshot("id", "SELECT product_id FROM prop_product WHERE manufacturing_no=\x27AUTO-DEL01\x27")).rows[0] as Record<string, unknown>;
    await page.goto(`/products/${delId.product_id}`);
    await page.waitForTimeout(2000);
    const detailAfter = await page.locator(".detail-state").innerText().catch(() => "(无)");
    console.log("[delete] 删除后详情访问:", JSON.stringify(detailAfter.replace(/\n/g, "|")));
    const delOk = (afterDel.rows[0] as Record<string, unknown>).deleted_time !== null;
    results.push(delOk && rowGone && detailAfter.includes("产品不存在")
      ? "PASS 用例-001/权限-005：删除后退出有效列表，详情提示产品不存在（active 编号已释放:" + String((afterDel.rows[0] as Record<string, unknown>).active_manufacturing_no) + "）。"
      : `CHECK 删除结果：db=${JSON.stringify(afterDel.rows)} gone=${rowGone} detail=${detailAfter}`);

    console.log("---- VERDICT ----");
    results.forEach((r) => console.log(r));
    console.log(api500.length ? `API-5xx 巡检命中：${api500.join(" ; ")}` : "API-5xx 巡检：删除方向无 5xx。");
  } finally {
    const tracePath = await closeSession(session, "verify-product-delete");
    console.log("[delete] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[delete] FAILED:", e.message); process.exit(1); });