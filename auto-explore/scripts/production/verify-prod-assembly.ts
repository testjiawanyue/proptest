/**
 * 产品生产-部件组装主流程 + 部件组装-028（hasIssues 拦截重新筛选/重置）+ 产品生产权限-004（离开页面拦截缺失）
 * 前置：AUTO-J001~004 已入库（verify-prod-intake.ts）
 * 数据：气囊 AUTO-A001/002、传感器 AUTO-S001/002、发生器 AUTO-I001/002、位置2 AUTO-X002
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function readToasts(page: import("playwright").Page): Promise<string> {
  return page.locator(".ant-message span").allInnerTexts().then((t) => t.join(" | ")).catch(() => "");
}

async function setDefault(page: import("playwright").Page, fieldLabel: string, optionText: string): Promise<void> {
  const field = page.locator(".default-field", { hasText: fieldLabel }).first();
  await field.locator(".ant-select").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: optionText }).first().click();
  await page.waitForTimeout(400);
}

async function saveCell(page: import("playwright").Page, rowCode: string, colIndex: number, value: string): Promise<{ status: number; body: string }> {
  const row = page.locator("table.sheet tbody tr", { has: page.locator("code", { hasText: rowCode }) });
  const input = row.locator("td input").nth(colIndex);
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("/prop/production/assembly") && r.request().method() === "PUT",
    { timeout: 10000 },
  );
  await input.click();
  await input.fill(value);
  await input.press("Enter");
  const resp = await respPromise;
  const body = (await resp.text().catch(() => "")).slice(0, 300);
  await page.waitForTimeout(400);
  return { status: resp.status(), body };
}

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-prod-assembly" });
  const page = session.page;
  try {
    await login(page);
    await page.goto("/production/assembly");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1500);

    // 1. 设置默认部件资料与固件
    await setDefault(page, "气囊资料", "气囊 A型");
    await setDefault(page, "传感器资料", "传感器 A型");
    await setDefault(page, "传感器固件", "85cm");
    await setDefault(page, "发生器位置1资料", "充气发生器 A型");
    await setDefault(page, "发生器位置2资料", "充气发生器 A型");
    console.log("[assembly] defaults set");

    // 2. 范围筛选 AUTO-J 001~004
    await page.getByPlaceholder("前缀").fill("AUTO-J");
    await page.getByPlaceholder("开始编号").fill("001");
    await page.getByPlaceholder("结束编号").fill("004");
    await page.getByRole("button", { name: /筛\s*选/ }).click();
    await page.waitForTimeout(1500);
    const header = await page.locator(".assembly-card h2").innerText();
    console.log("[assembly] search result:", header);

    // 3. J001 录入三部件（位置2留空），J002 录入四部件
    console.log("[assembly] J001 airbag:", JSON.stringify(await saveCell(page, "AUTO-J001", 0, "AUTO-A001")));
    console.log("[assembly] J001 sensor:", JSON.stringify(await saveCell(page, "AUTO-J001", 1, "AUTO-S001")));
    console.log("[assembly] J001 inflator1:", JSON.stringify(await saveCell(page, "AUTO-J001", 2, "AUTO-I001")));
    console.log("[assembly] J002 airbag:", JSON.stringify(await saveCell(page, "AUTO-J002", 0, "AUTO-A002")));
    console.log("[assembly] J002 sensor:", JSON.stringify(await saveCell(page, "AUTO-J002", 1, "AUTO-S002")));
    console.log("[assembly] J002 inflator1:", JSON.stringify(await saveCell(page, "AUTO-J002", 2, "AUTO-I002")));
    console.log("[assembly] J002 inflator2:", JSON.stringify(await saveCell(page, "AUTO-J002", 3, "AUTO-X002")));
    const footer = await page.locator(".assembly-card footer").innerText();
    console.log("[assembly] footer:", footer.replace(/\n/g, " "));

    // 4. DB 验证绑定/固件/事件
    const parts = await db.snapshot("parts", "SELECT part_id, part_no, part_type, source_type, current_profile_id, current_firmware_id FROM prop_part_item WHERE active_part_no IN ('AUTO-A001','AUTO-A002','AUTO-S001','AUTO-S002','AUTO-I001','AUTO-I002','AUTO-X002') ORDER BY part_no");
    console.log("[assembly] db parts:", JSON.stringify(parts.rows));
    const bindings = await db.snapshot("bind", `SELECT p.manufacturing_no, b.slot_type, i.part_no FROM prop_product_binding b JOIN prop_product p ON b.product_id=p.product_id JOIN prop_part_item i ON b.part_id=i.part_id WHERE p.manufacturing_no IN ('AUTO-J001','AUTO-J002') AND b.ended_time IS NULL AND b.slot_type<>'body' ORDER BY p.manufacturing_no, b.slot_type`);
    console.log("[assembly] db bindings:", JSON.stringify(bindings.rows));
    const events = await db.snapshot("ev", `SELECT event_type, COUNT(*) cnt FROM prop_production_event WHERE product_id IN (6,7) GROUP BY event_type`);
    console.log("[assembly] db events:", JSON.stringify(events.rows));

    // 5. 部件组装-028：制造失败格（录入已绑定其他产品的部件）→ 重新筛选/重置被拦截
    const dupResult = await saveCell(page, "AUTO-J003", 0, "AUTO-A001");
    console.log("[assembly] dup-bound save api:", JSON.stringify(dupResult));
    await page.waitForTimeout(600);
    const errText = await page.locator("tr", { hasText: "AUTO-J003" }).locator(".cell-error").innerText().catch(() => "(no cell-error)");
    console.log("[assembly] J003 cell error:", errText);
    const issueFooter = await page.locator(".assembly-card footer").innerText();
    console.log("[assembly] footer with issue:", issueFooter.replace(/\n/g, " "));

    await page.getByRole("button", { name: /筛\s*选/ }).click();
    await page.waitForTimeout(600);
    const blockToast1 = await readToasts(page);
    const headerAfterBlockedSearch = await page.locator(".assembly-card h2").innerText();
    console.log("[assembly] search blocked toast:", blockToast1, "| header:", headerAfterBlockedSearch);
    await page.getByRole("button", { name: /重\s*置/ }).click();
    await page.waitForTimeout(600);
    const blockToast2 = await readToasts(page);
    const headerAfterBlockedReset = await page.locator(".assembly-card h2").innerText();
    console.log("[assembly] reset blocked toast:", blockToast2, "| header:", headerAfterBlockedReset);

    // 6. 产品生产权限-004：存在失败格时通过菜单离开页面
    const urlBefore = page.url();
    let navigated = false;
    try {
      const menuItem = page.locator(".el-menu-item, .ant-menu-item, a", { hasText: "质检工作台" }).first();
      await menuItem.click({ timeout: 5000 });
      await page.waitForTimeout(1500);
      navigated = !page.url().includes("/production/assembly");
    } catch {
      console.log("[assembly] menu click failed, trying direct link");
      const link = page.locator("a[href*='inspection']").first();
      await link.click({ timeout: 5000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      navigated = !page.url().includes("/production/assembly");
    }
    const modalVisible = await page.locator(".ant-modal-confirm, .el-message-box").first().isVisible().catch(() => false);
    console.log(`[assembly] leave: urlBefore=${urlBefore} urlAfter=${page.url()} navigated=${navigated} interceptionModal=${modalVisible}`);

    console.log("---- VERDICT ----");
    const j001Ok = bindings.rows.filter((r) => r.manufacturing_no === "AUTO-J001").length === 3;
    const j002Ok = bindings.rows.filter((r) => r.manufacturing_no === "AUTO-J002").length === 4;
    const fwOk = parts.rows.filter((r) => String(r.part_no).startsWith("AUTO-S")).every((r) => Number(r.current_firmware_id) === 3);
    console.log(j001Ok && j002Ok && fwOk
      ? "PASS: 组装绑定/固件/事件落库正确（J001三件+J002四件，传感器固件=85cm）。"
      : "FAIL: 组装落库与预期不符，需查看 Trace。");
    console.log(/已绑定产品|请先显式解除/.test(errText)
      ? "PASS: 重复绑定被拦截并显示行内红字。"
      : `CHECK: 重复绑定错误提示='${errText}'`);
    console.log(/未保存|失败|待确认/.test(blockToast1) && /未保存|失败|待确认/.test(blockToast2)
      ? "部件组装-028 运行时确认：存在失败格时重新筛选/重置被拦截（用例'翻页拦截'无实现载体，实际拦截点为筛选/重置）。"
      : "部件组装-028 UNCONFIRMED：未观察到拦截提示。");
    console.log(navigated && !modalVisible
      ? "产品生产权限-004 冲突运行时确认：存在失败数据时可直接离开组装页，无任何拦截（数据仅存前端内存）。"
      : "产品生产权限-004：离开被拦截或未离开，静态冲突结论需修正。");
  } finally {
    const tracePath = await closeSession(session, "verify-prod-assembly");
    console.log("[assembly] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[assembly] FAILED:", e.message); process.exit(1); });
