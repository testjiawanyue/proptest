/**
 * 订单管理运行时验证公共助手。
 * 复用客户/生产模块的 ResultBook、DbClient、会话与 API 工具，补充订单 UI 夹具。
 */
import type { Locator, Page } from "playwright";
import type { DbClient } from "../customer/customer-runtime-utils.js";
import { config } from "../../src/config/index.js";
import { apiLogin, apiCall, pickOptionScroll, readToasts, modalText } from "../production/prod-runtime-utils.js";

export { ResultBook, DbClient, launchAdminSession, finishSession, readToasts, modalText, pickOptionScroll, apiLogin, apiCall } from "../production/prod-runtime-utils.js";

export const apiBase = `${config.app.baseUrl}${config.app.apiPrefix}`;
export const PRODUCT_NAME_ID = 10;
export const PRODUCT_NAME = "AUTO-MD-SAME";

export interface CustomerFixture {
  companyId: number;
  companyName: string;
  customerNo: string;
  addressId: number;
  addressLine1: string;
  contactId: number;
  contactName: string;
}

export function runTag(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export async function ensureCompany(
  db: DbClient,
  input: { customerNo: string; subjectName: string; defaultCustomerType: "direct" | "agency" },
): Promise<number> {
  const rows = await db.query<{ subject_id: number }>(
    "SELECT subject_id FROM prop_customer_subject WHERE customer_no=? LIMIT 1",
    [input.customerNo],
  );
  if (rows.length) return Number(rows[0].subject_id);
  const result = await db.execute(
    `INSERT INTO prop_customer_subject
      (subject_type,company_id,customer_no,subject_name,default_customer_type,storage_path,create_by,create_time,remark)
     VALUES ('company',NULL,?,?,?,?, 'AI自动探索', NOW(), ?)`,
    [input.customerNo, input.subjectName, input.defaultCustomerType, null, "订单管理 A 批运行时验证夹具"],
  );
  return Number(result.insertId);
}

export async function ensureAddress(
  db: DbClient,
  subjectId: number,
  input: { postalCode: string; addressLine1: string; addressLine2?: string; sortOrder: number },
): Promise<number> {
  const rows = await db.query<{ address_id: number }>(
    "SELECT address_id FROM prop_customer_address WHERE subject_id=? AND address_line1=? ORDER BY address_id LIMIT 1",
    [subjectId, input.addressLine1],
  );
  if (rows.length) return Number(rows[0].address_id);
  const result = await db.execute(
    `INSERT INTO prop_customer_address
      (subject_id,postal_code,address_line1,address_line2,sort_order,create_by,create_time,remark)
     VALUES (?,?,?,?,?, 'AI自动探索', NOW(), ?)`,
    [subjectId, input.postalCode, input.addressLine1, input.addressLine2 ?? null, input.sortOrder, "订单管理 A 批运行时验证夹具"],
  );
  return Number(result.insertId);
}

export async function ensureContact(
  db: DbClient,
  addressId: number,
  input: { contactName: string; jobTitle?: string; phone?: string; email?: string },
): Promise<number> {
  const rows = await db.query<{ contact_id: number }>(
    "SELECT contact_id FROM prop_customer_contact WHERE address_id=? AND contact_name=? ORDER BY contact_id LIMIT 1",
    [addressId, input.contactName],
  );
  if (rows.length) return Number(rows[0].contact_id);
  const result = await db.execute(
    `INSERT INTO prop_customer_contact
      (address_id,contact_name,job_title,phone,fax,email,note,sort_order,create_by,create_time,remark)
     VALUES (?,?,?,?,NULL,?,NULL,0,'AI自动探索',NOW(),?)`,
    [addressId, input.contactName, input.jobTitle ?? null, input.phone ?? null, input.email ?? null, "订单管理 A 批运行时验证夹具"],
  );
  return Number(result.insertId);
}

export async function ensureOrderFixtures(db: DbClient): Promise<{ a: CustomerFixture; b: CustomerFixture }> {
  const aId = await ensureCompany(db, {
    customerNo: "AUTO-ORD-A-01",
    subjectName: "AUTO-ORD-A 订单会社",
    defaultCustomerType: "direct",
  });
  const aAddrId = await ensureAddress(db, aId, {
    postalCode: "1000001",
    addressLine1: "AUTO-ORD-A 地址一",
    addressLine2: "AUTO-ORD-A 大楼",
    sortOrder: 0,
  });
  const aContactId = await ensureContact(db, aAddrId, {
    contactName: "AUTO-ORD-A 联系人一",
    jobTitle: "課長",
    phone: "03-1111-2222",
    email: "ord-a@example.test",
  });
  await ensureAddress(db, aId, {
    postalCode: "1000002",
    addressLine1: "AUTO-ORD-A 地址二",
    sortOrder: 1,
  });

  const bId = await ensureCompany(db, {
    customerNo: "AUTO-ORD-B-01",
    subjectName: "AUTO-ORD-B 代理会社",
    defaultCustomerType: "agency",
  });
  const bAddrId = await ensureAddress(db, bId, {
    postalCode: "2000001",
    addressLine1: "AUTO-ORD-B 地址一",
    sortOrder: 0,
  });
  const bContactId = await ensureContact(db, bAddrId, {
    contactName: "AUTO-ORD-B 联系人一",
    phone: "03-3333-4444",
  });

  return {
    a: {
      companyId: aId,
      companyName: "AUTO-ORD-A 订单会社",
      customerNo: "AUTO-ORD-A-01",
      addressId: aAddrId,
      addressLine1: "AUTO-ORD-A 地址一",
      contactId: aContactId,
      contactName: "AUTO-ORD-A 联系人一",
    },
    b: {
      companyId: bId,
      companyName: "AUTO-ORD-B 代理会社",
      customerNo: "AUTO-ORD-B-01",
      addressId: bAddrId,
      addressLine1: "AUTO-ORD-B 地址一",
      contactId: bContactId,
      contactName: "AUTO-ORD-B 联系人一",
    },
  };
}

export async function adminToken(): Promise<string> {
  return apiLogin(config.app.loginUser, config.app.loginPassword);
}

export function formItem(scope: Page | Locator, label: string): Locator {
  return scope.locator(".ant-form-item").filter({ hasText: label }).last();
}

export async function waitNewOrderReady(page: Page): Promise<void> {
  await page.goto("/orders/new");
  await page.locator("#orderForm_ordering").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#orderForm_ordering").waitFor({ state: "visible" });
  await page.waitForTimeout(700);
}

export async function selectSubject(page: Page, rootId: string, keyword: string): Promise<void> {
  await page.locator(`#${rootId}`).click();
  const modal = page.locator(".ant-modal:visible").filter({ hasText: "会社・支店／現場を選択" }).last();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  const input = modal.getByPlaceholder("会社名・支店名・番号で検索");
  await input.fill(keyword);
  await input.press("Enter");
  await page.waitForTimeout(900);
  const node = modal.locator(".ant-tree-node-content-wrapper", { hasText: keyword }).first();
  await node.waitFor({ state: "visible", timeout: 10000 });
  await node.click();
  await page.waitForTimeout(300);
  await modal.getByRole("button", { name: /選択：/ }).click();
  await modal.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

export async function selectBillingSubject(page: Page, keyword: string): Promise<void> {
  const billing = page.locator(".customer-relations .party-field").nth(2);
  await billing.locator(".party-select-card").click();
  const modal = page.locator(".ant-modal:visible").filter({ hasText: "会社・支店／現場を選択" }).last();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  const input = modal.getByPlaceholder("会社名・支店名・番号で検索");
  await input.fill(keyword);
  await input.press("Enter");
  await page.waitForTimeout(900);
  await modal.locator(".ant-tree-node-content-wrapper", { hasText: keyword }).first().click();
  await modal.getByRole("button", { name: /選択：/ }).click();
  await modal.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

export async function selectCustomerType(page: Page, label: "直販" | "代理店"): Promise<void> {
  await page.locator(".customer-type-field .ant-radio-button-wrapper", { hasText: label }).click();
  await page.waitForTimeout(500);
}

export async function selectedCustomerType(page: Page): Promise<string> {
  return (await page.locator(".customer-type-field .ant-radio-button-wrapper-checked").first().innerText().catch(() => "")).trim();
}

export async function openAddressCandidates(page: Page): Promise<Locator> {
  await page.locator("#orderForm_deliveryAddress").click();
  const modal = page.locator(".ant-modal:visible").filter({ hasText: "配送先住所を選択" }).last();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(700);
  return modal;
}

export async function addAddressEditor(page: Page): Promise<Locator> {
  const candidate = page.locator(".ant-modal:visible").filter({ hasText: "配送先住所を選択" }).last();
  await candidate.locator("button", { hasText: "住所を追加" }).click();
  const editor = page.locator(".ant-modal:visible").filter({ hasText: "住所を追加" }).last();
  await editor.waitFor({ state: "visible", timeout: 10000 });
  return editor;
}

export async function fillAddressEditor(editor: Locator, postal: string, line1: string, line2 = ""): Promise<void> {
  await formItem(editor, "郵便番号").locator("input").last().fill(postal);
  await formItem(editor, "住所1").locator("input").last().fill(line1);
  const line2Input = formItem(editor, "住所2").locator("input").last();
  if (line2) await line2Input.fill(line2);
}

export async function saveAddressEditor(editor: Locator): Promise<void> {
  await editor.locator(".ant-modal-footer .ant-btn-primary").click();
  await editor.waitFor({ state: "hidden", timeout: 15000 }).catch(() => undefined);
  await editor.page().waitForTimeout(900);
}

export async function selectAddressByLine(page: Page, line: string): Promise<void> {
  const modal = await openAddressCandidates(page);
  const card = modal.locator(".candidate-card", { hasText: line }).first();
  await card.waitFor({ state: "visible", timeout: 10000 });
  await card.getByRole("button", { name: /^選択$/ }).click();
  await modal.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

export async function selectContactByName(page: Page, name: string): Promise<void> {
  await page.locator(".delivery-contact .select-card").click();
  const modal = page.locator(".ant-modal:visible").filter({ hasText: "担当者を選択" }).last();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(700);
  const card = modal.locator(".candidate-card", { hasText: name }).first();
  await card.waitFor({ state: "visible", timeout: 10000 });
  await card.getByRole("button", { name: /^選択$/ }).click();
  await modal.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

export async function selectProduct(page: Page): Promise<void> {
  await formItem(page, "お客様向け商品名").locator(".ant-select").click();
  await pickOptionScroll(page, PRODUCT_NAME);
  await page.waitForTimeout(500);
}

export async function fillFirstLine(page: Page, quantity = 1, color = "AUTO-色A"): Promise<void> {
  const first = page.locator(".line-row").first();
  if (color) await first.getByPlaceholder("ご希望の色（任意）").fill(color);
  await first.locator(".ant-input-number input").fill(String(quantity));
  await page.waitForTimeout(300);
}

export async function clickCreate(page: Page): Promise<void> {
  await page.locator(".sticky-actions button", { hasText: "注文を作成" }).click();
}

export async function createOrderViaUi(page: Page, customerOrderNo: string): Promise<{
  orderId: number | null;
  code: number | null;
  msg: string;
  url: string;
}> {
  await formItem(page, "お客様注文番号").locator("input").last().fill(customerOrderNo);
  const respPromise = page.waitForResponse(
    (r) => r.url().includes("/prop/order") && r.request().method() === "POST" && !r.url().includes("/customer/"),
    { timeout: 20000 },
  );
  await clickCreate(page);
  const resp = await respPromise;
  const body = await resp.json().catch(() => ({ code: -1, msg: "" }));
  await page.waitForTimeout(1600);
  return { orderId: body?.data?.orderId ? Number(body.data.orderId) : null, code: body?.code ?? null, msg: body?.msg ?? "", url: page.url() };
}

export async function countAddresses(db: DbClient, subjectId: number): Promise<number> {
  const rows = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_customer_address WHERE subject_id=?", [subjectId]);
  return Number(rows[0]?.c ?? 0);
}

export async function findOrderByCustomerNo(db: DbClient, customerOrderNo: string) {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT * FROM prop_order WHERE customer_order_no=? ORDER BY order_id DESC LIMIT 1",
    [customerOrderNo],
  );
  return rows[0] ?? null;
}

export async function waitNoPost(page: Page, action: () => Promise<void>, timeout = 1500): Promise<boolean> {
  let posted = false;
  const listener = (req: { url: () => string; method: () => string }) => {
    if (req.method() === "POST" && req.url().includes("/prop/order") && !req.url().includes("/customer/")) posted = true;
  };
  page.on("request", listener);
  await action();
  await page.waitForTimeout(timeout);
  page.off("request", listener);
  return !posted;
}

export function compactText(text: string, max = 600): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}
