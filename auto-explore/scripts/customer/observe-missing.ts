/**
 * 观察式确认：更正履历 / 历史编号展示 / 受付与通知跳转（共 8 条用例）
 * 证据来源：客户列表列结构、详情页区块、prop_customer_* 表结构。
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "observe-missing" });
  const page = session.page;
  try {
    await login(page);

    await page.goto("/customer");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    const listText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    console.log("[obs] 列表包含'历史编号':", listText.includes("历史编号"));
    console.log("[obs] 列表包含'更正履历':", listText.includes("更正履历"));

    await page.getByRole("button", { name: "查看详情" }).first().click();
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    const detailText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    console.log("[obs] 详情包含'历史编号':", detailText.includes("历史编号"));
    console.log("[obs] 详情包含'更正履历'或'履历':", detailText.includes("履历"));
    console.log("[obs] 详情包含'后续功能':", detailText.includes("后续功能"));
    const idx = detailText.indexOf("关联业务");
    console.log("[obs] 关联业务区块:", idx >= 0 ? detailText.slice(idx, idx + 120) : "(未找到)");

    const tables = await db.snapshot("t", "SHOW TABLES LIKE 'prop_customer%'");
    console.log("[obs] customer tables:", tables.rows.map((r) => Object.values(r)[0]).join(", "));
  } finally {
    const tracePath = await closeSession(session, "observe-missing");
    console.log("[obs] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[obs] FAILED:", e.message); process.exit(1); });
