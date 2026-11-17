import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "inspect-dialog" });
  const page = session.page;
  try {
    await login(page);
    await page.goto("/customer");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.getByRole("button", { name: "新建公司" }).first().click();
    await page.waitForTimeout(1200);

    const aria = await page.locator("body").ariaSnapshot();
    const dialogIndex = aria.indexOf("dialog");
    console.log("[dialog] aria (dialog part):");
    console.log(dialogIndex >= 0 ? aria.slice(dialogIndex, dialogIndex + 1600) : aria.slice(-1600));

    const labels = await page.locator(".ant-modal, [role=dialog]").first().locator("label, .ant-form-item-label").allInnerTexts().catch(() => [] as string[]);
    console.log("[dialog] labels:", JSON.stringify(labels));
  } finally {
    await closeSession(session, "inspect-dialog");
    await browser.close();
  }
}
main().catch((e) => { console.error("[dialog] FAILED:", e.message); process.exit(1); });
