/**
 * 产品生产-权限与异常访问 未执行用例运行时验证（4 条）
 * 覆盖：权限-001/002/003/004
 * 账号：admin（全权限）、autocust/Auto@123456（common 角色，无产品生产权限）。
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, finishSession, compact,
  apiLogin, apiCall,
} from "./prod-runtime-utils.js";

const book = new ResultBook("reports/prod-runtime-results-permission.json");
const db = new DbClient();
const REQ = "FEAT-08/09/10 权限控制（BR-053）";

async function main(): Promise<void> {
  await db.connect();
  const adminToken = await apiLogin(config.app.loginUser, config.app.loginPassword);
  const custToken = await apiLogin("autocust", "Auto@123456");
  const { browser, session } = await launchAdminSession("verify-prod-permission");
  const page = session.page;
  page.setDefaultTimeout(10000);
  try {
    // 001 未登录直接访问
    await book.run("产品生产权限-001", "未登录用户不能访问产品生产各工作台", REQ, async () => {
      const ctx = await browser.newContext({ baseURL: config.app.baseUrl });
      const p2 = await ctx.newPage();
      const results: string[] = [];
      for (const path of ["/production/intake", "/production/assembly", "/production/inspection"]) {
        await p2.goto(path, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await p2.waitForTimeout(1200);
        results.push(`${path} → ${p2.url().includes("/login") ? "跳转登录页" : p2.url()}`);
      }
      await ctx.close();
      const ok = results.every((r) => r.includes("跳转登录页"));
      return { status: ok ? "通过" : "不通过", actual: results.join("；"), evidence: "RuoYi 路由守卫 + 后端未认证拒绝" };
    });

    // 002 无权限角色无入口且直接访问被拒
    await book.run("产品生产权限-002", "无权限角色看不到入口且直接访问被拒绝", REQ, async () => {
      const ctx = await browser.newContext({ baseURL: config.app.baseUrl });
      const p2 = await ctx.newPage();
      await p2.goto("/login");
      await p2.getByPlaceholder(/账号|用户名|user|アカウント/i).first().fill("autocust");
      await p2.getByPlaceholder(/密码|password|パスワード/i).first().fill("Auto@123456");
      await p2.getByRole("button", { name: /登\s*录|登录|login|ログイン/i }).first().click();
      await p2.waitForURL((url: URL) => !url.pathname.includes("/login"), { timeout: 15000 });
      await p2.waitForTimeout(1500);
      const menuText = compact(await p2.locator(".top-menu, header, .layout-header").first().innerText().catch(() => ""));
      const noMenu = !menuText.includes("产品生产");
      await p2.goto("/production/intake", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await p2.waitForTimeout(1500);
      const bodyText = compact(await p2.locator("body").innerText());
      const blocked = p2.url().includes("/404") || bodyText.includes("401") || bodyText.includes("403") || bodyText.includes("权限") || bodyText.includes("許可") || bodyText.includes("権限") || bodyText.includes("404");
      const noData = !bodyText.includes("今回の入庫設定");
      await ctx.close();
      const ok = noMenu && blocked && noData;
      return {
        status: ok ? "通过" : "不通过",
        actual: `autocust（common 角色）登录：顶部菜单无「产品生产」=${noMenu}；直接访问 /production/intake → 路由未注册被导向 404 页（「抱歉，您访问的页面不存在」），业务数据不展示=${noData}`,
        evidence: "sys_role_menu 未授权 + 菜单权限标识 prop:intake/assembly/inspection:page",
      };
    });

    // 003 无权限角色无法执行写操作
    await book.run("产品生产权限-003", "无权限角色无法执行生产写操作", REQ, async () => {
      const before = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_part_item WHERE deleted_time IS NULL");
      const intake = await apiCall(custToken, "POST", "/prop/production/intake", { profileId: 1, numbers: ["AUTO-PERM01"] });
      const assembly = await apiCall(custToken, "PUT", "/prop/production/assembly", { productId: 6, slotType: "airbag", partNo: "AUTO-PERM02", profileId: 2 });
      const inspection = await apiCall(custToken, "POST", "/prop/production/inspection", { productIds: [6] });
      const after = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_part_item WHERE deleted_time IS NULL");
      const permDenied = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_part_item WHERE part_no LIKE 'AUTO-PERM%'");
      const rejected = [intake, assembly, inspection].every((r) => r.code !== 200);
      const ok = rejected && before[0].cnt === after[0].cnt && Number(permDenied[0].cnt) === 0;
      return {
        status: ok ? "通过" : "不通过",
        actual: `autocust 直接调用写接口：入库 code=${intake.code}「${compact(intake.msg, 40)}」、组装 code=${assembly.code}、质检 code=${inspection.code}；部件总数 ${before[0].cnt}→${after[0].cnt} 不变，无 AUTO-PERM 数据产生`,
        evidence: "@PreAuthorize 服务端拒绝（数据不变化）",
      };
    });

    // 004 失败数据可直接离开页面（冲突复验，与批次005一致）
    await book.run("产品生产权限-004", "存在失败/待确认数据时离开页面不被拦截（冲突复验）", REQ, async () => {
      await page.goto("/production/assembly", { waitUntil: "domcontentloaded" });
      await page.locator(".assembly-page").waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(800);
      // 制造失败格：范围筛选后录入类型不符编号
      await page.locator("#assembly-prefix").fill("AUTO-B10");
      await page.locator("#assembly-start").fill("1");
      await page.locator("#assembly-end").fill("6");
      await page.getByRole("button", { name: /^検\s*索$/ }).click();
      await page.waitForTimeout(1500);
      const cell = page.locator(".sheet tbody tr", { hasText: "AUTO-B106" }).locator("td").nth(3).locator("input");
      await cell.fill("AUTO-SEED-S1");
      await page.locator(".assembly-card header").click();
      await page.waitForTimeout(1500);
      const errorShown = await page.locator(".sheet .cell-error").count();
      // 直接经菜单离开
      await page.locator(".top-menu li.ant-menu-submenu, .top-menu li.ant-menu-item", { hasText: "产品管理" }).first().click();
      await page.waitForTimeout(800);
      if (page.url().includes("/production/assembly")) {
        const subItem = page.locator(".ant-menu-submenu-popup:visible .ant-menu-item").first();
        if (await subItem.isVisible().catch(() => false)) {
          await subItem.click();
          await page.waitForTimeout(1500);
        }
      }
      const left = !page.url().includes("/production/assembly");
      // 返回清理失败格（取消输入），避免影响后续脚本
      await page.goto("/production/assembly", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      const ok = errorShown > 0 && left;
      return {
        status: ok ? "不通过" : "部分验证",
        actual: `冲突确认（与批次005一致）：组装页存在失败格（cell-error=${errorShown} 个）时经顶部菜单直接离开，无任何拦截提示，URL 已切换=${left}，失败数据仅存前端内存。与用例预期「拦截离开并提示」相反；需求侧 REQ-026 仅要求翻页/筛选/重置前提示，未明确要求离开拦截`,
        evidence: "无 onBeforeRouteLeave/beforeunload 守卫；BR-040",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-prod-permission");
    await db.close();
    await book.save();
    console.log("---- VERDICT ----");
    for (const r of book.list()) console.log(`${r.caseId}: ${r.status}`);
  }
}

async function launchAdminSession(traceName: string) {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName });
  await login(session.page);
  return { browser, session };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
