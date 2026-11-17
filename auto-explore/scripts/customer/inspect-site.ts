import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";
async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const s = await db.snapshot("s", "SELECT subject_id, company_id FROM prop_customer_subject WHERE subject_name = 'AUTO-支店删除验证' ORDER BY subject_id DESC LIMIT 1");
  const siteId = Number(s.rows[0].subject_id);
  const companyId = Number(s.rows[0].company_id);
  console.log("[i] site:", siteId, "company:", companyId);
  await db.close();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "inspect-site" });
  const page = session.page;
  try {
    await login(page);
    await page.goto(`/customer/detail/${siteId}`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const aria = await page.locator("body").ariaSnapshot();
    const main = aria.indexOf("main:");
    console.log("[i] site detail main area:");
    console.log(main >= 0 ? aria.slice(main, main + 900) : aria.slice(0, 900));
    console.log("==== company detail main area ====");
    await page.goto(`/customer/detail/${companyId}`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const aria2 = await page.locator("body").ariaSnapshot();
    const main2 = aria2.indexOf("main:");
    console.log(main2 >= 0 ? aria2.slice(main2, main2 + 1600) : aria2.slice(0, 1600));
  } finally {
    await closeSession(session, "inspect-site");
    await browser.close();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
