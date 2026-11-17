/**
 * 冲突复验：支店被订单引用时是否仍可删除（用例 客户删除-006 / 静态分析 BR-066）
 */
import { chromium, type Locator } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { createCompany } from "../../src/actions/customer.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function fillField(dialog: Locator, label: string, value: string): Promise<void> {
  const item = dialog.locator(".ant-form-item", { hasText: label }).first();
  await item.getByRole("textbox").fill(value);
}

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-delete-site" });
  const page = session.page;
  const companyName = "AUTO-支店删除验证公司";
  const siteName = "AUTO-支店删除验证";

  try {
    await login(page);
    await createCompany(page, { name: companyName });
    const company = await db.snapshot("c", `SELECT subject_id FROM prop_customer_subject WHERE subject_name = '${companyName}' ORDER BY subject_id DESC LIMIT 1`);
    const companyId = Number(company.rows[0].subject_id);
    console.log(`[site] company subject_id=${companyId}`);

    await page.goto(`/customer/detail/${companyId}`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.getByRole("button", { name: /新建支店/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    await fillField(dialog, "名称", siteName);
    await dialog.getByRole("button", { name: /确\s*定/ }).click();
    await page.waitForTimeout(2000);

    const site = await db.snapshot("s", `SELECT subject_id FROM prop_customer_subject WHERE subject_name = '${siteName}' AND subject_type = 'site' ORDER BY subject_id DESC LIMIT 1`);
    if (site.rows.length === 0) throw new Error("site creation failed");
    const siteId = Number(site.rows[0].subject_id);
    console.log(`[site] site created: subject_id=${siteId}`);

    await db.snapshot("seed",
      `INSERT INTO prop_order (order_no, order_date, order_type, customer_type, order_status,
        ordering_party_snapshot, recipient_snapshot, billing_party_snapshot,
        recipient_id, delivery_address_snapshot, revision, create_by, create_time)
       VALUES ('AUTO-ORD-SITE-001', CURDATE(), 'normal', 'direct', 'active', '{}', '{}', '{}', ${siteId}, '{}', 1, 'admin', NOW())`);
    console.log("[site] seeded order AUTO-ORD-SITE-001 referencing the site");

    await page.goto(`/customer/detail/${siteId}`);
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

    const deleteButton = page.getByRole("button", { name: /删除/ }).first();
    if (!(await deleteButton.isVisible().catch(() => false))) {
      const aria = await page.locator("body").ariaSnapshot();
      console.log("[site] no delete button found. aria tail:", aria.slice(-800));
      throw new Error("delete entry not found");
    }
    await deleteButton.click();
    await page.waitForTimeout(800);
    const confirmDialog = page.getByRole("dialog").last();
    const confirmButton = confirmDialog.getByRole("button", { name: /删\s*除|确\s*定|移\s*除/ }).first();
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
      console.log("[site] delete confirm accepted");
    }
    await page.waitForTimeout(2000);

    const toast = await page.locator(".ant-message span").allInnerTexts().then((t) => t.join(" | ")).catch(() => "");
    console.log(`[site] delete api: status=${deleteStatus} body='${deleteBody}' toast='${toast}'`);

    const siteAfter = await db.snapshot("sa", `SELECT subject_id FROM prop_customer_subject WHERE subject_id = ${siteId}`);
    const siteDeleted = siteAfter.rows.length === 0;
    console.log(`[site] site exists after delete: ${!siteDeleted}`);

    console.log("---- VERDICT ----");
    if (siteDeleted && (deleteStatus ?? 200) < 400) {
      console.log("CONFLICT-CONFIRMED: 支店被订单引用仍可删除成功，系统未检查订单引用。与静态分析一致；用例 客户删除-006 的预期（引用拦截）在当前实现下必然失败。订单 AUTO-ORD-SITE-001 的 recipient_id 成为悬空引用。");
    } else if (!siteDeleted) {
      console.log("NO-CONFLICT: 支店删除被拦截，用例预期成立，静态结论需修正。");
    } else {
      console.log("UNCONFIRMED: 需人工查看 Trace。");
    }
  } finally {
    const tracePath = await closeSession(session, "verify-delete-site");
    console.log("[site] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[site] FAILED:", e.message); process.exit(1); });
