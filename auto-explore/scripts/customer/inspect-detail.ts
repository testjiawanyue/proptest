import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "inspect-detail" });
  const page = session.page;
  try {
    await login(page);
    await page.goto("/customer");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.getByRole("button", { name: "查看详情" }).first().click();
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    console.log("[detail] url:", page.url());
    const aria = await page.locator("body").ariaSnapshot();
    console.log("[detail] aria (first 2200):");
    console.log(aria.slice(0, 2200));
  } finally {
    await closeSession(session, "inspect-detail");
    await browser.close();
  }
}
main().catch((e) => { console.error("[detail] FAILED:", e.message); process.exit(1); });
