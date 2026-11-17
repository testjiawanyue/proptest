/** 订单寄送 C 批公共夹具与 API/UI 助手。 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { DbClient } from "../customer/customer-runtime-utils.js";
import type { CustomerFixture } from "./order-runtime-utils.js";
import { apiCall, PRODUCT_NAME } from "./order-runtime-utils.js";

export type CustomerSet = { a: CustomerFixture; b: CustomerFixture };
export type ApiResult = { status: number; code: number; msg: string; data: any };
export const SHIPMENT_PROFILE_ID = 17;
export const SHIPMENT_SPEC = "AUTO-规格-013";

export function mustOk(label: string, r: ApiResult): any {
  if (r.code !== 200) throw new Error(`${label}失败：HTTP ${r.status} code=${r.code} msg=${r.msg}`);
  return r.data;
}

export async function ensureProduct(
  db: DbClient,
  no: string,
  options: { inspection?: number | null; scrapped?: boolean; deleted?: boolean; body?: boolean } = {},
): Promise<number> {
  const inspection = options.inspection === undefined ? 1 : options.inspection;
  const rows = await db.query<{ product_id: number }>(
    "SELECT product_id FROM prop_product WHERE manufacturing_no=? ORDER BY product_id DESC LIMIT 1",
    [no],
  );
  let productId: number;
  if (rows.length) {
    productId = Number(rows[0].product_id);
    await db.execute(
      "UPDATE prop_product SET initial_production_inspection_passed=?, scrapped_time=? WHERE product_id=?",
      [inspection, options.scrapped ? new Date() : null, productId],
    );
  } else {
    const seq = await db.query<{ n: number }>(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(m_no,2) AS UNSIGNED)),0) n FROM prop_product WHERE m_no REGEXP '^M[0-9]{6}$'",
    );
    const mNo = `M${String(Number(seq[0]?.n ?? 0) + 1).padStart(6, "0")}`;
    const inserted = await db.execute(
      `INSERT INTO prop_product
        (manufacturing_no,active_manufacturing_no,m_no,storage_path,deleted_time,deleted_by,create_by,create_time,remark,
         initial_production_inspection_passed,external_product_name,scrapped_time)
       VALUES (?,?,?,NULL,?,?, 'AI自动探索',NOW(),?,?, '一命多助',?)`,
      [no, options.deleted ? null : no, mNo, options.deleted ? new Date() : null, options.deleted ? "AI自动探索" : null,
       `订单管理 C 批运行时验证夹具 ${no}`, inspection, options.scrapped ? new Date() : null],
    );
    productId = Number(inserted.insertId);
  }
  if (options.body !== false) await ensureBodyBinding(db, productId, no);
  return productId;
}

async function ensureBodyBinding(db: DbClient, productId: number, no: string): Promise<void> {
  const existing = await db.query<{ c: number }>(
    "SELECT COUNT(*) c FROM prop_product_binding WHERE product_id=? AND slot_type='body' AND ended_time IS NULL",
    [productId],
  );
  if (Number(existing[0]?.c ?? 0) > 0) return;
  const version = await db.query<{ version_id: number }>(
    "SELECT current_version_id version_id FROM prop_part_profile WHERE profile_id=?",
    [SHIPMENT_PROFILE_ID],
  );
  if (!version.length) throw new Error(`缺少衣体资料 ${SHIPMENT_PROFILE_ID}`);
  const partNo = `${no}-BODY`;
  let part = await db.query<{ part_id: number }>(
    "SELECT part_id FROM prop_part_item WHERE active_part_no=? AND deleted_time IS NULL",
    [partNo],
  );
  let partId: number;
  if (part.length) partId = Number(part[0].part_id);
  else {
    const inserted = await db.execute(
      `INSERT INTO prop_part_item
        (part_no,active_part_no,part_type,source_type,current_profile_id,current_profile_version_id,create_by,create_time,remark)
       VALUES (?,?, 'jacket','assembly',?,?, 'AI自动探索',NOW(),?)`,
      [partNo, partNo, SHIPMENT_PROFILE_ID, version[0].version_id, `C 批寄送规格夹具 ${no}`],
    );
    partId = Number(inserted.insertId);
  }
  await db.execute(
    `INSERT INTO prop_product_binding
      (product_id,part_id,slot_type,active_slot_key,active_part_key,started_by,started_time)
     VALUES (?,?,'body',?,?, 'AI自动探索',NOW())`,
    [productId, partId, `${productId}:body`, String(partId)],
  );
}

export async function createOrder(
  token: string,
  customer: CustomerFixture,
  customerOrderNo: string,
  quantity: number,
  orderType: "sale" | "rental" | "replacement" = "sale",
): Promise<number> {
  const response = await apiCall(token, "POST", "/prop/order", {
    requestId: randomUUID(),
    customerOrderNo,
    orderDate: "2026-10-29",
    expectedShipDate: "2026-10-30",
    orderType,
    customerType: "direct",
    orderingParty: { mode: "select", id: customer.companyId },
    recipient: { mode: "select", id: customer.companyId },
    billingParty: { mode: "select", id: customer.companyId },
    deliveryAddress: { mode: "select", id: customer.addressId },
    deliveryContact: { mode: "select", id: customer.contactId },
    lines: [{ productNameId: 10, productName: PRODUCT_NAME, colorNote: `AUTO-C-${orderType}-${customerOrderNo.slice(-12)}`, quantity }],
    remark: `AUTO 订单寄送 C 批 ${customerOrderNo}`,
  });
  return Number(mustOk(`创建订单 ${customerOrderNo}`, response).orderId);
}

export async function getOrder(token: string, orderId: number): Promise<any> {
  return mustOk(`读取订单 ${orderId}`, await apiCall(token, "GET", `/prop/order/${orderId}`));
}
export async function getShipment(token: string, id: number): Promise<any> {
  return mustOk(`读取寄送 ${id}`, await apiCall(token, "GET", `/prop/shipment/${id}`));
}
export async function createShipment(token: string, orderId: number, shipDate = "2026-10-29"): Promise<any> {
  const order = await getOrder(token, orderId);
  return mustOk(`创建寄送 ${orderId}`, await apiCall(token, "POST", `/prop/order/${orderId}/shipments`, {
    requestId: randomUUID(), orderRevision: Number(order.revision), shipDate, adoptedProductName: PRODUCT_NAME,
  }));
}
export async function addProduct(token: string, shipmentId: number, manufacturingNo: string): Promise<ApiResult> {
  const shipment = await getShipment(token, shipmentId);
  return apiCall(token, "POST", `/prop/shipment/${shipmentId}/products`, {
    revision: Number(shipment.revision), manufacturingNo,
  });
}
export async function removeProduct(token: string, shipmentId: number, productId: number): Promise<ApiResult> {
  const shipment = await getShipment(token, shipmentId);
  return apiCall(token, "DELETE", `/prop/shipment/${shipmentId}/products/${productId}?revision=${shipment.revision}`);
}
export async function saveFields(token: string, shipmentId: number, fields: Record<string, unknown>): Promise<ApiResult> {
  const shipment = await getShipment(token, shipmentId);
  return apiCall(token, "PUT", `/prop/shipment/${shipmentId}`, {
    ...fields, revision: Number(shipment.revision), fields: Object.keys(fields), saveMode: "auto",
  });
}
export async function confirmShipment(token: string, shipmentId: number, trackingNumbers: string[] = []): Promise<ApiResult> {
  const shipment = await getShipment(token, shipmentId);
  return apiCall(token, "POST", `/prop/shipment/${shipmentId}/confirm`, {
    revision: Number(shipment.revision), trackingNumbers,
  });
}

export function shipmentCard(page: Page) {
  return page.locator(".ant-card").filter({ has: page.locator(".ant-card-head-title", { hasText: /出荷履歴/ }) }).last();
}
export function productCard(drawer: any) {
  return drawer.locator(".ant-card").filter({ hasText: "今回発送する製品" }).last();
}
export async function openShipmentDrawer(page: Page, orderId: number, rowIndex = 0): Promise<any> {
  await page.goto(`http://localhost:8090/orders/${orderId}`);
  await page.locator(".order-detail-page").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1200);
  const rows = shipmentCard(page).locator("tr.ant-table-row");
  await rows.nth(rowIndex).waitFor({ state: "visible", timeout: 10000 });
  await rows.nth(rowIndex).getByRole("button", { name: "表示" }).click();
  const drawer = page.locator(".prop-shipment-drawer");
  await drawer.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(1000);
  return drawer;
}
export async function fillRange(page: Page, drawer: any, prefix: string, start: string, end: string): Promise<void> {
  const form = drawer.locator(".number-form");
  await form.getByPlaceholder("製造番号の先頭部分").fill(prefix);
  await form.getByPlaceholder("開始番号").fill(start);
  await form.getByPlaceholder("終了番号").fill(end);
}
export async function clickAdd(drawer: any): Promise<void> {
  await drawer.locator(".number-form").getByRole("button", { name: "追 加" }).click();
}
export async function switchSingleEntry(drawer: any): Promise<void> {
  await drawer.getByText("1件ずつ登録", { exact: true }).click();
}
export async function fillSingleNo(drawer: any, number: string): Promise<void> {
  await drawer.getByPlaceholder("製造番号を読み取るか入力して、Enterキーで追加").fill(number);
}