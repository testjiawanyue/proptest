import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "inspect-pp-create" });
  const page = session.page;
  try {
    await login(page);
    await page.goto("/prop-settings/part-profile");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    const aria = await page.locator("body").ariaSnapshot();
    const main = aria.indexOf("main:");
    console.log("[create] main top:");
    console.log(main >= 0 ? aria.slice(main, main + 900) : aria.slice(0, 900));

    const newButton = page.getByRole("button", { name: /新建|新增/ }).first();
    await newButton.click();
    await page.waitForTimeout(1200);
    const aria2 = await page.locator("body").ariaSnapshot();
    const dlg = aria2.indexOf("dialog");
    console.log("[create] dialog:");
    console.log(dlg >= 0 ? aria2.slice(dlg, dlg + 1400) : aria2.slice(-1400));
  } finally {
    await closeSession(session, "inspect-pp-create");
    await browser.close();
  }
}
main().catch((e) => { console.error("[create] FAILED:", e.message); process.exit(1); });
