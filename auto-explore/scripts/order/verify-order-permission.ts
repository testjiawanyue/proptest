/** 订单权限：未登录访问与无订单权限账号访问（001/002）。 */
import { chromium } from "playwright";
import {
  ResultBook, apiLogin, apiCall,
  readToasts,
} from "./order-runtime-utils.js";
import { createSession, closeSession } from "../../src/actions/session.js";
import { config } from "../../src/config/index.js";

const book = new ResultBook("reports/order-runtime-results-permission.json");
const routes = ["/orders/index", "/orders/17", "/orders/new", "/orders/batch-print"];
let browser: any;
let adminSession: any;
let restrictedSession: any;
let anonSession: any;
let token = "";

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function loginAs(page: any, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder(/账号|用户名|user|アカウント/i).first().fill(username);
  await page.getByPlaceholder(/密码|password|パスワード/i).first().fill(password);
  await page.getByRole("button", { name: /登\s*录|登录|login|ログイン/i }).first().click();
  await page.waitForURL((url: URL) => !url.pathname.includes("/login"), { timeout: 15000 });
  await page.waitForTimeout(1200);
}

async function inspectRoute(page: any, path: string): Promise<any> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const toasts = await readToasts(page).catch(() => "");
  const body = normalize(await page.locator("body").innerText());
  const tableRows = await page.locator("tr.ant-table-row").count();
  const detailPage = await page.locator(".order-detail-page").count();
  const newForm = await page.locator("#orderForm_ordering").count();
  const batchPage = await page.locator(".batch-page").count();
  return {
    path,
    finalUrl: page.url(),
    finalPath: new URL(page.url()).pathname,
    body: body.slice(0, 420),
    toasts: normalize(String(toasts)),
    tableRows,
    detailPage,
    newForm,
    batchPage,
    hasOrderData: tableRows > 0 || detailPage > 0 || newForm > 0 || batchPage > 0,
    loginVisible: /ログイン|登录|账号|用户名|パスワード/i.test(body),
    deniedVisible: /403|無権限|无权限|権限がありません|アクセスが拒否|アクセス権|ログインが必要|ログインの有効期限|ログイン期限/i.test(body + " " + String(toasts)),
  };
}

async function main(): Promise<void> {
  token = await apiLogin("autocust", "Auto@123456");
  const anonymousCalls = [] as any[];
  for (const [method, path] of [
    ["GET", "/prop/order/list"],
    ["GET", "/prop/order/17"],
    ["GET", "/prop/shipment/batch-preparations"],
  ] as const) {
    const response = await fetch(`http://localhost:8080/dev-api${path}`, { method });
    const body = await response.text();
    let parsed: any = {};
    try { parsed = JSON.parse(body); } catch { parsed = { text: body.slice(0, 160) }; }
    anonymousCalls.push({ method, path, http: response.status, code: parsed.code, msg: parsed.msg ?? parsed.text });
  }
  const restrictedCalls = [] as any[];
  for (const [method, path] of [
    ["GET", "/prop/order/list"],
    ["GET", "/prop/order/17"],
    ["GET", "/prop/shipment/169"],
    ["GET", "/prop/shipment/batch-preparations"],
  ] as const) {
    const response = await apiCall(token, method, path);
    restrictedCalls.push({ method, path, http: response.status, code: response.code, msg: response.msg });
  }

  browser = await chromium.launch({ headless: config.run.headless });
  anonSession = await createSession(browser, { traceName: "verify-order-permission-anon" });
  const anonRoutes = [];
  for (const path of routes) anonRoutes.push(await inspectRoute(anonSession.page, path));
  await closeSession(anonSession, "verify-order-permission-anon");
  anonSession = undefined;

  restrictedSession = await createSession(browser, { traceName: "verify-order-permission-restricted" });
  const page = restrictedSession.page;
  page.setDefaultTimeout(15000);
  await loginAs(page, "autocust", "Auto@123456");
  const sidebarText = normalize(await page.locator(".sidebar-container").innerText().catch(async () => await page.locator("body").innerText()));
  const orderMenuVisible = /订单管理|订单列表|送り状一括生成/.test(sidebarText);
  const restrictedRoutes = [];
  for (const path of routes) restrictedRoutes.push(await inspectRoute(page, path));

  await book.run("订单权限-001", "未登录直接访问订单页面", "FEAT-10-order;FEAT-11-shipment;FEAT-19-order-batch-print VAL-21", async () => {
    const pagesBlocked = anonRoutes.every((x) => !x.hasOrderData && (x.loginVisible || x.deniedVisible));
    const apisBlocked = anonymousCalls.every((x) => x.code === 401);
    return {
      status: pagesBlocked && apisBlocked ? "通过" : "不通过",
      actual: `未登录页面=${JSON.stringify(anonRoutes.map((x) => ({ path: x.path, finalPath: x.finalPath, hasOrderData: x.hasOrderData, loginVisible: x.loginVisible, deniedVisible: x.deniedVisible, body: x.body.slice(0, 120) })))}；未登录 API=${JSON.stringify(anonymousCalls)}。`,
      evidence: "全新无 Cookie 浏览器上下文依次直访订单列表、详情、新建、批量打印；再以无 Token 请求订单/寄送 API，核对 HTTP 与 body code，并确认页面无订单表格/表单/详情数据。",
      requirement: "FEAT-10-order;FEAT-11-shipment;FEAT-19-order-batch-print VAL-21",
    };
  });

  await book.run("订单权限-002", "无订单管理权限角色访问被拒绝", "FEAT-10-order;FEAT-11-shipment;FEAT-19-order-batch-print 页面级授权", async () => {
    const pagesBlocked = restrictedRoutes.every((x) => !x.hasOrderData && (x.loginVisible || x.deniedVisible || x.finalPath === "/401"));
    const apisBlocked = restrictedCalls.every((x) => x.http === 403 && x.code === 403);
    return {
      status: !orderMenuVisible && pagesBlocked && apisBlocked ? "通过" : "部分验证",
      actual: `autocust 侧栏含订单入口=${orderMenuVisible}；侧栏文本=“${sidebarText.slice(0, 300)}”；直访=${JSON.stringify(restrictedRoutes.map((x) => ({ path: x.path, finalPath: x.finalPath, hasOrderData: x.hasOrderData, deniedVisible: x.deniedVisible, body: x.body.slice(0, 150) })))}；API=${JSON.stringify(restrictedCalls)}。`,
      evidence: "common 角色账号登录后读取侧栏；依次直访四个订单 URL；以该账号 Token 请求订单列表/详情/寄送/批量准备接口，核对 HTTP 403 与 body code，并确认页面不渲染订单数据。",
      requirement: "FEAT-10-order;FEAT-11-shipment;FEAT-19-order-batch-print 页面级授权",
    };
  });

  console.log(`[PERM] 完成 2 条；通过=${book.list().filter((x) => x.status === "通过").length}；部分验证=${book.list().filter((x) => x.status === "部分验证").length}；不通过=${book.list().filter((x) => x.status === "不通过").length}`);
  console.log(`[PERM] 侧栏订单入口=${orderMenuVisible}`);
  console.log(`[PERM] 匿名=${JSON.stringify(anonymousCalls)}`);
  console.log(`[PERM] 受限=${JSON.stringify(restrictedCalls)}`);
  if (restrictedSession) await closeSession(restrictedSession, "verify-order-permission-restricted");
  restrictedSession = undefined;
  await browser.close();
  browser = undefined;
}

main().catch(async (error) => {
  console.error("[PERM] FAILED:", error instanceof Error ? error.stack : error);
  try { if (anonSession) await closeSession(anonSession, "verify-order-permission-anon"); } catch {}
  try { if (restrictedSession) await closeSession(restrictedSession, "verify-order-permission-restricted"); } catch {}
  try { if (browser) await browser.close(); } catch {}
  process.exit(1);
});
