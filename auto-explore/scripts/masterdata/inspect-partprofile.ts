import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  for (const t of ["prop_part_profile", "prop_part_profile_version", "prop_part_item"]) {
    const cols = await db.snapshot("c", `SHOW COLUMNS FROM ${t}`);
    console.log(`${t}:`, cols.rows.map((r) => r.Field).join(","));
  }
  const counts = await db.snapshot("n", "SELECT (SELECT COUNT(*) FROM prop_part_profile) AS p, (SELECT COUNT(*) FROM prop_part_profile_version) AS v, (SELECT COUNT(*) FROM prop_part_item) AS i");
  console.log("counts:", JSON.stringify(counts.rows));
  await db.close();

  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "inspect-partprofile" });
  const page = session.page;
  try {
    await login(page);
    await page.goto("/prop-settings/part-profile");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    const aria = await page.locator("body").ariaSnapshot();
    const main = aria.indexOf("main:");
    console.log("[pp] main area:");
    console.log(main >= 0 ? aria.slice(main, main + 2000) : aria.slice(0, 2000));
  } finally {
    await closeSession(session, "inspect-partprofile");
    await browser.close();
  }
}
main().catch((e) => { console.error("[pp] FAILED:", e.message); process.exit(1); });
