import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";
async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-delete-site2" });
  const page = session.page;
  const siteId = 11;
  const companyId = 10;
  try {
    await login(page);
    await page.goto(`/customer/detail/${companyId}`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(800);

    let deleteStatus: number | undefined;
    let deleteBody = "";
    page.on("response", (response) => {
      void (async () => {
        if (response.request().method() === "DELETE" && response.url().includes("/prop/customer/")) {
          deleteStatus = response.status();
          deleteBody = (await response.text().catch(() => "")).slice(0, 400);
        }
      })();
    });

    await page.getByRole("button", { name: /删\s*除/ }).first().click();
    await page.waitForTimeout(800);
    const confirmDialog = page.getByRole("dialog").last();
    const aria = await confirmDialog.ariaSnapshot().catch(() => "");
    console.log("[site2] confirm dialog:", aria.replace(/\n/g, " | ").slice(0, 300));
    const confirmButton = confirmDialog.getByRole("button", { name: /删\s*除|确\s*定|移\s*除/ }).first();
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
      console.log("[site2] delete confirm accepted");
    }
    await page.waitForTimeout(2000);

    const toast = await page.locator(".ant-message span").allInnerTexts().then((t) => t.join(" | ")).catch(() => "");
    console.log(`[site2] delete api: status=${deleteStatus} body='${deleteBody}' toast='${toast}'`);

    const siteAfter = await db.snapshot("sa", `SELECT subject_id FROM prop_customer_subject WHERE subject_id = ${siteId}`);
    const siteDeleted = siteAfter.rows.length === 0;
    console.log(`[site2] site exists after delete: ${!siteDeleted}`);

    console.log("---- VERDICT ----");
    if (siteDeleted && (deleteStatus ?? 200) < 400) {
      console.log("CONFLICT-CONFIRMED: 支店被订单引用仍可删除成功，系统未检查订单引用。与静态分析一致；用例 客户删除-006 的预期（引用拦截）在当前实现下必然失败。订单 AUTO-ORD-SITE-001 的 recipient_id 成为悬空引用。");
    } else if (!siteDeleted) {
      console.log("NO-CONFLICT: 支店删除被拦截，用例预期成立，静态结论需修正。");
    } else {
      console.log("UNCONFIRMED: 需人工查看 Trace。");
    }
  } finally {
    const tracePath = await closeSession(session, "verify-delete-site2");
    console.log("[site2] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[site2] FAILED:", e.message); process.exit(1); });
