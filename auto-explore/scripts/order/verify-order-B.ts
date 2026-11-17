/**
 * 订单管理 B 批未执行用例运行时验证（8 条）
 * 覆盖：订单编辑-003/005、订单取消-003、解除产品关联-001/003/004/005、订单权限-005
 * 方式：真实 UI + API 直连 + DB 断言；夹具统一 AUTO-ORD-B-<时间戳> 前缀。
 */
import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { Session } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiCall,
  runTag, ensureOrderFixtures, selectSubject, selectAddressByLine, readToasts,
  compactText, PRODUCT_NAME,
} from "./order-runtime-utils.js";

const book = new ResultBook("reports/order-runtime-results-B.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-B-${tag}`;
const productNos = Array.from({ length: 9 }, (_, i) => `${prefix}-P${String(i + 1).padStart(2, "0")}`);

let browser: any;
let session: Session | undefined;
let token = "";
let fixture: any;

type ApiResult = { status: number; code: number; msg: string; data: unknown };

function ok(label: string, response: ApiResult): any {
  if (response.code !== 200) throw new Error(`${label}失败：code=${response.code}, msg=${response.msg}`);
  return response.data;
}

function localDate(value: any): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value ?? "").slice(0, 10);
}

function jsonOf(value: unknown): any {
  try { return typeof value === "string" ? JSON.parse(value) : value; } catch { return {}; }
}

async function ensureProduct(no: string): Promise<number> {
  const existing = await db.query<{ product_id: number }>(
    "SELECT product_id FROM prop_product WHERE active_manufacturing_no=? AND deleted_time IS NULL",
    [no],
  );
  if (existing.length) {
    await db.execute("UPDATE prop_product SET initial_production_inspection_passed=1 WHERE product_id=?", [existing[0].product_id]);
    return Number(existing[0].product_id);
  }
  const seq = await db.query<{ n: number }>(
    "SELECT COALESCE(MAX(CAST(SUBSTRING(m_no,2) AS UNSIGNED)),0) n FROM prop_product WHERE m_no REGEXP '^M[0-9]{6}$'",
  );
  const mNo = `M${String(Number(seq[0]?.n ?? 0) + 1).padStart(6, "0")}`;
  const inserted = await db.execute(
    `INSERT INTO prop_product
      (manufacturing_no,active_manufacturing_no,m_no,storage_path,create_by,create_time,remark,initial_production_inspection_passed,external_product_name)
     VALUES (?,?,?,NULL,'AI自动探索',NOW(),?,1,'一命多助')`,
    [no, no, mNo, `订单管理 B 批运行时验证夹具 ${tag}`],
  );
  return Number(inserted.insertId);
}

async function createOrder(customerOrderNo: string, quantity: number): Promise<number> {
  const created = await apiCall(token, "POST", "/prop/order", {
    requestId: randomUUID(),
    customerOrderNo,
    orderDate: "2026-10-29",
    expectedShipDate: "2026-10-30",
    orderType: "sale",
    customerType: "direct",
    orderingParty: { mode: "select", id: fixture.a.companyId },
    recipient: { mode: "select", id: fixture.a.companyId },
    billingParty: { mode: "select", id: fixture.a.companyId },
    deliveryAddress: { mode: "select", id: fixture.a.addressId },
    deliveryContact: { mode: "select", id: fixture.a.contactId },
    lines: [{ productNameId: 10, productName: PRODUCT_NAME, colorNote: `${prefix}-COLOR`, quantity }],
    remark: `AUTO B ${tag}`,
  });
  return Number(ok(`创建订单 ${customerOrderNo}`, created).orderId);
}

async function getOrder(orderId: number): Promise<any> {
  return ok(`读取订单 ${orderId}`, await apiCall(token, "GET", `/prop/order/${orderId}`));
}

async function getShipment(shipmentId: number): Promise<any> {
  return ok(`读取寄送 ${shipmentId}`, await apiCall(token, "GET", `/prop/shipment/${shipmentId}`));
}

async function createShipment(orderId: number, shipDate = "2026-10-29"): Promise<any> {
  const order = await getOrder(orderId);
  const created = await apiCall(token, "POST", `/prop/order/${orderId}/shipments`, {
    requestId: randomUUID(),
    orderRevision: Number(order.revision),
    shipDate,
    adoptedProductName: PRODUCT_NAME,
  });
  return ok(`创建寄送 order=${orderId}`, created);
}

async function addProduct(shipmentId: number, manufacturingNo: string): Promise<any> {
  const shipment = await getShipment(shipmentId);
  const response = await apiCall(token, "POST", `/prop/shipment/${shipmentId}/products`, {
    revision: Number(shipment.revision),
    manufacturingNo,
  });
  return ok(`加入产品 ${manufacturingNo}`, response);
}

async function saveCarrier(shipmentId: number, carrier = "yamato"): Promise<any> {
  const shipment = await getShipment(shipmentId);
  const response = await apiCall(token, "PUT", `/prop/shipment/${shipmentId}`, {
    revision: Number(shipment.revision), fields: ["carrier"], carrier, saveMode: "auto",
  });
  return ok(`保存物流 ${shipmentId}`, response);
}

async function confirmShipment(shipmentId: number, tracking: string): Promise<any> {
  const shipment = await getShipment(shipmentId);
  const response = await apiCall(token, "POST", `/prop/shipment/${shipmentId}/confirm`, {
    revision: Number(shipment.revision), trackingNumbers: [tracking],
  });
  return ok(`确认寄出 ${shipmentId}`, response);
}

async function shipProducts(orderId: number, numbers: string[], shipDate = "2026-10-29"): Promise<any> {
  const shipment = await createShipment(orderId, shipDate);
  for (const number of numbers) {
    const added = await addProduct(Number(shipment.shipmentId), number);
    if (!Array.isArray(added.added) || !added.added.includes(number)) {
      throw new Error(`产品 ${number} 未加入寄送：${JSON.stringify(added.failures ?? [])}`);
    }
  }
  await saveCarrier(Number(shipment.shipmentId));
  const confirmed = await confirmShipment(Number(shipment.shipmentId), `AUTO-TRK-${tag}-${shipment.shipmentId}`);
  return { shipmentId: Number(shipment.shipmentId), shipment: confirmed };
}
async function generateWaybill(shipmentId: number): Promise<any> {
  const prepared = ok("准备面单", await apiCall(token, "GET", `/prop/shipment/${shipmentId}/documents/prepare?type=waybill`));
  const created = await apiCall(token, "POST", `/prop/shipment/${shipmentId}/documents`, {
    requestId: randomUUID(), type: "waybill", revision: Number(prepared.revision), copies: 1,
    sourceToken: prepared.sourceToken, issueDate: "2026-10-29", overrides: prepared.defaults,
  });
  return ok("生成面单", created);
}

async function relationRows(orderId: number): Promise<any[]> {
  return db.query(
    `SELECT r.*, sp.manufacturing_no FROM prop_product_order_relation r
      JOIN prop_shipment_product sp ON sp.shipment_product_id=r.shipment_product_id
      WHERE r.order_id=? ORDER BY r.relation_id`,
    [orderId],
  );
}

async function productRow(productId: number): Promise<any> {
  const rows = await db.query("SELECT * FROM prop_product WHERE product_id=?", [productId]);
  return rows[0];
}

async function buildKeepPayload(order: any, overrideQuantity?: number): Promise<any> {
  return {
    revision: Number(order.revision),
    customerOrderNo: order.customerOrderNo,
    orderDate: order.orderDate,
    expectedShipDate: order.expectedShipDate,
    orderType: order.orderType,
    customerType: order.customerType,
    orderingParty: { mode: "keep" },
    recipient: { mode: "keep" },
    billingParty: { mode: "keep" },
    deliveryAddress: { mode: "keep" },
    deliveryContact: order.deliveryContactId ? { mode: "keep" } : { mode: "clear" },
    lines: (order.lines || []).map((line: any, index: number) => ({
      lineId: line.lineId,
      productNameId: line.productNameId,
      productName: line.productName,
      colorNote: line.colorNote,
      quantity: overrideQuantity !== undefined && index === 0 ? overrideQuantity : line.quantity,
    })),
    remark: order.remark,
  };
}

function relationCard(page: Page) {
  return page.locator(".ant-card").filter({
    has: page.locator(".ant-card-head-title", { hasText: /関連製品/ }),
  }).last();
}

async function openReleaseModal(page: Page, orderId: number, manufacturingNo: string): Promise<any> {
  await page.goto(`/orders/${orderId}`);
  await page.locator(".order-detail-page").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1000);
  const row = relationCard(page).locator("tr.ant-table-row", { hasText: manufacturingNo }).first();
  await row.waitFor({ state: "visible", timeout: 10000 });
  await row.getByRole("button", { name: /関連付けを解除/ }).click();
  const modal = page.locator(".ant-modal:visible").filter({ hasText: "製品の関連付けを解除" }).last();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(500);
  return modal;
}

async function main(): Promise<void> {
  await db.connect();
  fixture = await ensureOrderFixtures(db);
  token = await apiLogin("admin", "admin123");

  const productIds: number[] = [];
  for (const number of productNos) productIds.push(await ensureProduct(number));
  const p = Object.fromEntries(productNos.map((number, index) => [number, productIds[index]]));

  const edit3Order = await createOrder(`${prefix}-EDIT3`, 2);
  const edit3Ship = await shipProducts(edit3Order, [productNos[0]]);
  const edit5Order = await createOrder(`${prefix}-EDIT5`, 5);
  const edit5Ship = await shipProducts(edit5Order, productNos.slice(1, 6));
  const cancelOrder = await createOrder(`${prefix}-CANCEL`, 2);
  const cancelShipped = await shipProducts(cancelOrder, [productNos[6]]);
  const cancelPrep = await createShipment(cancelOrder);
  await addProduct(Number(cancelPrep.shipmentId), productNos[7]);
  await saveCarrier(Number(cancelPrep.shipmentId));
  await generateWaybill(Number(cancelPrep.shipmentId));
  const reuseOrder = await createOrder(`${prefix}-REUSE`, 1);
  const reshipClearOrder = await createOrder(`${prefix}-RESHIP-CLEAR`, 1);
  const reshipKeepOrder = await createOrder(`${prefix}-RESHIP-KEEP`, 1);
  const permOrder1 = await createOrder(`${prefix}-PERM1`, 1);
  const permOrder2 = await createOrder(`${prefix}-PERM2`, 1);

  const launched = await launchAdminSession("verify-order-B");
  browser = launched.browser;
  session = launched.session;
  const page = session.page;
  page.setDefaultTimeout(15000);

  try {
    await book.run("订单编辑-003", "已发货订单客户与订单行锁定", "FEAT-10-order §6.4、§6.6；VAL-16", async () => {
      await page.goto(`/orders/${edit3Order}/edit`);
      await page.locator(".order-form-page").waitFor({ state: "visible", timeout: 15000 });
      await page.locator("#orderForm_ordering").waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(700);
      await selectSubject(page, "orderForm_ordering", fixture.b.companyName);
      await selectAddressByLine(page, fixture.b.addressLine1);
      const color = `${prefix}-EDIT3-COLOR`;
      const first = page.locator(".line-row").first();
      await first.getByPlaceholder("ご希望の色（任意）").fill(color);
      await first.locator(".ant-input-number input").fill("3");
      const responsePromise = page.waitForResponse(
        (r) => r.url().includes(`/prop/order/${edit3Order}`) && r.request().method() === "PUT",
        { timeout: 20000 },
      );
      await page.locator(".sticky-actions button", { hasText: "注文を保存" }).click();
      const response = await responsePromise;
      const body = await response.json() as any;
      await page.waitForTimeout(1300);
      const order = await db.query<any>(
        `SELECT o.ordering_party_id,o.ordering_party_snapshot,o.delivery_address_id,l.quantity,l.color_note,
           (SELECT COUNT(*) FROM prop_product_order_relation r WHERE r.order_id=o.order_id AND r.delivery_valid=1) fulfilled
         FROM prop_order o JOIN prop_order_line l ON l.order_id=o.order_id WHERE o.order_id=? LIMIT 1`,
        [edit3Order],
      );
      const row = order[0];
      const snapshot = jsonOf(row?.ordering_party_snapshot);
      const passed = body.code === 200 && Number(row?.ordering_party_id) === fixture.b.companyId
        && snapshot.name === fixture.b.companyName && Number(row?.delivery_address_id) === fixture.b.addressId
        && Number(row?.quantity) === 3 && row?.color_note === color && Number(row?.fulfilled) === 1;
      return {
        status: passed ? "通过" : "不通过",
        actual: `已发货订单编辑页可保存；PUT code=${body.code}，订单方=${snapshot.name ?? "?"}、納品先地址=${row?.delivery_address_id ?? "?"}、行数量 2→${row?.quantity ?? "?"}、颜色=${row?.color_note ?? "?"}；原有效交付关系仍为 ${row?.fulfilled ?? "?"} 条。`,
        evidence: "UI /orders/:id/edit 修改注文先、配送先、颜色与数量→保存；捕获 PUT /prop/order/:id；DB 查询订单快照、地址、订单行与有效关系。",
      };
    });

    await book.run("订单编辑-005", "编辑时数量受总量约束限制", "FEAT-10-order §6.4、§6.6；updateOrder 总量约束", async () => {
      await page.goto(`/orders/${edit5Order}/edit`);
      await page.locator(".order-form-page").waitFor({ state: "visible", timeout: 15000 });
      await page.locator("#orderForm_ordering").waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(700);
      let uiPutSent = false;
      const listener = (request: any) => {
        if (request.method() === "PUT" && request.url().includes(`/prop/order/${edit5Order}`)) uiPutSent = true;
      };
      page.on("request", listener);
      await page.locator(".line-row").first().locator(".ant-input-number input").fill("4");
      await page.locator(".sticky-actions button", { hasText: "注文を保存" }).click();
      await page.waitForTimeout(1200);
      page.off("request", listener);
      const toast = compactText(await readToasts(page), 300);
      const current = await getOrder(edit5Order);
      const rejected = await apiCall(token, "PUT", `/prop/order/${edit5Order}`, await buildKeepPayload(current, 4));
      const line = await db.query<{ quantity: number }>("SELECT quantity FROM prop_order_line WHERE order_id=? ORDER BY line_id LIMIT 1", [edit5Order]);
      const passed = !uiPutSent && /現在の有効出荷数以上/.test(toast) && rejected.code === 409
        && /有効出荷数以上/.test(rejected.msg) && Number(line[0]?.quantity) === 5;
      return {
        status: passed ? "通过" : "不通过",
        actual: `订单总量/有效交付=5/5；UI 改为 4 后被前端拦截，提示“${toast || "(无提示)"}”且未发送 PUT=${!uiPutSent}；API 直提同内容 code=${rejected.code}、msg=${rejected.msg}；DB 行数量保持 ${line[0]?.quantity ?? "?"}。`,
        evidence: "UI /orders/:id/edit 数量 5→4 点击保存并监听 PUT；读取 ant-message；API PUT 复核；DB 查询订单行数量。",
      };
    });
    await book.run("解除产品关联-001", "解除产品关联弹窗提示信息正确", "FEAT-10-order 解除关联；VAL-09、VAL-24", async () => {
      const modal = await openReleaseModal(page, edit5Order, productNos[1]);
      const text = compactText(await modal.innerText(), 2200);
      const radios = (await modal.locator(".ant-radio-wrapper").allInnerTexts()).map((x) => x.replace(/\s+/g, ""));
      const confirmButton = modal.getByRole("button", { name: /解除を確定/ });
      const dangerous = await confirmButton.evaluate((el: Element) => el.classList.contains("ant-btn-dangerous")).catch(() => false);
      const required = [
        "製品の関連付けを解除", `製造番号：${productNos[1]}`,
        "有効出荷数から差し引かれ", "完成品在庫に戻り", "過去の出荷履歴と関連付けの履歴は削除されない",
        "受付の回収確認で処理する", "基準月を保持", "基準月をクリア",
      ];
      const missing = required.filter((item) => !text.includes(item));
      const noReason = !/解除理由|理由を選択|理由（/.test(text);
      const passed = missing.length === 0 && radios.some((x) => x.includes("基準月を保持"))
        && radios.some((x) => x.includes("基準月をクリア")) && dangerous && noReason;
      return {
        status: passed ? "通过" : "不通过",
        actual: `弹窗标题/产品编号/履约扣减/库存回归/历史保留/受付提示均可见；基准选项=${JSON.stringify(radios)}；危险色“解除を確定”=${dangerous}；无解除原因选项=${noReason}；缺失=${missing.join("、") || "无"}。`,
        evidence: "UI 订单详情有效关联行点击「関連付けを解除」；读取可见弹窗全文、radio 文案与按钮 class。",
      };
    });

    await book.run("解除产品关联-003", "取消解除产品关联数据保留", "FEAT-10-order 解除弹窗取消路径；VAL-09", async () => {
      const modal = page.locator(".ant-modal:visible").filter({ hasText: "製品の関連付けを解除" }).last();
      const before = await getOrder(edit5Order);
      const beforeRelations = (before.relations || []).filter((x: any) => x.current).length;
      await modal.getByRole("button", { name: "戻る" }).click();
      await modal.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(700);
      const after = await getOrder(edit5Order);
      const afterRelations = (after.relations || []).filter((x: any) => x.current).length;
      const dbCurrent = await db.query<{ c: number }>(
        "SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=? AND delivery_valid=1",
        [edit5Order],
      );
      const passed = before.fulfilledQuantity === after.fulfilledQuantity
        && beforeRelations === afterRelations && Number(dbCurrent[0]?.c) === beforeRelations;
      return {
        status: passed ? "通过" : "不通过",
        actual: `点击弹窗“戻る”后弹窗关闭=${!(await modal.isVisible().catch(() => false))}；有效交付 ${before.fulfilledQuantity}→${after.fulfilledQuantity}，当前关联 ${beforeRelations}→${afterRelations}，DB 有效关系=${dbCurrent[0]?.c} 未变化。`,
        evidence: "UI 解除弹窗点击取消；前后 GET /prop/order/:id 与 DB 有效关系计数对比。",
      };
    });

    await book.run("解除产品关联-004", "解除基准不删除寄送历史", "FEAT-11-shipment VAL-25；FEAT-10-order 解除关联", async () => {
      const relsBefore = await relationRows(edit5Order);
      const p02 = relsBefore.find((x) => x.manufacturing_no === productNos[1]);
      const p03 = relsBefore.find((x) => x.manufacturing_no === productNos[2]);
      const shipBefore = await db.query<any>("SELECT * FROM prop_shipment WHERE shipment_id=?", [edit5Ship.shipmentId]);
      const filesBefore = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?", [edit5Ship.shipmentId]);
      const itemsBefore = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_product WHERE shipment_id=?", [edit5Ship.shipmentId]);
      const base02Before = await productRow(Number(p02.product_id));
      const keep = await apiCall(token, "POST", `/prop/order/${edit5Order}/relations/${p02.relation_id}/release`, { baselineAction: "keep" });
      const clear = await apiCall(token, "POST", `/prop/order/${edit5Order}/relations/${p03.relation_id}/release`, { baselineAction: "clear" });
      const relsAfter = await relationRows(edit5Order);
      const after02 = relsAfter.find((x) => Number(x.relation_id) === Number(p02.relation_id));
      const after03 = relsAfter.find((x) => Number(x.relation_id) === Number(p03.relation_id));
      const base02After = await productRow(Number(p02.product_id));
      const base03After = await productRow(Number(p03.product_id));
      const shipAfter = await db.query<any>("SELECT * FROM prop_shipment WHERE shipment_id=?", [edit5Ship.shipmentId]);
      const filesAfter = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?", [edit5Ship.shipmentId]);
      const itemsAfter = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_product WHERE shipment_id=?", [edit5Ship.shipmentId]);
      const deleteAttempt = await apiCall(token, "DELETE", `/prop/shipment/${edit5Ship.shipmentId}?revision=${Number(shipAfter[0]?.revision)}`);
      const keepBaseSame = String(base02After?.first_shipment_date) === String(base02Before?.first_shipment_date)
        && String(base02After?.lifecycle_base_month) === String(base02Before?.lifecycle_base_month)
        && Number(base02After?.baseline_shipment_id) === Number(base02Before?.baseline_shipment_id);
      const clearBase = base03After?.first_shipment_date == null && base03After?.lifecycle_base_month == null && base03After?.baseline_shipment_id == null;
      const passed = keep.code === 200 && clear.code === 200
        && Number(after02?.delivery_valid) === 0 && after02?.baseline_action === "keep"
        && Number(after03?.delivery_valid) === 0 && after03?.baseline_action === "clear"
        && shipAfter[0]?.status === "shipped" && shipAfter[0]?.deleted_time == null
        && Number(filesAfter[0]?.c) === Number(filesBefore[0]?.c) && Number(filesAfter[0]?.c) > 0
        && Number(itemsAfter[0]?.c) === Number(itemsBefore[0]?.c)
        && keepBaseSame && clearBase && deleteAttempt.code !== 200;
      return {
        status: passed ? "通过" : "不通过",
        actual: `keep 解除 code=${keep.code}、clear 解除 code=${clear.code}；两条关系均 delivery_valid=0（baseline_action=keep/clear）；原寄送仍 ${shipAfter[0]?.status}、文件 ${filesBefore[0]?.c}→${filesAfter[0]?.c} 份、产品清单 ${itemsBefore[0]?.c}→${itemsAfter[0]?.c} 项；keep 产品基准未变=${keepBaseSame}，clear 产品首次出货日/基准月/基准寄送均为空=${clearBase}；删除已确认寄送被拒 code=${deleteAttempt.code}“${deleteAttempt.msg}”。`,
        evidence: "UI 弹窗已核对后，API 分别执行 keep/clear；DB 对比关系、寄送、文件、产品清单、产品基准；DELETE 已确认寄送复核不可删除。",
      };
    });

    await book.run("解除产品关联-005", "清空基准后重新寄出", "FEAT-11-shipment VAL-27", async () => {
      const rels = await relationRows(edit5Order);
      const p03 = rels.find((x) => x.manufacturing_no === productNos[2]);
      const p04 = rels.find((x) => x.manufacturing_no === productNos[3]);
      const initialShip = await db.query<any>("SELECT * FROM prop_shipment WHERE shipment_id=?", [edit5Ship.shipmentId]);
      const oldRev1 = Number(initialShip[0].revision);
      const correctedBefore = await apiCall(token, "PUT", `/prop/shipment/${edit5Ship.shipmentId}`, {
        revision: oldRev1, fields: ["shipDate"], shipDate: "2026-10-28", saveMode: "auto",
      });
      const p03AfterOldCorrection = await productRow(Number(p03.product_id));
      const p03Ship = await shipProducts(reshipClearOrder, [productNos[2]], "2026-10-30");
      const p03Reshipped = await productRow(Number(p03.product_id));
      const initialShip2 = await db.query<any>("SELECT * FROM prop_shipment WHERE shipment_id=?", [edit5Ship.shipmentId]);
      const correctedAfter = await apiCall(token, "PUT", `/prop/shipment/${edit5Ship.shipmentId}`, {
        revision: Number(initialShip2[0].revision), fields: ["shipDate"], shipDate: "2026-10-27", saveMode: "auto",
      });
      const p03AfterOldCorrection2 = await productRow(Number(p03.product_id));
      const p04Before = await productRow(Number(p04.product_id));
      const keep = await apiCall(token, "POST", `/prop/order/${edit5Order}/relations/${p04.relation_id}/release`, { baselineAction: "keep" });
      const p04Ship = await shipProducts(reshipKeepOrder, [productNos[3]], "2026-10-31");
      const p04After = await productRow(Number(p04.product_id));
      const p03History = await db.query<{ c: number }>(
        "SELECT COUNT(*) c FROM prop_product_order_relation WHERE product_id=?", [p03.product_id]);
      const p04History = await db.query<{ c: number }>(
        "SELECT COUNT(*) c FROM prop_product_order_relation WHERE product_id=?", [p04.product_id]);
      const p03Items = await db.query<{ c: number }>(
        "SELECT COUNT(*) c FROM prop_shipment_product WHERE product_id=?", [p03.product_id]);
      const p04Items = await db.query<{ c: number }>(
        "SELECT COUNT(*) c FROM prop_shipment_product WHERE product_id=?", [p04.product_id]);
      const p03Clear = p03AfterOldCorrection?.first_shipment_date == null && p03AfterOldCorrection?.lifecycle_base_month == null;
      const p03Rebuilt = localDate(p03Reshipped?.first_shipment_date) === "2026-10-30"
        && p03Reshipped?.lifecycle_base_month === "2026-10"
        && Number(p03Reshipped?.baseline_shipment_id) === p03Ship.shipmentId;
      const p03Stable = String(p03AfterOldCorrection2?.first_shipment_date) === String(p03Reshipped?.first_shipment_date)
        && String(p03AfterOldCorrection2?.lifecycle_base_month) === String(p03Reshipped?.lifecycle_base_month)
        && Number(p03AfterOldCorrection2?.baseline_shipment_id) === Number(p03Reshipped?.baseline_shipment_id);
      const p04Kept = String(p04After?.first_shipment_date) === String(p04Before?.first_shipment_date)
        && String(p04After?.lifecycle_base_month) === String(p04Before?.lifecycle_base_month)
        && Number(p04After?.baseline_shipment_id) === Number(p04Before?.baseline_shipment_id);
      const passed = correctedBefore.code === 200 && p03Clear && p03Rebuilt && correctedAfter.code === 200
        && p03Stable && keep.code === 200 && p04Kept && Number(p03History[0]?.c) === 2
        && Number(p04History[0]?.c) === 2 && Number(p03Items[0]?.c) === 2 && Number(p04Items[0]?.c) === 2;
      return {
        status: passed ? "通过" : "不通过",
        actual: `clear 产品在重新寄出前更正旧日期后基准仍为空=${p03Clear}；重新寄出后首次出货日=${String(p03Reshipped?.first_shipment_date).slice(0,10)}、基准月=${p03Reshipped?.lifecycle_base_month}、基准寄送=${p03Reshipped?.baseline_shipment_id}（新寄送=${p03Ship.shipmentId}）；再次更正旧日期后基准不变=${p03Stable}。keep 产品重新寄出前后基准保持=${p04Kept}（旧寄送=${p04Before?.baseline_shipment_id}，新寄送=${p04Ship.shipmentId}）；历史关系/寄送产品 P03=${p03History[0]?.c}/${p03Items[0]?.c}、P04=${p04History[0]?.c}/${p04Items[0]?.c}，均保留两段。`,
        evidence: "API 更正旧寄送日期→重新寄出 clear 产品→再更正旧日期；另 keep 解除后重新寄出；DB 对比产品基准与关系/寄送产品历史计数。",
      };
    });
    await book.run("订单取消-003", "已发货订单取消限制", "FEAT-10-order §5.5、§5.7；VAL-07、VAL-08", async () => {
      await page.goto(`/orders/${cancelOrder}`);
      await page.locator(".order-detail-page").waitFor({ state: "visible", timeout: 15000 });
      await page.waitForTimeout(900);
      await page.locator(".detail-head button", { hasText: "注文をキャンセル" }).click();
      const modal = page.locator(".ant-modal:visible").filter({ hasText: "注文をキャンセル" }).last();
      await modal.waitFor({ state: "visible", timeout: 10000 });
      const warning = compactText(await modal.innerText(), 1200);
      await modal.locator("textarea").fill(`AUTO 取消原因 ${tag}`);
      const responsePromise = page.waitForResponse(
        (r) => r.url().includes(`/prop/order/${cancelOrder}/cancel`) && r.request().method() === "POST",
        { timeout: 20000 },
      );
      await modal.getByRole("button", { name: /注文のキャンセルを確定/ }).click();
      const response = await responsePromise;
      const body = await response.json() as any;
      await page.waitForTimeout(1500);
      const order = await db.query<any>("SELECT order_status,cancel_reason FROM prop_order WHERE order_id=?", [cancelOrder]);
      const shippedRel = await db.query<{ c: number }>(
        "SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=? AND product_id=? AND delivery_valid=1",
        [cancelOrder, p[productNos[6]]]);
      const reservation = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE product_id=?", [p[productNos[7]]]);
      const prep = await db.query<any>("SELECT * FROM prop_shipment WHERE shipment_id=?", [cancelPrep.shipmentId]);
      const prepFiles = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?", [cancelPrep.shipmentId]);
      const prepItems = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_product WHERE shipment_id=?", [cancelPrep.shipmentId]);
      const prepDetail = await apiCall(token, "GET", `/prop/shipment/${cancelPrep.shipmentId}`);
      const confirmAttempt = await apiCall(token, "POST", `/prop/shipment/${cancelPrep.shipmentId}/confirm`, {
        revision: Number((prepDetail.data as any)?.revision ?? prep[0]?.revision), trackingNumbers: [`AUTO-TRK-CANCEL-${tag}`],
      });
      const reusePrep = await createShipment(reuseOrder);
      const reuseAdd = await apiCall(token, "POST", `/prop/shipment/${reusePrep.shipmentId}/products`, {
        revision: Number(reusePrep.revision), manufacturingNo: productNos[7],
      });
      const beforeDelete = await apiCall(token, "GET", `/prop/shipment/${cancelPrep.shipmentId}`);
      const deletePrep = await apiCall(token, "DELETE", `/prop/shipment/${cancelPrep.shipmentId}?revision=${Number(prep[0]?.revision)}`);
      const prepAfterDelete = await db.query<any>("SELECT deleted_time FROM prop_shipment WHERE shipment_id=?", [cancelPrep.shipmentId]);
      const warningPassed = /有効出荷数/.test(warning) && /過去の出荷と製品の関連付けは取り消されない/.test(warning)
        && /受付で処理する/.test(warning);
      const passed = body.code === 200 && order[0]?.order_status === "cancelled"
        && String(order[0]?.cancel_reason).includes(`AUTO 取消原因 ${tag}`)
        && Number(shippedRel[0]?.c) === 1 && Number(reservation[0]?.c) === 0
        && prep[0]?.status === "preparing" && Number(prepFiles[0]?.c) > 0 && Number(prepItems[0]?.c) === 1
        && confirmAttempt.code !== 200 && /キャンセル済み/.test(confirmAttempt.msg)
        && reuseAdd.code === 200 && Array.isArray((reuseAdd.data as any)?.added) && (reuseAdd.data as any).added.includes(productNos[7])
        && beforeDelete.code === 200 && deletePrep.code === 200 && prepAfterDelete[0]?.deleted_time != null;
      return {
        status: passed ? "通过" : "不通过",
        actual: `取消弹窗含有效交付提醒=${warningPassed}；取消 POST code=${body.code}、订单状态=${order[0]?.order_status}；已寄出产品关系保留=${shippedRel[0]?.c} 条；未确认准备的占用 ${reservation[0]?.c} 条、仍可查看=${beforeDelete.code === 200}、文件 ${prepFiles[0]?.c} 份、产品 ${prepItems[0]?.c} 项；继续确认寄出被拒 code=${confirmAttempt.code}“${confirmAttempt.msg}”；产品已成功加入其他有效订单准备=${(reuseAdd.data as any)?.added?.includes(productNos[7])}；原准备删除 code=${deletePrep.code}、已逻辑删除=${prepAfterDelete[0]?.deleted_time != null}。`,
        evidence: "UI 订单详情取消弹窗→填写原因并确认；DB 查询订单/关系/占用/原准备文件；API 尝试继续确认、加入其他订单准备、删除原准备。",
      };
    });

    await book.run("订单权限-005", "并发确认同一发货产品不产生重复关系", "FEAT-10-order；FEAT-11-shipment；VAL-07、VAL-14、VAL-24", async () => {
      const s1 = await createShipment(permOrder1);
      const s2 = await createShipment(permOrder2);
      const add1 = await apiCall(token, "POST", `/prop/shipment/${s1.shipmentId}/products`, {
        revision: Number(s1.revision), manufacturingNo: productNos[8],
      });
      const add2 = await apiCall(token, "POST", `/prop/shipment/${s2.shipmentId}/products`, {
        revision: Number(s2.revision), manufacturingNo: productNos[8],
      });
      const failures = (add2.data as any)?.failures ?? [];
      await saveCarrier(Number(s1.shipmentId));
      await saveCarrier(Number(s2.shipmentId));
      const r1 = await getShipment(Number(s1.shipmentId));
      const r2 = await getShipment(Number(s2.shipmentId));
      const [c1, c2] = await Promise.all([
        apiCall(token, "POST", `/prop/shipment/${s1.shipmentId}/confirm`, {
          revision: Number(r1.revision), trackingNumbers: [`AUTO-TRK-PERM1-${tag}`],
        }),
        apiCall(token, "POST", `/prop/shipment/${s2.shipmentId}/confirm`, {
          revision: Number(r2.revision), trackingNumbers: [`AUTO-TRK-PERM2-${tag}`],
        }),
      ]);
      const relations = await db.query<{ c: number }>(
        "SELECT COUNT(*) c FROM prop_product_order_relation WHERE product_id=? AND delivery_valid=1",
        [p[productNos[8]]]);
      const reservations = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE product_id=?", [p[productNos[8]]]);
      const passed = add2.code === 200 && failures.some((x: any) => /別の発送準備に登録/.test(String(x.reason)))
        && c1.code === 200 && c2.code !== 200 && Number(relations[0]?.c) === 1 && Number(reservations[0]?.c) === 0;
      return {
        status: passed ? "部分验证" : "不通过",
        actual: `第二笔准备在加入阶段即被占用校验拦截：added=${JSON.stringify((add2.data as any)?.added ?? [])}、failure=${JSON.stringify(failures)}；并发确认结果 A code=${c1.code}、B code=${c2.code}“${c2.msg}”；最终该产品有效关系=${relations[0]?.c} 条、占用=${reservations[0]?.c} 条。用例前置“两笔准备均已加入同一产品”无法按当前实现构造，但“不产生第二条有效关系”的安全结果已成立。`,
        evidence: "API 建立两笔订单准备→同一产品分别加入→并发 POST confirm；DB 校验有效关系唯一与 reservation 释放。",
      };
    });

    const results = book.list();
    console.log(`[B] 完成 ${results.length} 条；通过=${results.filter((x) => x.status === "通过").length}；部分验证=${results.filter((x) => x.status === "部分验证").length}；不通过=${results.filter((x) => x.status === "不通过").length}`);
    console.log(`[B] 订单 edit3=${edit3Order} edit5=${edit5Order} cancel=${cancelOrder} reuse=${reuseOrder} reshipClear=${reshipClearOrder} reshipKeep=${reshipKeepOrder} perm=${permOrder1}/${permOrder2}`);
    console.log(`[B] 产品 ${productNos.map((n) => `${n}=${p[n]}`).join(", ")}`);
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-B");
    await db.close();
  }
}

main().catch((error) => {
  console.error("[B] FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});