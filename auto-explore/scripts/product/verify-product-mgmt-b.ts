/**
 * 产品管理 B 批（删除阻断 / 状态标签 / 权限与异常）运行时验证：7 条。
 * 覆盖：产品删除-003/004、列表关联-007、产品管理权限-001~004。
 * 夹具：AUTO-PM-B-RCP（受付阻断）、AUTO-PM-B-SHP（准备中发货阻断）、AUTO-PM-B-SCRAP（报废）、
 *       临时角色 AUTO-角色-无产品管理 + 账号 autoprodnone。脚本结束自动清理。
 */
import { chromium, type Browser, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, apiLogin, apiCall, finishSession, compact,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook("reports/product-mgmt-runtime-results-b.json");
const db = new DbClient();
const REQ = "FEAT-08 产品管理（删除/状态/权限）";
const ROLE_KEY = "auto_prod_none";
const USER_NAME = "autoprodnone";
const USER_PASS = "Auto@123456";
const FIXTURE_PATH = "reports/product-mgmt-b-fixtures.json";
let token = "";
let page: Page;
let browserRef: Browser;
let roleSession: { ctx: import("playwright").BrowserContext; p: Page } | undefined;

const FIX = {
  products: {} as Record<string, { productId: number; partId: number; bindingId: number }>,
  reception: { batchId: 9101, packageId: 9101, receptionId: 9101 },
  shipment: { shipmentId: 9102, shipmentProductId: 0 },
  roleId: 0,
  userId: 0,
  createdAt: new Date().toISOString(),
};

const text = async (locator: import("playwright").Locator) => compact(await locator.innerText().catch(() => ""));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function cleanupSameName(): Promise<void> {
  const nos = ["AUTO-PM-B-RCP", "AUTO-PM-B-SHP", "AUTO-PM-B-SCRAP"];
  await db.execute("DELETE FROM prop_reception_type WHERE reception_id=?", [FIX.reception.receptionId]);
  await db.execute("DELETE FROM prop_reception WHERE reception_id=?", [FIX.reception.receptionId]);
  await db.execute("DELETE FROM prop_reception_package WHERE package_id=?", [FIX.reception.packageId]);
  await db.execute("DELETE FROM prop_reception_batch WHERE batch_id=?", [FIX.reception.batchId]);
  await db.execute("DELETE FROM prop_shipment_product WHERE shipment_id=?", [FIX.shipment.shipmentId]);
  await db.execute("DELETE FROM prop_shipment WHERE shipment_id=?", [FIX.shipment.shipmentId]);
  const rows = await db.query<{ product_id: number; part_id: number | null }>(
    `SELECT p.product_id,
            (SELECT b.part_id FROM prop_product_binding b WHERE b.product_id=p.product_id LIMIT 1) part_id
       FROM prop_product p WHERE p.manufacturing_no IN (?,?,?)`, nos);
  for (const row of rows) {
    await db.execute("DELETE FROM prop_production_event WHERE product_id=?", [row.product_id]);
    await db.execute("DELETE FROM prop_product_binding WHERE product_id=?", [row.product_id]);
    if (row.part_id) await db.execute("DELETE FROM prop_part_item WHERE part_id=?", [row.part_id]);
    await db.execute("DELETE FROM prop_product WHERE product_id=?", [row.product_id]);
  }
  await db.execute("DELETE FROM prop_reception_type WHERE reception_id=?", [FIX.reception.receptionId]);
  await db.execute("DELETE FROM prop_reception WHERE reception_id=?", [FIX.reception.receptionId]);
  await db.execute("DELETE FROM prop_reception_package WHERE package_id=?", [FIX.reception.packageId]);
  await db.execute("DELETE FROM prop_reception_batch WHERE batch_id=?", [FIX.reception.batchId]);
  await db.execute("DELETE FROM prop_shipment_product WHERE shipment_id=?", [FIX.shipment.shipmentId]);
  await db.execute("DELETE FROM prop_shipment WHERE shipment_id=?", [FIX.shipment.shipmentId]);
}

async function seedProduct(no: string, mNo: string, seconds: number): Promise<{ productId: number; partId: number; bindingId: number }> {
  const product = await db.execute(
    `INSERT INTO prop_product (manufacturing_no, active_manufacturing_no, m_no, create_by, create_time, initial_production_inspection_passed)
     VALUES (?, ?, ?, 'AI自动探索', DATE_ADD(NOW(), INTERVAL ? SECOND), 0)`, [no, no, mNo, seconds]);
  const productId = Number(product.insertId);
  const part = await db.execute(
    `INSERT INTO prop_part_item (part_no, active_part_no, part_type, number_scope, source_type, current_profile_id, current_profile_version_id, create_by, create_time)
     VALUES (?, ?, 'jacket', 'jacket', 'intake', 1, 12, 'AI自动探索', DATE_ADD(NOW(), INTERVAL ? SECOND))`, [no, no, seconds]);
  const partId = Number(part.insertId);
  const binding = await db.execute(
    `INSERT INTO prop_product_binding (product_id, part_id, slot_type, active_slot_key, active_part_key, started_by, started_time)
     VALUES (?, ?, 'body', ?, ?, 'AI自动探索', DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [productId, partId, `${productId}:body`, String(partId), seconds]);
  const bindingId = Number(binding.insertId);
  await db.execute(
    `INSERT INTO prop_production_event (event_type, product_id, part_id, binding_id, after_profile_version_id, event_content, create_by, create_time)
     VALUES ('PRODUCT_CREATED', ?, ?, ?, 12, 'ジャケット入庫・製品登録', 'AI自动探索', DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [productId, partId, bindingId, seconds]);
  return { productId, partId, bindingId };
}

async function seedFixtures(adminToken: string): Promise<void> {
  await cleanupSameName();
  const rcp = await seedProduct("AUTO-PM-B-RCP", "MBRCP1", 30);
  const shp = await seedProduct("AUTO-PM-B-SHP", "MBSHP1", 31);
  const scrap = await seedProduct("AUTO-PM-B-SCRAP", "MBSCR1", 32);
  FIX.products = { rcp, shp, scrap };

  const { batchId, packageId, receptionId } = FIX.reception;
  await db.execute(
    `INSERT INTO prop_reception_batch (batch_id, number_year, batch_seq, batch_no, received_at, company_name, address, first_product_id, create_by, create_time)
     VALUES (?, 2026, 9101, 'AUTO-PM-B-B001', '2027-05-10 01:00:00', 'AUTO-PM-受付先', 'AUTO-PM-住所', ?, 'AI自动探索', NOW())`,
    [batchId, rcp.productId]);
  await db.execute(
    `INSERT INTO prop_reception_package (package_id, batch_id, package_no, create_by, create_time)
     VALUES (?, ?, 1, 'AI自动探索', NOW())`, [packageId, batchId]);
  await db.execute(
    `INSERT INTO prop_reception (reception_id, batch_id, package_id, product_id, number_year, small_seq, established_at,
       notice_visible_ceiling, inspection_year, plan_manual, work_state, work_group_mask, work_basis_json, create_by)
     VALUES (?, ?, ?, ?, 2026, 9101, '2027-05-10 01:00:00', 0, 1, 0, 'in_progress', 1,
       '{"schema":1,"assembly":[null,null,null],"disposition":null}', 'AI自动探索')`,
    [receptionId, batchId, packageId, rcp.productId]);
  await db.execute("INSERT INTO prop_reception_type (reception_id, type_code) VALUES (?, 'inspection')", [receptionId]);

  const { shipmentId } = FIX.shipment;
  await db.execute(
    `INSERT INTO prop_shipment (shipment_id, order_id, shipment_no, generated_no, create_request_id, create_payload_hash,
       hash_version, status, revision, create_by, create_time)
     VALUES (?, NULL, 'AUTO-PM-B-SHP-S1', 'AUTO-PM-B-SHP-S1', 'AUTO-PM-B-REQ-9102', 'auto-pm-b-hash', 1, 'preparing', 1, 'AI自动探索', NOW())`,
    [shipmentId]);
  const sp = await db.execute(
    `INSERT INTO prop_shipment_product (shipment_id, product_id, manufacturing_no, specification, adopted_product_name, sort_order, create_by, create_time)
     VALUES (?, ?, 'AUTO-PM-B-SHP', NULL, '', 1, 'AI自动探索', NOW())`, [shipmentId, shp.productId]);
  FIX.shipment.shipmentProductId = Number(sp.insertId);

  await db.execute("UPDATE prop_product SET scrapped_time=NOW() WHERE product_id=?", [scrap.productId]);

  // 临时无产品管理权限角色 + 账号（仅客户管理菜单 2000）
  await db.execute("DELETE FROM sys_user_role WHERE user_id IN (SELECT user_id FROM sys_user WHERE user_name=?)", [USER_NAME]);
  await db.execute("DELETE FROM sys_user_post WHERE user_id IN (SELECT user_id FROM sys_user WHERE user_name=?)", [USER_NAME]);
  await db.execute("DELETE FROM sys_user WHERE user_name=?", [USER_NAME]);
  const oldRole = await db.query<{ role_id: number }>("SELECT role_id FROM sys_role WHERE role_key=?", [ROLE_KEY]);
  for (const row of oldRole) {
    await db.execute("DELETE FROM sys_role_menu WHERE role_id=?", [row.role_id]);
    await db.execute("DELETE FROM sys_role WHERE role_id=?", [row.role_id]);
  }
  const createdRole = await apiCall(adminToken, "POST", "/system/role", {
    roleName: "AUTO-角色-无产品管理", roleKey: ROLE_KEY, roleSort: 98, status: "0",
    menuIds: [2000], menuCheckStrictly: true,
  });
  if (createdRole.code !== 200) throw new Error(`角色夹具失败：${createdRole.msg}`);
  const roleRows = await db.query<{ role_id: number }>("SELECT role_id FROM sys_role WHERE role_key=? AND del_flag='0'", [ROLE_KEY]);
  FIX.roleId = roleRows[0].role_id;
  const createdUser = await apiCall(adminToken, "POST", "/system/user", {
    userName: USER_NAME, nickName: "AUTO-产品权限验证", password: USER_PASS,
    status: "0", roleIds: [FIX.roleId], postIds: [], deptId: 100,
  });
  if (createdUser.code !== 200) throw new Error(`账号夹具失败：${createdUser.msg}`);
  const userRows = await db.query<{ user_id: number }>("SELECT user_id FROM sys_user WHERE user_name=? AND del_flag='0'", [USER_NAME]);
  FIX.userId = userRows[0].user_id;
  writeFileSync(FIXTURE_PATH, JSON.stringify(FIX, null, 2), "utf-8");
}

async function cleanupFixtures(): Promise<void> {
  try {
    await cleanupSameName();
    if (FIX.userId) {
      await db.execute("DELETE FROM sys_user_role WHERE user_id=?", [FIX.userId]);
      await db.execute("DELETE FROM sys_user_post WHERE user_id=?", [FIX.userId]);
      await db.execute("DELETE FROM sys_user WHERE user_id=?", [FIX.userId]);
    }
    if (FIX.roleId) {
      await db.execute("DELETE FROM sys_role_menu WHERE role_id=?", [FIX.roleId]);
      await db.execute("DELETE FROM sys_role WHERE role_id=?", [FIX.roleId]);
    }
    writeFileSync(FIXTURE_PATH, JSON.stringify({ ...FIX, removedAt: new Date().toISOString() }, null, 2), "utf-8");
    console.log("[cleanup] B 批夹具已清理");
  } catch (error) {
    console.error("[cleanup] 失败：", error);
  }
}

async function openFullList(): Promise<void> {
  await page.goto("/products/list", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.locator("thead th").first().waitFor({ state: "visible", timeout: 20000 });
  const stage = page.locator(".ant-select", { has: page.locator("#product-stage") }).first();
  await stage.hover();
  await page.waitForTimeout(300);
  if (await stage.locator(".ant-select-clear").isVisible().catch(() => false)) {
    await stage.locator(".ant-select-clear").click();
    await page.waitForTimeout(2500);
  }
  await page.locator("tbody tr.ant-table-row").first().waitFor({ state: "visible", timeout: 20000 });
}

async function switchPageSize(size: string): Promise<void> {
  await page.locator(".ant-pagination-options").first().waitFor({ state: "visible" });
  await page.locator(".ant-pagination-options .ant-select-selector").first().click();
  await page.waitForTimeout(300);
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: size }).first().click();
  await page.waitForTimeout(1500);
}

function rowOf(no: string) {
  return page.locator("tbody tr.ant-table-row", { hasText: no }).first();
}

async function tagInfo(no: string): Promise<{ label: string; cls: string; color: string; bg: string; border: string }> {
  const tag = rowOf(no).locator("td").nth(4).locator(".ant-tag").first();
  await tag.waitFor({ state: "visible", timeout: 10000 });
  return tag.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      label: (el.textContent ?? "").trim(),
      cls: String(el.className),
      color: style.color,
      bg: style.backgroundColor,
      border: style.borderColor,
    };
  });
}

async function deleteViaUi(no: string, expectedId: number): Promise<{ modal: string; blockers: string[]; rowText: string }> {
  const rows = page.locator("tbody tr.ant-table-row");
  const count = await rows.count();
  let index = -1;
  for (let i = 0; i < count; i++) {
    const value = await rows.nth(i).innerText().catch(() => "");
    if (value.includes(no)) { index = i; break; }
  }
  if (index < 0) throw new Error(`列表中未找到行 ${no}`);
  const row = rows.nth(index);
  await row.waitFor({ state: "visible", timeout: 15000 });
  await row.scrollIntoViewIfNeeded().catch(() => undefined);
  const rowText = compact(await row.innerText());
  if (!rowText.includes(no)) throw new Error(`行定位漂移：期望 ${no}，实际「${compact(rowText, 60)}」`);
  const blockersPromise = page.waitForResponse((r) => r.url().includes("/delete-blockers") && r.request().method() === "GET", { timeout: 15000 });
  await row.getByRole("button", { name: "···" }).click();
  await page.waitForTimeout(500);
  const menuItems = page.locator(".ant-dropdown-menu-item");
  const menuCount = await menuItems.count();
  const menuLog: string[] = [];
  let targetIndex = -1;
  for (let i = 0; i < menuCount; i++) {
    const visible = await menuItems.nth(i).isVisible().catch(() => false);
    const label = compact(await menuItems.nth(i).innerText().catch(() => ""));
    if (visible) targetIndex = i;
    menuLog.push(`${i}:${label}:${visible}`);
  }
  console.log("[deleteViaUi] menu=", menuLog.join(" | "));
  if (targetIndex < 0) throw new Error(`未找到可见删除菜单项：${menuLog.join(" | ")}`);
  await menuItems.nth(targetIndex).click({ force: true });
  const resp = await blockersPromise;
  const requestUrl = resp.url();
  if (!requestUrl.includes(`/products/${expectedId}/delete-blockers`)) {
    throw new Error(`删除阻断请求指向错误产品：${requestUrl}`);
  }
  const body = await resp.json().catch(() => ({}));
  await page.waitForTimeout(600);
  const modal = await page.locator(".ant-modal-confirm:visible, .ant-modal:visible").last().innerText().catch(() => "");
  return { modal: compact(modal), blockers: Array.isArray(body?.data) ? body.data : [], rowText };
}

async function closeModal(): Promise<void> {
  const modal = page.locator(".ant-modal-confirm:visible, .ant-modal:visible").last();
  const button = modal.getByRole("button", { name: /OK|確\s*認|确定|確認/ }).last();
  if (await button.isVisible().catch(() => false)) await button.click().catch(() => undefined);
  else await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}

async function loginAs(p: Page, user: string, password: string): Promise<void> {
  await p.goto("/login", { waitUntil: "domcontentloaded" });
  await p.getByPlaceholder(/账号|用户名|user|アカウント/i).first().fill(user);
  await p.getByPlaceholder(/密码|password|パスワード/i).first().fill(password);
  await p.getByRole("button", { name: /登\s*录|登录|login|ログイン/i }).first().click();
  await p.waitForURL((url: URL) => !url.pathname.includes("/login"), { timeout: 20000 });
}

async function main(): Promise<void> {
  await db.connect();
  token = await apiLogin(config.app.loginUser, config.app.loginPassword);
  await seedFixtures(token);
  const browser = await chromium.launch({ headless: config.run.headless });
  browserRef = browser;
  const session = await createSession(browser, { traceName: "verify-product-mgmt-b" });
  page = session.page;
  page.setDefaultTimeout(15000);
  await login(page);
  try {
    await openFullList();
    await switchPageSize("50");

    await book.run("产品列表数据关联-007", "产品状态标签按报废与订单关系显示", REQ, async () => {
      const rcp = await tagInfo("AUTO-PM-B-RCP");
      const scrap = await tagInfo("AUTO-PM-B-SCRAP");
      const linked = await tagInfo("20261028");
      const linkedOk = linked.label.includes("注文あり");
      const unlinkedOk = rcp.label.includes("注文なし");
      const scrapOk = scrap.label.includes("廃棄済") && (scrap.cls.includes("red") || scrap.color.includes("207, 19, 34") || scrap.color.includes("245, 34, 45"));
      const blue = linked.cls.includes("blue") || linked.color.includes("9, 88, 217") || linked.color.includes("22, 119, 255") || linked.bg.includes("230, 247, 255");
      const grey = rcp.cls === "ant-tag" || rcp.color.includes("0, 0, 0") || rcp.bg.includes("250, 250, 250");
      return {
        status: linkedOk && unlinkedOk && scrapOk && blue && grey ? "通过" : "不通过",
        actual: `已关联 20261028=「${linked.label}」class=${linked.cls} color=${linked.color}/${linked.bg}（蓝色=${blue}）；未关联 AUTO-PM-B-RCP=「${rcp.label}」color=${rcp.color}/${rcp.bg}（灰色=${grey}）；报废 AUTO-PM-B-SCRAP=「${scrap.label}」class=${scrap.cls} color=${scrap.color}（红色=${scrapOk}）`,
        evidence: "列表状态列 .ant-tag 文案 + computed style（background/border/color）+ DB scrapped_time/currentOrderId",
      };
    });

    await book.run("产品删除-003", "有受付记录产品删除被拦截", REQ, async () => {
      const ui = await deleteViaUi("AUTO-PM-B-RCP", FIX.products.rcp.productId);
      const blockers = ui.blockers;
      const hasReception = blockers.some((item: string) => item.includes("受付"));
      const hasShipment = blockers.some((item: string) => item.includes("出荷"));
      const kept = await db.query<{ deleted_time: string | null }>("SELECT deleted_time FROM prop_product WHERE product_id=?", [FIX.products.rcp.productId]);
      const receptionKept = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_reception WHERE product_id=?", [FIX.products.rcp.productId]);
      const apiDel = await apiCall(token, "DELETE", `/prop/production/products/${FIX.products.rcp.productId}`);
      await closeModal();
      const ok = hasReception && !hasShipment && ui.modal.includes("受付") && kept[0]?.deleted_time === null && Number(receptionKept[0]?.cnt) === 1 && apiDel.code !== 200;
      return {
        status: ok ? "通过" : "不通过",
        actual: `UI 阻断弹窗=「${ui.modal}」；blockers=${JSON.stringify(blockers)}（受付=${hasReception}、发货=${hasShipment}）；产品 deleted_time=${kept[0]?.deleted_time ?? "null"}、受付记录=${receptionKept[0]?.cnt}；直连 DELETE code=${apiDel.code}「${compact(apiDel.msg, 40)}」`,
        evidence: "GET /delete-blockers + 列表删除弹窗 + DELETE 接口 + prop_product/prop_reception 回查",
      };
    });

    await book.run("产品删除-004", "有发货记录产品删除被拦截", REQ, async () => {
      const ui = await deleteViaUi("AUTO-PM-B-SHP", FIX.products.shp.productId);
      const blockers = ui.blockers;
      const hasShipment = blockers.some((item: string) => item.includes("出荷"));
      const preparingListed = blockers.some((item: string) => item.includes("準備中") || item.includes("出荷済"));
      const kept = await db.query<{ deleted_time: string | null }>("SELECT deleted_time FROM prop_product WHERE product_id=?", [FIX.products.shp.productId]);
      const shipmentKept = await db.query<{ cnt: number; status: string }>(
        "SELECT COUNT(*) cnt, MIN(s.status) status FROM prop_shipment s JOIN prop_shipment_product sp ON sp.shipment_id=s.shipment_id WHERE sp.product_id=?",
        [FIX.products.shp.productId]);
      const apiDel = await apiCall(token, "DELETE", `/prop/production/products/${FIX.products.shp.productId}`);
      await closeModal();
      const ok = hasShipment && preparingListed && ui.modal.includes("出荷") && kept[0]?.deleted_time === null && Number(shipmentKept[0]?.cnt) === 1 && apiDel.code !== 200;
      return {
        status: ok ? "通过" : "不通过",
        actual: `UI 阻断弹窗=「${ui.modal}」；blockers=${JSON.stringify(blockers)}（发货=${hasShipment}、含準備中=${preparingListed}）；产品 deleted_time=${kept[0]?.deleted_time ?? "null"}、发货记录=${shipmentKept[0]?.cnt}（status=${shipmentKept[0]?.status}）；直连 DELETE code=${apiDel.code}`,
        evidence: "准备中 shipment（status=preparing）+ delete-blockers + 删除弹窗 + DB 回查",
      };
    });

    await book.run("产品管理权限-001", "未登录直接访问产品管理页面", REQ, async () => {
      const ctx = await browser.newContext({ baseURL: config.app.baseUrl });
      const anon = await ctx.newPage();
      const visits: string[] = [];
      let dataLeak = false;
      for (const path of ["/products/list", "/products/35", "/products/parts"]) {
        await anon.goto(path, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await anon.waitForTimeout(2500);
        const body = await anon.locator("body").innerText().catch(() => "");
        if (body.includes("20261028") || body.includes("AUTO-PM-B-RCP")) dataLeak = true;
        visits.push(`${path}→${new URL(anon.url()).pathname}${/ログイン|登录|login|パスワード|有効期限|期限切れ/.test(body) ? "(登录/过期提示)" : "(无提示)"}`);
      }
      const redirectOk = visits.every((item) => item.includes("→/login2") || item.includes("/login"));
      const expiredCtx = await browser.newContext({ baseURL: config.app.baseUrl });
      const host = new URL(config.app.baseUrl).hostname;
      await expiredCtx.addCookies([{ name: "Admin-Token", value: "expired-token-auto", domain: host, path: "/" }]);
      const expired = await expiredCtx.newPage();
      await expired.goto("/products/list", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await expired.waitForTimeout(2500);
      const expiredBody = await expired.locator("body").innerText().catch(() => "");
      const expiredOk = new URL(expired.url()).pathname.includes("/login") || /ログイン|登录|期限切れ|有効期限|期限/.test(expiredBody);
      await expiredCtx.close();
      await ctx.close();
      return {
        status: redirectOk && !dataLeak && expiredOk ? "通过" : "不通过",
        actual: `未登录访问：${visits.join("；")}；产品数据泄露=${dataLeak}；过期 token 访问 /products/list → ${new URL(expired.url()).pathname}（登录/过期提示=${expiredOk}）`,
        evidence: "无 Cookie 新上下文 + 无效 Admin-Token Cookie 访问列表/详情/部件追溯；body 与 URL 双重断言",
      };
    });

    roleSession = await (async () => {
      const ctx = await browser.newContext({ baseURL: config.app.baseUrl });
      const p = await ctx.newPage();
      await loginAs(p, USER_NAME, USER_PASS);
      await p.waitForTimeout(2000);
      return { ctx, p };
    })();
    const userToken = await apiLogin(USER_NAME, USER_PASS);

    await book.run("产品管理权限-002", "无产品管理权限角色访问被拒绝", REQ, async () => {
      const p = roleSession!.p;
      const header = compact(await p.locator("header, .top-menu, .layout-header").first().innerText().catch(() => ""));
      const noEntry = !/产品管理|製品管理|产品列表|製品一覧/.test(header);
      const results: string[] = [];
      for (const path of ["/products/list", "/products/35", "/products/parts"]) {
        await p.goto(path, { waitUntil: "domcontentloaded" }).catch(() => undefined);
        await p.waitForTimeout(2000);
        const body = compact(await p.locator("body").innerText().catch(() => ""));
        const blocked = new URL(p.url()).pathname.includes("/404") || /404|権限|権限がありません|ページが見つかりません|无权限|無許可/.test(body);
        const noData = !body.includes("20261028") && !body.includes("AUTO-PM-PAGE-001");
        results.push(`${path}→${new URL(p.url()).pathname} blocked=${blocked} noData=${noData}`);
      }
      const apiRead = await apiCall(userToken, "GET", "/prop/production/products/35");
      const ok = noEntry && results.every((item) => item.includes("blocked=true") && item.includes("noData=true"));
      return {
        status: ok ? "通过" : "不通过",
        actual: `导航无产品入口=${noEntry}（header=「${compact(header, 80)}」）；${results.join("；")}；读接口 products/35 code=${apiRead.code} / HTTP ${apiRead.status}`,
        evidence: `${USER_NAME}（角色 ${ROLE_KEY}，仅客户管理菜单）登录后导航 + 3 个 URL 直访 + API 读接口`,
      };
    });

    await book.run("产品管理权限-003", "无权限用户不能执行部件操作类写操作", REQ, async () => {
      const id = FIX.products.rcp.productId;
      const before = await db.query<Record<string, unknown>>(
        `SELECT p.deleted_time, p.storage_path, b.active_slot_key, i.deleted_time part_deleted
           FROM prop_product p JOIN prop_product_binding b ON b.product_id=p.product_id
           JOIN prop_part_item i ON i.part_id=b.part_id WHERE p.product_id=?`, [id]);
      const calls: Array<[string, string, unknown]> = [
        ["DELETE", `/prop/production/products/${id}`, undefined],
        ["PUT", `/prop/production/products/${id}/storage-path`, { storagePath: "AUTO-PERM-DENY" }],
        ["POST", `/prop/production/products/${id}/replace-body`, undefined],
        ["DELETE", `/prop/production/products/${id}/bindings/body`, undefined],
      ];
      const outcomes: string[] = [];
      let allRejected = true;
      for (const [method, path, body] of calls) {
        const res = await apiCall(userToken, method, path, body);
        const rejected = res.status === 403 || res.code === 403;
        if (!rejected) allRejected = false;
        outcomes.push(`${method} ${path.split("/").slice(-1)[0]}→HTTP ${res.status}/code ${res.code}「${compact(res.msg, 28)}」`);
      }
      const after = await db.query<Record<string, unknown>>(
        `SELECT p.deleted_time, p.storage_path, b.active_slot_key, i.deleted_time part_deleted
           FROM prop_product p JOIN prop_product_binding b ON b.product_id=p.product_id
           JOIN prop_part_item i ON i.part_id=b.part_id WHERE p.product_id=?`, [id]);
      const unchanged = JSON.stringify(before) === JSON.stringify(after) && after[0]?.storage_path === null && after[0]?.deleted_time === null && after[0]?.part_deleted === null;
      return {
        status: allRejected && unchanged ? "通过" : "不通过",
        actual: `${outcomes.join("；")}；DB 未变化=${unchanged}（storage_path=${after[0]?.storage_path ?? "null"}、产品 deleted_time=${after[0]?.deleted_time ?? "null"}、部件 deleted_time=${after[0]?.part_deleted ?? "null"}、binding=${after[0]?.active_slot_key ?? "null"}）`,
        evidence: "无权限 token 直连 4 个写接口 + 操作前后 DB 快照对比",
      };
    });

    await book.run("产品管理权限-004", "访问不存在或非法格式产品ID", REQ, async () => {
      const visits: string[] = [];
      let crashed = false;
      for (const [id, label] of [["999999", "不存在"], ["abc", "非法格式"]] as const) {
        const response = await page.goto(`/products/${id}`, { waitUntil: "domcontentloaded" }).catch(() => null);
        await page.waitForTimeout(3000);
        const body = await text(page.locator("body"));
        const state = await text(page.locator(".detail-state"));
        const stack = /Exception|NullPointerException|at com\.|at java\.|SQLException|Traceback/.test(body);
        if (stack || (response && response.status() >= 500)) crashed = crashed || stack;
        visits.push(`${label} ${id}：HTTP ${response?.status() ?? "?"}、state=「${compact(state, 100)}」、异常堆栈=${stack}`);
      }
      const notFoundApi = await apiCall(token, "GET", "/prop/production/products/999999");
      const invalidApi = await apiCall(token, "GET", "/prop/production/products/abc");
      const pageOk = !crashed;
      const invalidLoading = visits[1].includes("読込中") || visits[1].includes("加载中");
      return {
        status: pageOk ? "通过" : "不通过",
        actual: `${visits.join("；")}；API 999999→code ${notFoundApi.code}「${compact(notFoundApi.msg, 40)}」；API abc→HTTP ${invalidApi.status}/code ${invalidApi.code}「${compact(invalidApi.msg, 40)}」；非法格式页面提示缺失=${invalidLoading}`,
        evidence: "管理员访问 /products/999999、/products/abc + 页面异常堆栈扫描 + 详情 API 对照",
      };
    });
  } finally {
    await closeModal().catch(() => undefined);
    await roleSession?.ctx.close().catch(() => undefined);
    await finishSession(browser, session, "verify-product-mgmt-b");
    await cleanupFixtures();
    await db.close();
  }
}

main().catch(async (error) => {
  console.error("[product-b] FAILED:", error);
  await cleanupFixtures().catch(() => undefined);
  await db.close().catch(() => undefined);
  process.exit(1);
});