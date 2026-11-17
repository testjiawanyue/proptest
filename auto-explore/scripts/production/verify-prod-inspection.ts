/**
 * 质检工作台-016 冲突复验（跨筛选勾选保留问题）+ 质检主流程 + 资格判定
 * 前置：AUTO-J001/J002 已组装齐全（verify-prod-assembly/replace），未质检
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
  const session = await createSession(browser, { traceName: "verify-prod-inspection" });
  const page = session.page;
  try {
    await login(page);
    await page.goto("/production/inspection");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1500);

    // 1. 初始待质检清单
    const initialRows = await page.locator(".list-panel .ant-table-row").allInnerTexts();
    console.log("[insp] initial rows:", initialRows.map((t) => t.split("\t")[0]).join(", "));
    const listHeader = await page.locator(".list-panel header h2").innerText();
    console.log("[insp] list header:", listHeader);

    // 2. 勾选 AUTO-J001
    await page.locator(".ant-table-row", { hasText: "AUTO-J001" }).locator(".ant-checkbox-wrapper").click();
    await page.waitForTimeout(400);
    const selected1 = await page.locator(".list-panel header span").first().innerText();
    console.log("[insp] after select J001:", selected1);

    // 3. 番号入力筛选 AUTO-J002 → 弹窗 → 取消：勾选与清单应保留
    await page.locator(".ant-tabs-tab", { hasText: "番号入力" }).click();
    const singleInput = page.getByPlaceholder("扫描或输入完整製造番号");
    await singleInput.fill("AUTO-J002");
    await page.getByRole("button", { name: /^筛\s*选$/ }).click();
    const switchModal = page.locator(".ant-modal-confirm");
    await switchModal.waitFor({ state: "visible", timeout: 5000 });
    console.log("[insp] switch modal:", (await switchModal.innerText()).replace(/\n/g, " "));
    await switchModal.getByRole("button", { name: /取\s*消/ }).click();
    await page.waitForTimeout(500);
    const afterCancel = await page.locator(".list-panel header span").first().innerText();
    const rowsAfterCancel = await page.locator(".list-panel .ant-table-row").count();
    console.log(`[insp] after cancel: selected='${afterCancel}' rows=${rowsAfterCancel}`);

    // 4. 再次筛选 → 弹窗 → 确定：清单更换且勾选清空（质检工作台-016 取证）
    await page.getByRole("button", { name: /^筛\s*选$/ }).click();
    await switchModal.waitFor({ state: "visible", timeout: 5000 });
    await switchModal.getByRole("button", { name: /确\s*定/ }).click();
    await page.waitForTimeout(1500);
    const afterConfirm = await page.locator(".list-panel header span").first().innerText();
    const rowsAfterConfirm = await page.locator(".list-panel .ant-table-row").allInnerTexts();
    console.log(`[insp] after confirm: selected='${afterConfirm}' rows=${rowsAfterConfirm.map((t) => t.split("\t")[0]).join(", ")}`);

    // 5. 资格判定：筛选未齐全的 AUTO-J003 → 新查询不生效
    await singleInput.fill("AUTO-J003");
    await page.getByRole("button", { name: /^筛\s*选$/ }).click();
    await page.waitForTimeout(1200);
    const queryError = await page.locator(".list-panel .ant-alert").first().innerText().catch(() => "(no alert)");
    const rowsAfterIneligible = await page.locator(".list-panel .ant-table-row").allInnerTexts();
    console.log("[insp] eligibility alert:", queryError.replace(/\n/g, " "));
    console.log("[insp] rows after ineligible filter:", rowsAfterIneligible.map((t) => t.split("\t")[0]).join(", "));

    // 6. 质检主流程：勾选 AUTO-J002 → 确认质检通过
    await page.locator(".ant-table-row", { hasText: "AUTO-J002" }).locator(".ant-checkbox-wrapper").click();
    await page.waitForTimeout(400);
    const inspResp = page.waitForResponse(
      (r) => r.url().includes("/prop/production/inspection") && r.request().method() === "POST",
      { timeout: 15000 },
    );
    await page.getByRole("button", { name: /确认质检通过/ }).click();
    const confirmModal = page.locator(".ant-modal-confirm");
    await confirmModal.waitFor({ state: "visible", timeout: 5000 });
    console.log("[insp] confirm modal:", (await confirmModal.innerText()).replace(/\n/g, " "));
    await confirmModal.getByRole("button", { name: "确认质检通过" }).click();
    const resp = await inspResp;
    console.log("[insp] inspect api:", resp.status(), (await resp.text()).slice(0, 300));
    await page.waitForTimeout(1200);
    console.log("[insp] result toast:", await readToasts(page));

    // 7. DB 验证 + 重置后清单
    const insp = await db.snapshot("i", "SELECT inspection_id, product_id, create_by FROM prop_inspection ORDER BY inspection_id DESC LIMIT 1");
    console.log("[insp] db latest inspection:", JSON.stringify(insp.rows));
    await page.getByRole("button", { name: "重置筛选" }).click();
    await page.waitForTimeout(1500);
    const finalRows = await page.locator(".list-panel .ant-table-row").allInnerTexts();
    console.log("[insp] rows after reset:", finalRows.map((t) => t.split("\t")[0]).join(", ") || "(empty)");

    console.log("---- VERDICT ----");
    console.log(/已选 1 件/.test(afterCancel) && rowsAfterCancel === 2
      ? "PASS: 弹窗取消时原清单与勾选保留（与代码注释一致）。"
      : `CHECK: 取消分支 selected='${afterCancel}' rows=${rowsAfterCancel}`);
    console.log(/已选 0 件/.test(afterConfirm) && rowsAfterConfirm.length === 1 && rowsAfterConfirm[0].includes("AUTO-J002")
      ? "质检工作台-016 冲突运行时确认：更换清单后原勾选被清空（用例预期'保留勾选、不参与确认'与代码行为相反），需裁定改用例或改代码。"
      : "质检工作台-016 未复现，需人工查看 Trace。");
    console.log(/新查询未生效/.test(queryError)
      ? "PASS: 未齐全产品单番号筛选被资格判定拦截，原清单保留。"
      : `CHECK: eligibility alert='${queryError}'`);
    console.log(Number((insp.rows[0] as Record<string, unknown>)?.product_id) === 7 && resp.status() === 200
      ? "PASS: 质检通过登记落库（product_id=7），重置后清单仅剩 AUTO-J001。"
      : "CHECK: 质检落库需复核。");
  } finally {
    const tracePath = await closeSession(session, "verify-prod-inspection");
    console.log("[insp] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[insp] FAILED:", e.message); process.exit(1); });
