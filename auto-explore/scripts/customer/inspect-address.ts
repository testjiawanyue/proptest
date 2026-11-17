import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "inspect-address" });
  const page = session.page;
  try {
    await login(page);
    await page.goto("/customer/detail/3");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.getByRole("button", { name: "编辑资料" }).first().click();
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("button", { name: "添加地址" }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '添加联系人' }).first().click();
    await page.waitForTimeout(1000);
    const aria = await page.locator("body").ariaSnapshot();
    const idx = aria.lastIndexOf("dialog");
    console.log("[addr] aria (last dialog part):");
    console.log(idx >= 0 ? aria.slice(idx, idx + 2600) : aria.slice(-2600));
  } finally {
    await closeSession(session, "inspect-address");
    await browser.close();
  }
}
main().catch((e) => { console.error("[addr] FAILED:", e.message); process.exit(1); });

