/**
 * 冲突复验 V5-CONFLICT-004 部件资料-023：并发编辑是否静默覆盖
 * 冲突复验 V5-CONFLICT-005 部件资料版本-002：是否存在版本历史查看入口
 */
import { chromium, type Page } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function openEditDialog(page: Page, profileName: string): Promise<void> {
  await page.goto("/prop-settings/part-profile");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  const row = page.getByRole("row", { name: new RegExp(profileName) });
  await row.getByRole("button", { name: "编辑" }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
}

async function saveSpec(page: Page, spec: string): Promise<{ toast: string; apiBodies: string[] }> {
  const apiBodies: string[] = [];
  const onResponse = async (response: import("playwright").Response): Promise<void> => {
    if (response.url().includes("/prop/part-profile") && ["PUT", "POST"].includes(response.request().method())) {
      apiBodies.push(`${response.status()}:${(await response.text().catch(() => "")).slice(0, 200)}`);
    }
  };
  page.on("response", (r) => void onResponse(r));
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /规格/ }).fill(spec);
  await dialog.getByRole("button", { name: /确\s*定/ }).click();
  await page.waitForTimeout(2000);
  const toast = await page.locator(".ant-message span").allInnerTexts().then((t) => t.join(" | ")).catch(() => "");
  return { toast, apiBodies };
}

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const profileName = "AUTO-并发验证部件";

  const setup = await createSession(browser, { traceName: "pp-concurrent-setup" });
  await login(setup.page);
  await setup.page.goto("/prop-settings/part-profile");
  await setup.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await setup.page.waitForTimeout(800);
  await setup.page.getByRole("button", { name: "新建部件资料" }).first().click();
  const createDialog = setup.page.getByRole("dialog");
  await createDialog.waitFor({ state: "visible", timeout: 5000 });
  await createDialog.getByRole("combobox", { name: /部件类型/ }).click();
  await setup.page.locator(".ant-select-item-option", { hasText: "衣体" }).first().click();
  await createDialog.getByRole("textbox", { name: /部件名称/ }).fill(profileName);
  await createDialog.getByRole("textbox", { name: /规格/ }).fill("AUTO-初始规格");
  await createDialog.getByRole("button", { name: /确\s*定/ }).click();
  await setup.page.waitForTimeout(2000);
  await closeSession(setup, "pp-concurrent-setup");

  const profile = await db.snapshot("p", `SELECT profile_id FROM prop_part_profile ORDER BY profile_id DESC LIMIT 1`);
  const profileId = Number(profile.rows[0].profile_id);
  console.log(`[pp] profile created: id=${profileId}`);

  const sessionA = await createSession(browser, { traceName: "pp-A" });
  const sessionB = await createSession(browser, { traceName: "pp-B" });
  try {
    await login(sessionA.page);
    await login(sessionB.page);
    await openEditDialog(sessionA.page, profileName);
    await openEditDialog(sessionB.page, profileName);
    console.log("[pp] both edit dialogs open");

    const a = await saveSpec(sessionA.page, "AUTO-规格-A-先保存");
    console.log(`[pp] A: toast='${a.toast}' api=${JSON.stringify(a.apiBodies)}`);
    const b = await saveSpec(sessionB.page, "AUTO-规格-B-后保存");
    console.log(`[pp] B: toast='${b.toast}' api=${JSON.stringify(b.apiBodies)}`);

    const versions = await db.snapshot("v",
      `SELECT version_no, spec FROM prop_part_profile_version WHERE profile_id = ${profileId} ORDER BY version_no`);
    console.log("[pp] versions:", JSON.stringify(versions.rows));
    const current = await db.snapshot("c",
      `SELECT v.spec FROM prop_part_profile p JOIN prop_part_profile_version v ON p.current_version_id = v.version_id WHERE p.profile_id = ${profileId}`);
    const currentSpec = String(current.rows[0].spec);
    console.log(`[pp] current spec: '${currentSpec}'`);

    const bWarned = /他人|已被.*修改|覆盖|冲突|刷新/.test(b.toast) || b.apiBodies.some((x) => /他人|冲突|已被/.test(x));

    console.log("---- VERDICT-004 ----");
    if (currentSpec.includes("B-后保存") && !bWarned) {
      console.log("CONFLICT-CONFIRMED: B 后保存生成新版本并成为当前版本，无任何并发提示。与静态分析一致；用例 部件资料-023 的预期（检测旧数据并提示）在当前实现下必然失败。");
    } else if (bWarned) {
      console.log("NO-CONFLICT: B 收到并发提示，用例预期成立。");
    } else {
      console.log("UNCONFIRMED: 需人工查看 Trace。");
    }

    console.log("---- VERDICT-005 版本历史入口观察 ----");
    await sessionA.page.goto("/prop-settings/part-profile");
    await sessionA.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await sessionA.page.waitForTimeout(800);
    const pageText = (await sessionA.page.locator("body").innerText()).replace(/\s+/g, " ");
    const hasHistoryOnPage = pageText.includes("历史版本") || pageText.includes("版本历史");
    await openEditDialog(sessionA.page, profileName);
    const dialogText = (await sessionA.page.getByRole("dialog").innerText()).replace(/\s+/g, " ");
    const hasHistoryInDialog = dialogText.includes("历史版本") || dialogText.includes("版本历史");
    console.log(`[pp] 页面含版本历史入口: ${hasHistoryOnPage} | 编辑弹窗含版本历史入口: ${hasHistoryInDialog}`);
    const versionCount = await db.snapshot("vc", `SELECT COUNT(*) AS cnt FROM prop_part_profile_version WHERE profile_id = ${profileId}`);
    console.log(`[pp] DB 中该资料版本数: ${JSON.stringify(versionCount.rows)}（数据库保留历史版本，但无 UI 查看入口）`);
    if (!hasHistoryOnPage && !hasHistoryInDialog && Number(versionCount.rows[0].cnt) >= 3) {
      console.log("CONFLICT-CONFIRMED: 数据库保留多份历史版本，但页面与编辑弹窗均无版本历史查看入口。与静态分析一致；用例 部件资料版本-002 的预期（打开版本历史入口）在当前实现下无法执行。");
    }
  } finally {
    await closeSession(sessionA, "pp-A");
    await closeSession(sessionB, "pp-B");
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[pp] FAILED:", e.message); process.exit(1); });
