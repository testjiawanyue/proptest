/**
 * 产品生产-衣体入库主流程验证 + REQ-025 PARTIAL 运行时取证
 * 覆盖：单个/范围加入、去重拦截、已有档案红色标记与跳过、确认入库三件事+批次+事件、
 *      入库记录无查询入口（REQ-025 PARTIAL）、M番号界面不显示
 * 数据：资料 AUTO-并发验证部件（profile_id=10，无前缀），编号 AUTO-J001~004；已有编号 PTG1
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function readToasts(page: import("playwright").Page): Promise<string> {
  return page.locator(".ant-message span").allInnerTexts().then((t) => t.join(" | ")).catch(() => "");
}

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-prod-intake" });
  const page = session.page;
  try {
    const seqBefore = await db.snapshot("seq", "SELECT next_value FROM prop_product_sequence WHERE sequence_id=1");
    console.log("[intake] m sequence before:", JSON.stringify(seqBefore.rows));

    await login(page);
    await page.goto("/production/intake");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(800);

    // 1. 选择衣体资料（无前缀的 AUTO-并发验证部件）
    await page.locator(".profile-area .ant-select").first().click();
    await page.locator(".ant-select-item-option", { hasText: "AUTO-并发验证部件" }).first().click();
    await page.waitForTimeout(500);
    const summary = await page.locator(".profile-summary").innerText().catch(() => "");
    console.log("[intake] profile summary:", summary.replace(/\n/g, " "));

    // 2. 单个编号加入 AUTO-J001
    const single = page.getByPlaceholder("例：PTG26004");
    await single.fill("AUTO-J001");
    await single.press("Enter");
    await page.waitForTimeout(800);
    let header = await page.locator(".candidate-panel h2").innerText();
    console.log("[intake] after single add:", header);

    // 3. 重复加入 → 前端去重拦截
    await single.fill("AUTO-J001");
    await single.press("Enter");
    await page.waitForTimeout(600);
    console.log("[intake] dup toast:", await readToasts(page));

    // 4. 加入已有编号 PTG1 → 红色「已有档案」
    await single.fill("PTG1");
    await single.press("Enter");
    await page.waitForTimeout(1000);
    const ptg1Tag = await page.locator(".candidate-panel tr", { hasText: "PTG1" }).locator(".ant-tag").innerText().catch(() => "(none)");
    console.log("[intake] PTG1 tag:", ptg1Tag);

    // 5. 连续范围 AUTO-J 002~004（001 已在清单，应仅新增 002~004）
    await page.locator(".ant-tabs-tab", { hasText: "连续范围" }).click();
    await page.getByPlaceholder("可留空").fill("AUTO-J");
    await page.getByPlaceholder("001").fill("002");
    await page.getByPlaceholder("005").fill("004");
    await page.getByRole("button", { name: /加\s*入/ }).click();
    await page.waitForTimeout(1500);
    header = await page.locator(".candidate-panel h2").innerText();
    console.log("[intake] after range add:", header);

    // 6. 确认全部入库
    const intakeResp = page.waitForResponse(
      (r) => r.url().includes("/prop/production/intake") && r.request().method() === "POST" && !r.url().includes("range") && !r.url().includes("check"),
      { timeout: 30000 },
    );
    await page.getByRole("button", { name: "确认全部入库" }).click();
    const modal = page.locator(".ant-modal-confirm");
    await modal.waitFor({ state: "visible", timeout: 5000 });
    console.log("[intake] confirm modal:", (await modal.innerText()).replace(/\n/g, " "));
    await modal.getByRole("button", { name: "确认入库" }).click();
    const resp = await intakeResp;
    console.log("[intake] intake api:", resp.status(), (await resp.text()).slice(0, 300));
    await page.waitForTimeout(1500);
    console.log("[intake] result toast:", await readToasts(page));
    header = await page.locator(".candidate-panel h2").innerText();
    console.log("[intake] header after submit:", header);

    // 7. DB 验证三件事 + 批次 + 事件
    const parts = await db.snapshot("parts", "SELECT part_id, part_no, part_type, source_type, current_profile_id FROM prop_part_item WHERE active_part_no LIKE 'AUTO-J00%' ORDER BY part_no");
    console.log("[intake] db parts:", JSON.stringify(parts.rows));
    const products = await db.snapshot("products", "SELECT product_id, manufacturing_no, m_no FROM prop_product WHERE active_manufacturing_no LIKE 'AUTO-J00%' ORDER BY manufacturing_no");
    console.log("[intake] db products:", JSON.stringify(products.rows));
    const bindings = await db.snapshot("bindings", `SELECT b.slot_type, p.manufacturing_no FROM prop_product_binding b JOIN prop_product p ON b.product_id=p.product_id WHERE p.active_manufacturing_no LIKE 'AUTO-J00%' AND b.ended_time IS NULL ORDER BY p.manufacturing_no`);
    console.log("[intake] db bindings:", JSON.stringify(bindings.rows));
    const batch = await db.snapshot("batch", "SELECT batch_id, total_count, success_count, skip_count, failure_count, profile_id FROM prop_intake_batch ORDER BY batch_id DESC LIMIT 1");
    console.log("[intake] db batch:", JSON.stringify(batch.rows));
    const items = await db.snapshot("items", "SELECT COUNT(*) cnt FROM prop_intake_item WHERE batch_id = (SELECT MAX(batch_id) FROM prop_intake_batch)");
    console.log("[intake] db batch items:", JSON.stringify(items.rows));
    const events = await db.snapshot("events", `SELECT event_type, COUNT(*) cnt FROM prop_production_event WHERE product_id IN (SELECT product_id FROM prop_product WHERE active_manufacturing_no LIKE 'AUTO-J00%') GROUP BY event_type`);
    console.log("[intake] db events:", JSON.stringify(events.rows));
    const seqAfter = await db.snapshot("seq2", "SELECT next_value FROM prop_product_sequence WHERE sequence_id=1");
    console.log("[intake] m sequence after:", JSON.stringify(seqAfter.rows));

    // 8. REQ-025 PARTIAL：入库记录查询入口是否存在（菜单 + 三个页面文本）
    await page.goto("/production/assembly");
    await page.waitForTimeout(1200);
    const menuText = await page.locator("aside, .sidebar-container, .el-menu, .app-sidebar").first().innerText().catch(() => "");
    const bodyText = await page.locator("body").innerText();
    const menuHasIntakeRecord = /入库记录|入库批次| intake batch/i.test(menuText) || /入库记录|入库批次/.test(bodyText);
    const mNoDisplayed = /M\d{6}/.test(bodyText);
    console.log("[intake] menu/page mentions 入库记录:", menuHasIntakeRecord, "; page displays M番号 pattern:", mNoDisplayed);

    console.log("---- VERDICT ----");
    const okFlow = parts.rows.length === 4 && products.rows.length === 4 && bindings.rows.length === 4
      && Number((batch.rows[0] as Record<string, unknown>)?.success_count) === 4
      && Number((batch.rows[0] as Record<string, unknown>)?.skip_count) === 1;
    console.log(okFlow
      ? "PASS: 衣体入库三件事+批次+跳过行为全部落库正确（成功4/跳过1）。"
      : "FAIL/UNCONFIRMED: 主流程落库与预期不符，需查看 Trace。");
    console.log(!menuHasIntakeRecord
      ? "REQ-025 PARTIAL 运行时确认：界面无入库记录查询入口（批次只写不读）。"
      : "REQ-025 注意：界面出现入库记录相关入口，静态结论需修正。");
    console.log(!mNoDisplayed
      ? "M番号界面不显示：运行时确认（页面无 M+6位 模式文本）。"
      : "M番号疑似在界面显示，需人工复核。");
  } finally {
    const tracePath = await closeSession(session, "verify-prod-intake");
    console.log("[intake] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[intake] FAILED:", e.message); process.exit(1); });
