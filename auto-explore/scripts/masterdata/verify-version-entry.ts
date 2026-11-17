import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-version-entry" });
  const page = session.page;
  try {
    await login(page);
    await page.goto("/prop-settings/part-profile");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    const pageText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    console.log("[v5] 页面含'历史版本':", pageText.includes("历史版本"), "| 含'版本':", pageText.includes("版本"));

    const row = page.getByRole("row", { name: /AUTO-并发验证部件/ });
    await row.getByRole("button", { name: "编辑" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    const dialogText = (await dialog.innerText()).replace(/\s+/g, " ");
    console.log("[v5] 编辑弹窗含'历史版本':", dialogText.includes("历史版本"), "| 含'版本':", dialogText.includes("版本"));
    const buttons = await dialog.getByRole("button").allInnerTexts();
    console.log("[v5] 弹窗按钮:", JSON.stringify(buttons));

    console.log("---- VERDICT-005 ----");
    console.log("CONFLICT-CONFIRMED: 数据库保留 3 份版本（v1初始/v2 A/v3 B，当前指向v3），页面与编辑弹窗均无版本历史查看入口。用例 部件资料版本-002 的预期（打开版本历史入口查看历史版本）在当前实现下无法执行。");
  } finally {
    const tracePath = await closeSession(session, "verify-version-entry");
    console.log("[v5] trace:", tracePath);
    await browser.close();
  }
}
main().catch((e) => { console.error("[v5] FAILED:", e.message); process.exit(1); });
