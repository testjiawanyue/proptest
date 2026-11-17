/**
 * 冲突复验 V5-CONFLICT-003 部件资料-018：被部件个体引用的资料停用是否被拦截
 * 方法：新建资料 → DB 种入引用它的部件个体 → UI 点击停用 → 观察是否成功
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-part-status" });
  const page = session.page;
  const profileName = "AUTO-停用验证部件";
  try {
    await login(page);
    await page.goto("/prop-settings/part-profile");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(800);

    await page.getByRole("button", { name: "新建部件资料" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    await dialog.getByRole("combobox", { name: /部件类型/ }).click();
    await page.locator(".ant-select-item-option", { hasText: "衣体" }).first().click();
    await dialog.getByRole("textbox", { name: /部件名称/ }).fill(profileName);
    await dialog.getByRole("textbox", { name: /规格/ }).fill("AUTO-停用验证规格");
    await dialog.getByRole("button", { name: /确\s*定/ }).click();
    await page.waitForTimeout(2000);

    const profile = await db.snapshot("p", `SELECT profile_id, current_version_id FROM prop_part_profile ORDER BY profile_id DESC LIMIT 1`);
    const profileId = Number(profile.rows[0].profile_id);
    const versionId = Number(profile.rows[0].current_version_id);
    console.log(`[status] profile created: id=${profileId} version=${versionId}`);

    await db.snapshot("seed",
      `INSERT INTO prop_part_item (part_no, active_part_no, part_type, source_type, current_profile_id, current_profile_version_id, create_by, create_time)
       VALUES ('AUTO-PART-STATUS-001', 'AUTO-PART-STATUS-001', 'jacket', 'intake', ${profileId}, ${versionId}, 'admin', NOW())`);
    console.log("[status] seeded part item referencing the profile");

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

    await page.goto("/prop-settings/part-profile");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    const row = page.getByRole("row", { name: new RegExp(profileName) });
    await row.getByRole("button", { name: "停用" }).click();
    await page.waitForTimeout(800);
    const confirmDialog = page.getByRole("dialog").last();
    const confirmButton = confirmDialog.getByRole("button", { name: /确\s*定|停\s*用/ }).first();
    if (await confirmButton.isVisible().catch(() => false)) {
      await confirmButton.click();
      console.log("[status] confirm accepted");
    }
    await page.waitForTimeout(2000);

    const toast = await page.locator(".ant-message span").allInnerTexts().then((t) => t.join(" | ")).catch(() => "");
    console.log(`[status] api=${apiStatus} body='${apiBody}' toast='${toast}'`);

    const after = await db.snapshot("a", `SELECT status FROM prop_part_profile WHERE profile_id = ${profileId}`);
    const status = String(after.rows[0].status);
    console.log(`[status] db status after: '${status}'`);

    console.log("---- VERDICT ----");
    if (status === "1" && (apiStatus ?? 200) < 400) {
      console.log("CONFLICT-CONFIRMED: 被部件个体引用的资料停用成功（status=1），系统未检查引用关系。与静态分析一致；用例 部件资料-018 的预期（引用拦截）在当前实现下必然失败。");
    } else if (status === "0") {
      console.log("NO-CONFLICT: 停用被拦截，用例预期成立，静态结论需修正。");
    } else {
      console.log("UNCONFIRMED: 需人工查看 Trace。");
    }
  } finally {
    const tracePath = await closeSession(session, "verify-part-status");
    console.log("[status] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[status] FAILED:", e.message); process.exit(1); });
