import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";
async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-part-status2" });
  const page = session.page;
  const profileId = 9;
  try {
    await login(page);
    await page.goto("/prop-settings/part-profile");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(1000);

    let apiStatus: number | undefined;
    let apiBody = "";
    page.on("response", (response) => {
      void (async () => {
        if (response.url().includes("/prop/part-profile") && ["PUT", "POST", "PATCH"].includes(response.request().method())) {
          apiStatus = response.status();
          apiBody = (await response.text().catch(() => "")).slice(0, 300);
        }
      })();
    });

    const row = page.getByRole("row", { name: /AUTO-停用验证部件/ });
    await row.getByRole("button", { name: "停用" }).click();
    await page.waitForTimeout(800);
    const confirmDialog = page.getByRole("dialog").last();
    await confirmDialog.getByRole("button", { name: /确\s*认/ }).click();
    await page.waitForTimeout(2000);

    const toast = await page.locator(".ant-message span").allInnerTexts().then((t) => t.join(" | ")).catch(() => "");
    console.log(`[status2] api=${apiStatus} body='${apiBody}' toast='${toast}'`);
    const after = await db.snapshot("a", `SELECT status FROM prop_part_profile WHERE profile_id = ${profileId}`);
    console.log(`[status2] db status: '${String(after.rows[0].status)}'`);

    console.log("---- VERDICT ----");
    if (String(after.rows[0].status) === "1" && (apiStatus ?? 200) < 400) {
      console.log("CONFLICT-CONFIRMED: 被部件个体引用的资料停用成功，系统未检查引用关系。与静态分析一致；用例 部件资料-018 的预期（引用拦截）在当前实现下必然失败。");
    } else {
      console.log("NO-CONFLICT / UNCONFIRMED: 需人工复核。");
    }
  } finally {
    const tracePath = await closeSession(session, "verify-part-status2");
    console.log("[status2] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[status2] FAILED:", e.message); process.exit(1); });
