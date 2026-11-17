/**
 * 产品管理 D2 批：部件追溯-014（独立页面权限 / 即时筛选 / 分页 / 导出）。
 * 夹具：临时角色 auto_part_ro（仅产品管理目录+部件追溯菜单）+ 账号 autopartro，结束清理。
 */
import { chromium, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, apiLogin, apiCall, apiBase, finishSession, compact,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook("reports/product-mgmt-runtime-results-d2.json");
const db = new DbClient();
const REQ = "FEAT-09 部件追溯（权限/筛选/分页/导出）";
const ROLE_KEY = "auto_part_ro";
const USER_NAME = "autopartro";
const USER_PASS = "Auto@123456";
const EXPORT_XLSX = "reports/part-export-d14.xlsx";
const EXPORT_CHECK = "reports/part-export-d14-check.json";
let token = "";
let page: Page;
let roleId = 0;
let userId = 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = async (locator: import("playwright").Locator) => compact(await locator.innerText().catch(() => ""));

async function cleanupFixtures(): Promise<void> {
  try {
    const users = await db.query<{ user_id: number }>("SELECT user_id FROM sys_user WHERE user_name=?", [USER_NAME]);
    for (const row of users) {
      await db.execute("DELETE FROM sys_user_role WHERE user_id=?", [row.user_id]);
      await db.execute("DELETE FROM sys_user_post WHERE user_id=?", [row.user_id]);
      await db.execute("DELETE FROM sys_user WHERE user_id=?", [row.user_id]);
    }
    const roles = await db.query<{ role_id: number }>("SELECT role_id FROM sys_role WHERE role_key=?", [ROLE_KEY]);
    for (const row of roles) {
      await db.execute("DELETE FROM sys_role_menu WHERE role_id=?", [row.role_id]);
      await db.execute("DELETE FROM sys_role WHERE role_id=?", [row.role_id]);
    }
  } catch (error) {
    console.error("[cleanup] 失败：", error);
  }
}

async function seedFixtures(adminToken: string): Promise<void> {
  await cleanupFixtures();
  const createdRole = await apiCall(adminToken, "POST", "/system/role", {
    roleName: "AUTO-角色-部件追溯只读", roleKey: ROLE_KEY, roleSort: 97, status: "0",
    menuIds: [2017, 2016], menuCheckStrictly: true,
  });
  if (createdRole.code !== 200) throw new Error(`角色夹具失败：${createdRole.msg}`);
  const roles = await db.query<{ role_id: number }>("SELECT role_id FROM sys_role WHERE role_key=? AND del_flag='0'", [ROLE_KEY]);
  roleId = roles[0].role_id;
  const createdUser = await apiCall(adminToken, "POST", "/system/user", {
    userName: USER_NAME, nickName: "AUTO-部件追溯只读", password: USER_PASS,
    status: "0", roleIds: [roleId], postIds: [], deptId: 100,
  });
  if (createdUser.code !== 200) throw new Error(`账号夹具失败：${createdUser.msg}`);
  const users = await db.query<{ user_id: number }>("SELECT user_id FROM sys_user WHERE user_name=? AND del_flag='0'", [USER_NAME]);
  userId = users[0].user_id;
}

async function loginAs(p: Page, user: string, password: string): Promise<void> {
  await p.goto("/login", { waitUntil: "domcontentloaded" });
  await p.getByPlaceholder(/账号|用户名|user|アカウント/i).first().fill(user);
  await p.getByPlaceholder(/密码|password|パスワード/i).first().fill(password);
  await p.getByRole("button", { name: /登\s*录|登录|login|ログイン/i }).first().click();
  await p.waitForURL((url: URL) => !url.pathname.includes("/login"), { timeout: 20000 });
}

async function pickProfile(label: string): Promise<void> {
  const select = page.locator(".ant-select", { has: page.locator("#part-profileId") }).first();
  await select.click();
  await page.waitForTimeout(600);
  const dropdown = page.locator(".ant-select-dropdown:visible").last();
  const option = dropdown.locator(".ant-select-item-option", { hasText: label }).first();
  const holder = dropdown.locator(".rc-virtual-list-holder").first();
  for (let i = 0; i < 60; i++) {
    if ((await option.count()) > 0 && (await option.isVisible().catch(() => false))) break;
    if (await holder.count()) {
      await holder.evaluate((el) => { el.scrollTop = Math.min(el.scrollTop + el.clientHeight * 0.5, el.scrollHeight); });
    }
    await page.waitForTimeout(180);
  }
  if (!(await option.isVisible().catch(() => false))) throw new Error(`资料选项未找到：${label}`);
  await option.click();
}

async function sizeLabel(): Promise<string> {
  return text(page.locator(".ant-pagination-options .ant-select-selection-item"));
}

async function main(): Promise<void> {
  await db.connect();
  token = await apiLogin(config.app.loginUser, config.app.loginPassword);
  await seedFixtures(token);
  const browser = await chromium.launch({ headless: config.run.headless });
  const ctx = await browser.newContext({ baseURL: config.app.baseUrl });
  const p = await ctx.newPage();
  page = p;
  p.setDefaultTimeout(15000);
  const session = await createSession(browser, { traceName: "verify-product-mgmt-d2" });
  try {
    await loginAs(p, USER_NAME, USER_PASS);
    await p.goto("/products/parts", { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(2500);
    const userToken = await apiLogin(USER_NAME, USER_PASS);

    await book.run("部件追溯-014", "独立页面权限、即时筛选与分页导出", REQ, async () => {
      const body = await text(p.locator("body"));
      const pageAccessible = /部品履歴|部件追溯|部品種別/.test(body) && !new URL(p.url()).pathname.includes("/404");
      const firstRow = p.locator("tbody tr.ant-table-row").first();
      await firstRow.waitFor({ state: "visible", timeout: 20000 });
      const rowCount = await p.locator("tbody tr.ant-table-row").count();

      const select = p.locator(".ant-select", { has: p.locator("#part-profileId") }).first();
      await select.click();
      await p.waitForTimeout(700);
      const optionCount = await p.locator(".ant-select-dropdown:visible .ant-select-item-option").count();
      await p.keyboard.press("Escape");
      await p.waitForTimeout(400);

      const enabled = await apiCall(userToken, "GET", "/prop/part-profile/enabled/jacket");
      const addProfile = await apiCall(userToken, "POST", "/prop/part-profile", {
        partType: "jacket", partName: "AUTO-RO-DENY", specification: "AUTO", manufacturer: "AUTO",
        numberPrefix: "AUTO-RO-", remark: "权限验证",
      });
      const changeStatus = await apiCall(userToken, "PUT", "/prop/part-profile/1/status?status=1");
      const permissionOk = pageAccessible && rowCount > 0 && optionCount > 0 &&
        enabled.code === 200 && addProfile.code === 403 && changeStatus.code === 403;

      const defaultSize = await sizeLabel();
      await p.locator(".ant-pagination-options .ant-select-selector").first().click();
      await p.waitForTimeout(300);
      await p.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "10" }).first().click();
      await p.waitForTimeout(1400);
      const page2 = p.locator(".ant-pagination-item-2").first();
      const hasPage2 = await page2.isVisible().catch(() => false);
      if (hasPage2) { await page2.click(); await p.waitForTimeout(1200); }
      const beforeFilterPage = await text(p.locator(".ant-pagination-item-active"));
      const filteredPromise = p.waitForResponse((r) => r.url().includes("/prop/production/parts?") && r.url().includes("profileId=1"), { timeout: 15000 });
      await pickProfile("衣体 オレンジ 标准型123");
      await filteredPromise;
      await p.waitForTimeout(1200);
      const afterFilterPage = await text(p.locator(".ant-pagination-item-active"));
      const filteredTotal = await text(p.locator(".toolbar span").last());

      await p.locator(".ant-pagination-options .ant-select-selector").first().click();
      await p.waitForTimeout(300);
      const size20 = p.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "20" }).first();
      if (await size20.isVisible().catch(() => false)) { await size20.click(); await p.waitForTimeout(1200); }

      const delayRoute = async (route: import("playwright").Route) => { await sleep(1500); await route.continue().catch(() => undefined); };
      await p.route("**/prop/production/parts?*", delayRoute);
      const filterPromise2 = p.waitForResponse((r) => r.url().includes("profileId=2"), { timeout: 15000 }).catch(() => null);
      await pickProfile("气囊 A型");
      await p.waitForTimeout(400);
      const exportButton = p.locator(".toolbar button").first();
      const during = {
        export: await exportButton.isDisabled().catch(() => false),
        pagination: (await p.locator(".ant-pagination-disabled").count()) > 0 ||
          (await p.locator(".ant-pagination-options .ant-select-disabled").count()) > 0,
        select: (await p.locator(".ant-select-disabled", { has: p.locator("#part-profileId") }).count()) > 0,
      };
      await filterPromise2;
      await p.waitForTimeout(1800);
      await p.unroute("**/prop/production/parts?*").catch(() => undefined);

      const api500 = await fetch(`${apiBase}/prop/production/parts?pageNum=1&pageSize=500`, { headers: { Authorization: `Bearer ${token}` } });
      const raw500 = (await api500.json()) as any;
      const capCount = Array.isArray(raw500.rows) ? raw500.rows.length : 0;

      const uiExportPromise = p.waitForResponse((r) => r.url().includes("/prop/production/parts/export"), { timeout: 15000 });
      await p.locator(".toolbar button").first().click();
      const uiExportResp = await uiExportPromise;
      const uiContentType = uiExportResp.headers()["content-type"] ?? "";
      const uiExportText = await uiExportResp.text();
      const uiExportOk = uiContentType.includes("spreadsheet");

      const postResp = await fetch(`${apiBase}/prop/production/parts/export`, {
        method: "POST", headers: { Authorization: `Bearer ${userToken}` },
      });
      writeFileSync(EXPORT_XLSX, Buffer.from(await postResp.arrayBuffer()));
      let check: any = {};
      try {
        execFileSync("python", ["scripts/case-tools/check_part_export.py", EXPORT_XLSX, EXPORT_CHECK], { cwd: process.cwd(), stdio: "ignore" });
        check = JSON.parse(readFileSync(EXPORT_CHECK, "utf-8"));
      } catch (error) {
        check = { error: error instanceof Error ? error.message : String(error) };
      }
      const contentOk = postResp.status === 200 && check.headerCount === 5 && check.rowCount === 68 &&
        check.types.includes("ジャケット") && check.types.includes("エアバッグ") &&
        check.types.includes("センサ") && check.types.includes("インフレータ") &&
        check.sources.includes("ジャケット入庫") && check.sources.includes("組立時の登録") &&
        check.datesOk === true && check.hasHistoryColumn === false;

      const paginationOk = defaultSize.includes("20") && beforeFilterPage === "2" && afterFilterPage === "1" &&
        capCount <= 100 && during.export && during.pagination && during.select;
      const ok = permissionOk && paginationOk && uiExportOk && contentOk;
      return {
        status: ok ? "通过" : "不通过",
        actual: `权限：页面可访问=${pageAccessible}、列表 ${rowCount} 行、资料选项 ${optionCount} 项；共享资料读接口 code=${enabled.code}；新增/停用资料 code=${addProfile.code}/${changeStatus.code}。筛选：默认每页=${defaultSize}、切前 current=${beforeFilterPage}、切资料后 current=${afterFilterPage}、total=${filteredTotal}；请求期间禁用 导出=${during.export}/分页=${during.pagination}/下拉=${during.select}；pageSize=500 返回 ${capCount} 行。导出 UI：HTTP ${uiExportResp.status()}、content-type=${uiContentType}、响应=「${compact(uiExportText, 40)}」（xlsx=${uiExportOk}）。导出 POST 直连：HTTP ${postResp.status}、${check.headerCount} 列=${JSON.stringify(check.headers)}、行数=${check.rowCount}、类型=${JSON.stringify(check.types)}、来源=${JSON.stringify(check.sources)}、日期=${check.datesOk}、含履历列=${check.hasHistoryColumn}（内容合规=${contentOk}）`,
        evidence: "只读角色 UI/API 权限 + 资料即时筛选 + 延迟请求禁用 + UI 导出按钮实际请求 + POST 导出 xlsx 表头/行/类型/来源/日期解析",
      };
    });
  } finally {
    await p.unroute("**/prop/production/parts?*").catch(() => undefined);
    await ctx.close().catch(() => undefined);
    await finishSession(browser, session, "verify-product-mgmt-d2");
    await cleanupFixtures();
    await db.close();
  }
}

main().catch(async (error) => {
  console.error("[product-d2] FAILED:", error);
  await cleanupFixtures().catch(() => undefined);
  await db.close().catch(() => undefined);
  process.exit(1);
});