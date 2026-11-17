/**
 * 基础设置：无权限角色访问验证（2 条）
 * 覆盖：部件资料-022（导航无入口 + 直接访问被拒）、作业选项-018（页面与写操作均被拒）。
 * 夹具：临时角色 AUTO-角色-无基础设置（仅客户管理菜单）+ 账号 autonoset，脚本结束自动删除。
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, finishSession, compact, apiLogin, apiCall,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook("reports/masterdata-runtime-results-permission-2.json");
const db = new DbClient();
const REQ = "FEAT-02/04 权限控制（部件资料/作业选项）";
const ROLE_KEY = "auto_noset";
const USER_NAME = "autonoset";

async function main(): Promise<void> {
  await db.connect();
  const adminToken = await apiLogin(config.app.loginUser, config.app.loginPassword);

  // ---- 夹具：无基础设置权限的角色与账号 ----
  let roleId: number;
  const existingRole = await db.query<{ role_id: number }>(
    "SELECT role_id FROM sys_role WHERE role_key=? AND del_flag='0'", [ROLE_KEY]);
  if (existingRole.length) {
    roleId = existingRole[0].role_id;
  } else {
    const created = await apiCall(adminToken, "POST", "/system/role", {
      roleName: "AUTO-角色-无基础设置", roleKey: ROLE_KEY, roleSort: 99, status: "0",
      menuIds: [2000], menuCheckStrictly: true,
    });
    if (created.code !== 200) throw new Error(`角色夹具失败：${created.msg}`);
    const rows = await db.query<{ role_id: number }>(
      "SELECT role_id FROM sys_role WHERE role_key=? AND del_flag='0'", [ROLE_KEY]);
    roleId = rows[0].role_id;
  }
  let userId: number;
  const existingUser = await db.query<{ user_id: number }>(
    "SELECT user_id FROM sys_user WHERE user_name=? AND del_flag='0'", [USER_NAME]);
  if (existingUser.length) {
    userId = existingUser[0].user_id;
  } else {
    const created = await apiCall(adminToken, "POST", "/system/user", {
      userName: USER_NAME, nickName: "AUTO-设置只读验证", password: "Auto@123456",
      status: "0", roleIds: [roleId], postIds: [], deptId: 100,
    });
    if (created.code !== 200) throw new Error(`账号夹具失败：${created.msg}`);
    const rows = await db.query<{ user_id: number }>(
      "SELECT user_id FROM sys_user WHERE user_name=? AND del_flag='0'", [USER_NAME]);
    userId = rows[0].user_id;
  }
  const userToken = await apiLogin(USER_NAME, "Auto@123456");

  const { browser, session } = await launchSession();
  const page = session.page;
  page.setDefaultTimeout(10000);
  try {
    await book.run("部件资料-022", "无基础设置权限的角色访问页面被拒绝", REQ, async () => {
      const ctx = await browser.newContext({ baseURL: config.app.baseUrl });
      const p = await ctx.newPage();
      await loginAs(p, USER_NAME, "Auto@123456");
      await p.waitForTimeout(1500);
      const menuText = compact(await p.locator("header, .top-menu").first().innerText().catch(() => ""));
      const noEntry = !menuText.includes("基础设置") && !menuText.includes("部件资料");
      await p.goto("/prop-settings/part-profile", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await p.waitForTimeout(1500);
      const body = compact(await p.locator("body").innerText().catch(() => ""));
      const blocked = p.url().includes("/404") || /404|権限|権限が|許可|页面不存在|見つかりません/.test(body);
      const noData = !body.includes("部品名") || !body.includes("新規作成");
      const create = await apiCall(userToken, "POST", "/prop/part-profile", {
        partType: "jacket", partName: "AUTO-PERM-PP", specification: "x", manufacturer: "", numberPrefix: "",
      });
      const leak = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_part_profile_version WHERE part_name='AUTO-PERM-PP'");
      await ctx.close();
      const ok = noEntry && blocked && noData && create.code !== 200 && Number(leak[0].cnt) === 0;
      return {
        status: ok ? "通过" : "不通过",
        actual: `autonoset（无基础设置权限）：顶部菜单无「基础设置/部件资料」=${noEntry}；直接访问 /prop-settings/part-profile → ${blocked ? "被拒（404/无权限页）" : "页面可访问"}，业务数据不展示=${noData}；新建接口 code=${create.code}「${compact(create.msg, 40)}」，DB 无 AUTO-PERM-PP`,
        evidence: "sys_role_menu 仅授客户管理菜单 + @PreAuthorize('prop:partProfile:page')",
      };
    });

    await book.run("作业选项-018", "无权限用户不能新增或停用选项", REQ, async () => {
      const before = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_work_option");
      const add = await apiCall(userToken, "POST", "/prop/work-option", {
        optionCategory: "disposition", workGroup: "sewing", displayValue: "AUTO-PERM-WO",
      });
      const target = await db.query<{ option_id: number; status: string }>(
        "SELECT option_id, status FROM prop_work_option WHERE option_id=15");
      const disable = await apiCall(userToken, "PUT", `/prop/work-option/15/status?status=1`);
      const after = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_work_option");
      const statusAfter = await db.query<{ status: string }>(
        "SELECT status FROM prop_work_option WHERE option_id=15");
      const rejected = add.code !== 200 && disable.code !== 200;
      const unchanged = Number(before[0].cnt) === Number(after[0].cnt) &&
        target[0].status === statusAfter[0].status;
      const ok = rejected && unchanged;
      return {
        status: ok ? "通过" : "不通过",
        actual: `autonoset：新增选项 code=${add.code}「${compact(add.msg, 30)}」、停用选项#15 code=${disable.code}「${compact(disable.msg, 30)}」；清单总数 ${before[0].cnt}→${after[0].cnt}、#15 状态 ${target[0].status}→${statusAfter[0].status} 均不变`,
        evidence: "服务端 @PreAuthorize 拒绝写操作（prop:workOption:page）",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-md-permission-2");
    // 清理临时账号与角色（sys 表夹具）
    await apiCall(adminToken, "DELETE", `/system/user/${userId}`);
    await apiCall(adminToken, "DELETE", `/system/role/${roleId}`);
    const leftUser = await db.query<{ cnt: number }>(
      "SELECT COUNT(*) cnt FROM sys_user WHERE user_id=? AND del_flag='0'", [userId]);
    const leftRole = await db.query<{ cnt: number }>(
      "SELECT COUNT(*) cnt FROM sys_role WHERE role_id=? AND del_flag='0'", [roleId]);
    console.log(`夹具清理：用户残留=${leftUser[0].cnt} 角色残留=${leftRole[0].cnt}`);
    await db.close();
    await book.save();
    console.log("---- VERDICT ----");
    for (const r of book.list()) console.log(`${r.caseId}: ${r.status}`);
  }
}

async function launchSession() {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-md-permission-2" });
  await login(session.page);
  return { browser, session };
}

async function loginAs(page: import("playwright").Page, user: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder(/账号|用户名|user|アカウント/i).first().fill(user);
  await page.getByPlaceholder(/密码|password|パスワード/i).first().fill(password);
  await page.getByRole("button", { name: /登\s*录|登录|login|ログイン/i }).first().click();
  await page.waitForURL((url: URL) => !url.pathname.includes("/login"), { timeout: 15000 });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});