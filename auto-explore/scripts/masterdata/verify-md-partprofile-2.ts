/**
 * 基础设置-部件资料 冲突项复验（2 条）
 * 覆盖：部件资料-017（同名资料可重复保存？）、部件资料-023（并发编辑是否覆盖）。
 * 结论基准：批次001 均为冲突确认（无重名校验、无并发提示），本脚本复核现状。
 */
import { chromium, type Page } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, finishSession, compact, apiLogin, apiCall, readToasts,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook("reports/masterdata-runtime-results-partprofile-2.json");
const db = new DbClient();
const REQ = "FEAT-02 部件资料（VAL-19 / 并发编辑）";
const NAME_017 = "AUTO-MD-PP-017 重名";
const NAME_023 = "AUTO-MD-PP-023B 并发";

async function main(): Promise<void> {
  await db.connect();
  const token = await apiLogin(config.app.loginUser, config.app.loginPassword);

  // 023 夹具：专用资料（幂等）
  const existing = await db.query<{ profile_id: number }>(
    "SELECT profile_id FROM prop_part_profile_version WHERE part_name=? ORDER BY version_id DESC LIMIT 1",
    [NAME_023]);
  if (!existing.length) {
    const res = await apiCall(token, "POST", "/prop/part-profile", {
      partType: "jacket", partName: NAME_023, specification: "并发验证用", manufacturer: "厂商AUTO-023", numberPrefix: "AUTO23",
    });
    if (res.code !== 200) throw new Error(`023 夹具失败：${res.msg}`);
  }

  const { browser, session } = await launchSession();
  const page = session.page;
  page.setDefaultTimeout(12000);
  try {
    let profile017: number | undefined;
    await book.run("部件资料-017", "部件名称重复时保存失败", REQ, async () => {
      const before = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_part_profile_version WHERE part_name=?", [NAME_017]);
      await page.goto("/prop-settings/part-profile", { waitUntil: "domcontentloaded" });
      await page.locator(".part-profile-page").waitFor({ state: "visible" });
      await page.waitForTimeout(1200);
      await page.getByRole("button", { name: /部品マスタを追加/ }).click();
      const modal = page.locator(".ant-modal:visible");
      await modal.waitFor({ state: "visible" });
      await modal.locator(".ant-select").first().click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "ジャケット" }).first().click();
      const inputs = modal.locator("input");
      await inputs.nth(1).fill(NAME_017);
      await modal.locator("textarea").fill("重名验证用");
      await inputs.nth(3).fill("AUTO17");
      await modal.locator(".ant-btn-primary").last().click();
      await page.waitForTimeout(1800);
      const toast = await readToasts(page);
      const stillOpen = await modal.isVisible().catch(() => false);
      const after = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_part_profile_version WHERE part_name=?", [NAME_017]);
      if (Number(after[0].cnt) > Number(before[0].cnt)) {
        const rows = await db.query<{ profile_id: number }>(
          "SELECT profile_id FROM prop_part_profile_version WHERE part_name=? ORDER BY version_id DESC LIMIT 1",
          [NAME_017]);
        profile017 = rows[0].profile_id;
      }
      const duplicated = Number(after[0].cnt) > Number(before[0].cnt);
      return {
        status: duplicated ? "不通过" : "通过",
        actual: duplicated
          ? `冲突确认（与批次001一致）：同名「${NAME_017}」再次新建仍保存成功，版本数 ${before[0].cnt}→${after[0].cnt}，toast「${compact(toast, 40)}」，无重名提示；与用例预期「保存失败并提示名称重复/唯一约束冲突」相反`
          : `同名再次新建被拦截：toast「${compact(toast, 60)}」，弹窗保留=${stillOpen}，版本数 ${before[0].cnt}→${after[0].cnt} 不变`,
        evidence: "UI 新建同名资料 + DB 版本计数；后端 PartProfileService 无同名唯一校验",
      };
    });

    await book.run("部件资料-023", "两个用户并发编辑同一资料不发生覆盖", REQ, async () => {
      const ctxA = await browser.newContext({ baseURL: config.app.baseUrl });
      const ctxB = await browser.newContext({ baseURL: config.app.baseUrl });
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();
      await login(pageA);
      await login(pageB);
      const openEdit = async (p: Page) => {
        await p.goto("/prop-settings/part-profile", { waitUntil: "domcontentloaded" });
        await p.locator(".part-profile-page").waitFor({ state: "visible" });
        await p.waitForTimeout(1200);
        const row = p.locator("tr.ant-table-row", { hasText: NAME_023 }).first();
        await row.getByRole("button", { name: /編集/ }).click();
        const modal = p.locator(".ant-modal:visible");
        await modal.waitFor({ state: "visible" });
        await p.waitForTimeout(600);
        return modal;
      };
      const modalA = await openEdit(pageA);
      const modalB = await openEdit(pageB);
      const versionBefore = await db.query<{ maxv: number }>(
        `SELECT MAX(v.version_no) maxv FROM prop_part_profile_version v
         JOIN prop_part_profile p ON p.profile_id=v.profile_id WHERE v.part_name=?`, [NAME_023]);
      await modalA.locator("input").nth(2).fill("厂商AUTO-023-A");
      await modalA.locator(".ant-btn-primary").last().click();
      await pageA.waitForTimeout(1800);
      const toastA = await readToasts(pageA);
      await modalB.locator("input").nth(3).fill("AUTO23B");
      await modalB.locator(".ant-btn-primary").last().click();
      await pageB.waitForTimeout(1800);
      const toastB = await readToasts(pageB);
      const modalBStill = await modalB.isVisible().catch(() => false);
      const latest = await db.query<{ version_no: number; manufacturer: string; number_prefix: string }>(
        `SELECT version_no, manufacturer, number_prefix FROM prop_part_profile_version
         WHERE part_name=? ORDER BY version_no DESC LIMIT 1`, [NAME_023]);
      await ctxA.close();
      await ctxB.close();
      const overwritten = latest[0].number_prefix === "AUTO23B" && latest[0].manufacturer !== "厂商AUTO-023-A";
      const conflictNotified = /競合|他のユーザー|再読み込み|変更されています|最新の内容|上書きされ/.test(toastB);
      const ok = !overwritten || conflictNotified;
      return {
        status: ok ? "通过" : "不通过",
        actual: overwritten && !conflictNotified
          ? `冲突确认（与批次001一致）：A 保存「厂商AUTO-023-A」成功（toast「${compact(toastA, 30)}」）；B 用旧弹窗保存编号前缀成功且无并发提示（toast「${compact(toastB, 30)}」，弹窗关闭=${!modalBStill}）；最新版本 v${latest[0].version_no} 的厂商=${latest[0].manufacturer}、前缀=${latest[0].number_prefix}，A 的修改被无提示覆盖（仅存历史版本）`
          : `A 保存后 B 保存出现并发提示（toast「${compact(toastB, 60)}」）或未覆盖 A 的修改；最新版本 v${latest[0].version_no} 厂商=${latest[0].manufacturer}、前缀=${latest[0].number_prefix}`,
        evidence: "双浏览器上下文 + 旧弹窗提交 + DB 最新版本快照；后端 update 无 revision/updated_at 校验",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-md-partprofile-2");
    await db.close();
    await book.save();
    console.log("---- VERDICT ----");
    for (const r of book.list()) console.log(`${r.caseId}: ${r.status}`);
  }
}

async function launchSession() {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-md-partprofile-2" });
  await login(session.page);
  return { browser, session };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});