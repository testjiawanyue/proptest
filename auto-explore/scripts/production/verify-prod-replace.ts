/**
 * REQ-026 PARTIAL 运行时取证：更换部件且资料不一致时的两次顺序确认（replacement → profile）
 * 前置：AUTO-J001 已绑定气囊 AUTO-A001（profile=气囊A型 v4）
 * 步骤：DB 种入 AUTO-A050（profile=气囊B型 v19）→ 组装页 J001 气囊格改录 AUTO-A050
 *      → 观察两次行内确认 → DB 验证旧绑定结束/新绑定/资料更正/事件
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-prod-replace" });
  const page = session.page;
  try {
    const existing = await db.snapshot("chk", "SELECT part_id FROM prop_part_item WHERE active_part_no = 'AUTO-A050'");
    if (!existing.rows.length) {
      await db.snapshot("seed",
        `INSERT INTO prop_part_item (part_no, active_part_no, part_type, source_type, current_profile_id, current_profile_version_id, create_by, create_time)
         VALUES ('AUTO-A050', 'AUTO-A050', 'airbag', 'assembly', 6, 19, 'admin', NOW())`);
    }
    console.log("[replace] AUTO-A050 ready (profile_id=6, version_id=19)");
    await login(page);
    await page.goto("/production/assembly");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1500);

    const field = page.locator(".default-field", { hasText: "气囊资料" }).first();
    await field.locator(".ant-select").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "气囊 A型" }).first().click();
    await page.waitForTimeout(400);

    await page.locator(".ant-segmented-item", { hasText: "编号筛选" }).click();
    await page.getByPlaceholder("扫描或输入制造编号").fill("AUTO-J001");
    await page.getByRole("button", { name: /筛\s*选/ }).click();
    await page.waitForTimeout(1500);
    console.log("[replace] search:", await page.locator(".assembly-card h2").innerText());

    const row = page.locator("table.sheet tbody tr", { has: page.locator("code", { hasText: "AUTO-J001" }) });
    const input = row.locator("td input").nth(0);
    const waitPut = () => page.waitForResponse(
      (r) => r.url().includes("/prop/production/assembly") && r.request().method() === "PUT",
      { timeout: 10000 },
    );

    let respPromise = waitPut();
    await input.click();
    await input.fill("AUTO-A050");
    await input.press("Enter");
    let resp = await respPromise;
    console.log("[replace] put#1:", resp.status(), (await resp.text()).slice(0, 400));

    const confirmations: string[] = [];
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(700);
      const pending = row.locator(".inline-confirm");
      if (!(await pending.isVisible().catch(() => false))) break;
      const msg = await pending.locator("span").first().innerText();
      confirmations.push(msg);
      console.log(`[replace] inline-confirm #${confirmations.length}:`, msg);
      respPromise = waitPut();
      await pending.getByRole("button", { name: /确\s*认/ }).click();
      resp = await respPromise;
      console.log(`[replace] put#${confirmations.length + 1}:`, resp.status(), (await resp.text()).slice(0, 400));
    }
    await page.waitForTimeout(800);
    const cellValue = await row.locator("td input").nth(0).inputValue();
    const cellTag = await row.locator("td").nth(1).locator(".editable-tag").first().innerText().catch(() => "(no tag)");
    console.log("[replace] final cell value:", cellValue, "| profile tag:", cellTag);

    const binds = await db.snapshot("b", `SELECT b.binding_id, b.slot_type, i.part_no, b.ended_time FROM prop_product_binding b JOIN prop_part_item i ON b.part_id=i.part_id WHERE b.product_id=6 AND b.slot_type='airbag' ORDER BY b.binding_id`);
    console.log("[replace] db airbag bindings of J001:", JSON.stringify(binds.rows));
    const part = await db.snapshot("p", "SELECT part_id, part_no, current_profile_id, current_profile_version_id FROM prop_part_item WHERE part_no='AUTO-A050'");
    console.log("[replace] db AUTO-A050 profile:", JSON.stringify(part.rows));
    const events = await db.snapshot("e", "SELECT event_type, event_content FROM prop_production_event WHERE product_id=6 ORDER BY event_id DESC LIMIT 4");
    console.log("[replace] db recent events:", JSON.stringify(events.rows, null, 1));

    console.log("---- VERDICT ----");
    const twoStep = confirmations.length === 2;
    const oldEnded = binds.rows.some((r) => r.part_no === "AUTO-A001" && r.ended_time !== null);
    const newActive = binds.rows.some((r) => r.part_no === "AUTO-A050" && r.ended_time === null);
    const corrected = Number((part.rows[0] as Record<string, unknown>)?.current_profile_id) === 2;
    const eventTypes = events.rows.map((r) => String(r.event_type));
    console.log(twoStep
      ? `REQ-026 PARTIAL 运行时确认：更换+资料不一致为两次顺序行内确认（①${confirmations[0]} ②${confirmations[1]}）。`
      : `确认次数=${confirmations.length}，与静态预期（两次）不符，需人工复核。`);
    console.log(oldEnded && newActive && corrected && eventTypes.includes("PART_REPLACED") && eventTypes.includes("PROFILE_CORRECTED")
      ? "PASS: 旧绑定结束、新绑定生效、资料更正 A型、PART_REPLACED+PROFILE_CORRECTED 事件齐全。"
      : "CHECK: 落库结果需复核（见上方 DB 输出）。");
  } finally {
    const tracePath = await closeSession(session, "verify-prod-replace");
    console.log("[replace] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[replace] FAILED:", e.message); process.exit(1); });
