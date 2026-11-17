import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "inspect-edit" });
  const page = session.page;
  try {
    await login(page);
    await page.goto("/customer/detail/3");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.getByRole("button", { name: "编辑资料" }).first().click();
    await page.waitForTimeout(1200);
    const aria = await page.locator("body").ariaSnapshot();
    const idx = aria.indexOf("dialog");
    console.log("[edit] aria (dialog part):");
    console.log(idx >= 0 ? aria.slice(idx, idx + 2000) : aria.slice(-2000));
  } finally {
    await closeSession(session, "inspect-edit");
    await browser.close();
  }
}
main().catch((e) => { console.error("[edit] FAILED:", e.message); process.exit(1); });
