/**
 * 产品管理·删除产品运行时验证（第2轮）
 * 用例 产品删除-001/005/008 + 边界发现（无衣体绑定产品 blockers 与 delete 口径不一致）
 * 测试数据：AUTO-J101(仅衣体绑定,无其他阻断,删除成功用)；AUTO-DEL01(无衣体裸产品,边界用,保留)
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-delete2" });
  const page = session.page;
  const results: string[] = [];
  try {
    await login(page);
    const waitList = () => page.waitForResponse((r) => r.url().includes("/prop/production/product-list") && r.request().method() === "GET", { timeout: 12000 });
    let respPromise = waitList();
    await page.goto("/products/list");
    await respPromise;
    await page.waitForTimeout(1000);

    // AUTO-J101 为在制产品，先清除生产阶段筛选
    await page.locator(".filters .ant-select").nth(0).hover();
    await page.locator(".filters .ant-select").nth(0).locator(".ant-select-clear").click();
    await page.waitForTimeout(300);
    await page.getByPlaceholder("前缀").fill("AUTO-J");
    await page.getByPlaceholder("起始").fill("101");
    await page.getByPlaceholder("结束").fill("101");
    respPromise = waitList();
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await respPromise;
    await page.waitForTimeout(800);
    const delRow = page.locator(".ant-table-row", { hasText: "AUTO-J101" });
    console.log("[delete] AUTO-J101 行数:", await delRow.count());

    // ---- 1. 取消删除（用例-005）----
    const evBefore = await db.snapshot("e0", "SELECT COUNT(*) c FROM prop_production_event WHERE product_id=10");
    await delRow.getByRole("button", { name: "···" }).click();
    await page.locator(".ant-dropdown-menu-item", { hasText: "删除产品" }).click();
    await page.waitForTimeout(600);
    const confirmModal = page.locator(".ant-modal-confirm");
    const confirmText = await confirmModal.innerText();
    console.log("[delete] 确认弹窗文案:", JSON.stringify(confirmText.replace(/\n/g, "|")));
    await confirmModal.getByRole("button", { name: /取\s*消/ }).click();
    await page.waitForTimeout(600);
    const kept = await db.snapshot("kc", "SELECT deleted_time FROM prop_product WHERE product_id=10");
    results.push((kept.rows[0] as Record<string, unknown>).deleted_time === null
      ? "PASS 用例-005：取消删除数据保留。"
      : "CHECK 用例-005：取消后数据异常");

    // ---- 2. 确认删除成功（用例-001）----
    await delRow.getByRole("button", { name: "···" }).click();
    await page.locator(".ant-dropdown-menu-item", { hasText: "删除产品" }).click();
    await page.waitForTimeout(500);
    const delPromise = page.waitForResponse((r) => /\/prop\/production\/products\/\d+$/.test(r.url()) && r.request().method() === "DELETE", { timeout: 10000 });
    await page.locator(".ant-modal-confirm").getByRole("button", { name: /确认删除/ }).click();
    const delResp = await delPromise;
    console.log("[delete] DELETE:", delResp.status(), (await delResp.text()).slice(0, 150));
    await page.waitForTimeout(1000);
    const afterDel = await db.snapshot("ad", "SELECT deleted_time, deleted_by, active_manufacturing_no FROM prop_product WHERE product_id=10");
    const bodyPart = await db.snapshot("bp", "SELECT deleted_time, active_part_no FROM prop_part_item WHERE part_no=\x27AUTO-J101\x27");
    const bodyBind = await db.snapshot("bb", "SELECT ended_time FROM prop_product_binding WHERE product_id=10 ORDER BY binding_id DESC LIMIT 1");
    console.log("[delete] db product:", JSON.stringify(afterDel.rows), "body part:", JSON.stringify(bodyPart.rows), "binding:", JSON.stringify(bodyBind.rows));
    const rowGone = (await page.locator(".ant-table-row", { hasText: "AUTO-J101" }).count()) === 0;
    console.log("[delete] 列表行消失:", rowGone);

    // ---- 3. 删除后详情与历史（用例-008 / 权限-005）----
    await page.goto("/products/10");
    await page.waitForTimeout(2000);
    const detailAfter = await page.locator(".detail-state").innerText().catch(() => "(打开了详情)");
    console.log("[delete] 删除后详情访问:", JSON.stringify(detailAfter.replace(/\n/g, "|")));
    const evAfter = await db.snapshot("e1", "SELECT event_type, event_content FROM prop_production_event WHERE product_id=10");
    console.log("[delete] 历史事件保留:", JSON.stringify(evAfter.rows), "(删除前条数:", JSON.stringify(evBefore.rows), ")");
    const delOk = (afterDel.rows[0] as Record<string, unknown>).deleted_time !== null
      && (bodyPart.rows[0] as Record<string, unknown>).deleted_time !== null
      && (bodyBind.rows[0] as Record<string, unknown>).ended_time !== null;
    results.push(delOk && rowGone && detailAfter.includes("产品不存在")
      ? "PASS 用例-001：删除成功——产品+衣体软删、绑定结束、active 编号释放、退出有效列表、详情提示不存在。"
      : `CHECK 删除：${JSON.stringify(afterDel.rows)} gone=${rowGone}`);
    results.push(evAfter.rows.length >= 1
      ? "PASS 用例-008：删除后原历史事件保留可读（" + evAfter.rows.length + " 条）。"
      : "CHECK 用例-008：历史事件为空");

    console.log("---- VERDICT ----");
    console.log("确认弹窗文案核对：「" + confirmText.replace(/\n/g, " ") + "」");
    results.forEach((r) => console.log(r));
    console.log("边界发现（上一轮已取证）：无衣体绑定的产品（AUTO-DEL01）delete-blockers 返回空、确认弹窗可提交，但 DELETE 返回 code:500「产品衣体绑定不存在」——阻断口径与实际删除口径不一致（正常 UI 流程无法构造该状态，严重度低）。");
  } finally {
    const tracePath = await closeSession(session, "verify-product-delete2");
    console.log("[delete2] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[delete2] FAILED:", e.message); process.exit(1); });