/**
 * 产品管理·部件操作补测：saveAssembly 两阶段协议（replacement 确认后才校验类型/占用）
 * + FIRMWARE_UPDATED 事件复核 + 取消类用例（006/008）
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-parts2" });
  const page = session.page;
  const results: string[] = [];
  const waitDetail = () => page.waitForResponse((r) => /\/prop\/production\/products\/\d+$/.test(r.url()) && r.request().method() === "GET", { timeout: 12000 });
  const waitAssembly = () => page.waitForResponse((r) => r.url().includes("/prop/production/assembly") && r.request().method() === "PUT", { timeout: 12000 });
  try {
    await login(page);
    let respPromise = waitDetail();
    await page.goto("/products/7");
    await respPromise;
    await page.waitForTimeout(1500);
    const partTable = page.locator("section", { hasText: "当前部件" }).last();
    const airbagRow = partTable.locator(".ant-table-row", { hasText: "气囊" });
    const modal = page.locator(".ant-modal", { hasText: "更换部件" });

    const twoPhaseSubmit = async (partNo: string, label: string) => {
      await airbagRow.getByRole("button", { name: "更换" }).click();
      await page.waitForTimeout(400);
      await modal.locator("input").nth(1).fill(partNo);
      let p = waitAssembly();
      await modal.getByRole("button", { name: /^确\s*定$/ }).click();
      let r = await p;
      const first = JSON.parse(await r.text());
      console.log(`[${label}] 一次提交:`, JSON.stringify(first).slice(0, 220));
      if (first.data?.status === "confirmation_required") {
        await page.waitForTimeout(300);
        p = waitAssembly();
        await modal.getByRole("button", { name: /^确\s*定$/ }).click();
        r = await p;
        const second = JSON.parse(await r.text());
        console.log(`[${label}] 二次提交:`, JSON.stringify(second).slice(0, 300));
        await page.waitForTimeout(500);
        return second;
      }
      return first;
    };

    // ---- 1. 类型不匹配（用例-004，完整两阶段）----
    const typeRes = await twoPhaseSubmit("AUTO-I051", "type");
    const typeAlert = await modal.locator(".ant-alert").last().innerText().catch(() => "(无)");
    console.log("[type] 弹窗 alert:", JSON.stringify(typeAlert));
    results.push(typeRes.code !== 200 && String(typeRes.msg || "").match(/类型|不符/)
      ? `PASS 用例-004：类型不匹配在二次确认后被拦截（${typeRes.msg}），弹窗内展示错误。`
      : `CHECK 用例-004：${JSON.stringify(typeRes).slice(0, 200)}`);
    await modal.getByRole("button", { name: /取\s*消/ }).click();
    await page.waitForTimeout(500);

    // ---- 2. 已绑定其他产品（用例-003，完整两阶段）----
    const boundRes = await twoPhaseSubmit("AUTO-A050", "bound");
    const boundAlert = await modal.locator(".ant-alert").last().innerText().catch(() => "(无)");
    console.log("[bound] 弹窗 alert:", JSON.stringify(boundAlert));
    results.push(boundRes.code !== 200 && String(boundRes.msg || "").match(/占用|绑定|使用|其他/)
      ? `PASS 用例-003：已绑定部件在二次确认后被拦截（${boundRes.msg}）。`
      : `CHECK 用例-003：${JSON.stringify(boundRes).slice(0, 200)}`);
    await modal.getByRole("button", { name: /取\s*消/ }).click();
    await page.waitForTimeout(500);

    // ---- 3. 固件升级事件复核（用例-009）----
    const fwEvents = await db.snapshot("fe", "SELECT event_id, event_type, before_firmware_id, after_firmware_id, event_content FROM prop_production_event WHERE part_id=22 AND event_type LIKE \x27FIRMWARE%\x27 ORDER BY event_id");
    console.log("[firmware] all firmware events:", JSON.stringify(fwEvents.rows));
    const hasUpdated = fwEvents.rows.some((r) => r.event_type === "FIRMWARE_UPDATED" && Number(r.after_firmware_id) === 4);
    const oldKept = fwEvents.rows.some((r) => r.event_type === "FIRMWARE_SET");
    results.push(hasUpdated && oldKept
      ? "PASS 用例-009：升级追加 FIRMWARE_UPDATED（3→4），原 FIRMWARE_SET 历史保留。"
      : "CHECK 用例-009：" + JSON.stringify(fwEvents.rows));

    // ---- 4. 取消更换衣体（用例-006）----
    const evBefore = await db.snapshot("e0", "SELECT COUNT(*) c FROM prop_production_event WHERE product_id=7");
    await partTable.locator(".ant-table-row", { hasText: "衣体" }).getByRole("button", { name: "更换衣体" }).click();
    await page.locator(".ant-modal-confirm").getByRole("button", { name: /取\s*消/ }).click();
    await page.waitForTimeout(800);
    const evAfter = await db.snapshot("e1", "SELECT COUNT(*) c FROM prop_production_event WHERE product_id=7");
    const cancelOk = String((evBefore.rows[0] as Record<string, unknown>).c) === String((evAfter.rows[0] as Record<string, unknown>).c);
    console.log("[cancel-body] events before/after:", JSON.stringify(evBefore.rows), JSON.stringify(evAfter.rows));
    results.push(cancelOk ? "PASS 用例-006：取消更换衣体不产生事件，数据保留。" : "CHECK 用例-006：事件数变化！");

    // ---- 5. 取消拆除（用例-008）----
    await partTable.locator(".ant-table-row", { hasText: "气囊" }).getByRole("button", { name: "拆除" }).click();
    await page.locator(".ant-modal-confirm").getByRole("button", { name: /取\s*消/ }).click();
    await page.waitForTimeout(800);
    const bindKept = await db.snapshot("bk", "SELECT ended_time FROM prop_product_binding WHERE product_id=7 AND slot_type=\x27airbag\x27 ORDER BY binding_id DESC LIMIT 1");
    const kept = (bindKept.rows[0] as Record<string, unknown>).ended_time === null;
    console.log("[cancel-remove] airbag binding:", JSON.stringify(bindKept.rows));
    results.push(kept ? "PASS 用例-008：取消拆除绑定保留。" : "CHECK 用例-008：绑定被结束！");

    console.log("---- VERDICT ----");
    results.forEach((r) => console.log(r));
  } finally {
    const tracePath = await closeSession(session, "verify-product-parts2");
    console.log("[parts2] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[parts2] FAILED:", e.message); process.exit(1); });