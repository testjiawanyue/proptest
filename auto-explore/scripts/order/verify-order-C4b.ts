/** 订单寄送 C4-B：订单类型与基准更正、准备独占（026/027）。 */
import { randomUUID } from "node:crypto";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiCall, runTag,
  ensureOrderFixtures, readToasts, compactText, formItem,
} from "./order-runtime-utils.js";
import {
  ensureProduct, createOrder, createShipment, addProduct, removeProduct, saveFields, getShipment, getOrder,
  confirmShipment, openShipmentDrawer, mustOk,
} from "./order-shipment-utils.js";

const book = new ResultBook("reports/order-runtime-results-C4b.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-C4B-${tag}`;
let browser: any;
let session: any;
let token = "";
let fixtures: any;

function isoDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return typeof value === "string" ? value.slice(0, 10) : "";
}

async function addOrThrow(shipmentId: number, no: string): Promise<any> {
  const r = await addProduct(token, shipmentId, no);
  if (r.code !== 200 || !(r.data?.added || []).includes(no)) throw new Error(`加入产品失败 ${no}: ${JSON.stringify(r)}`);
  return r;
}
async function confirmMust(shipmentId: number, tracking: string[] = []): Promise<any> {
  const r = await confirmShipment(token, shipmentId, tracking);
  if (r.code !== 200 || r.data?.status !== "shipped") throw new Error(`确认寄出失败 ${shipmentId}: ${JSON.stringify(r)}`);
  return r;
}
async function cancelOrder(orderId: number, reason: string): Promise<any> {
  const order = await getOrder(token, orderId);
  return apiCall(token, "POST", `/prop/order/${orderId}/cancel`, { revision: Number(order.revision), reason });
}
async function generateWaybill(shipmentId: number): Promise<any> {
  const ready = mustOk("准备面单", await apiCall(token, "GET", `/prop/shipment/${shipmentId}/documents/prepare?type=waybill`));
  return apiCall(token, "POST", `/prop/shipment/${shipmentId}/documents`, {
    requestId: randomUUID(), type: "waybill", issueDate: "2026-10-29",
    revision: Number(ready.revision), copies: 1, sourceToken: ready.sourceToken, overrides: ready.defaults,
  });
}

async function main(): Promise<void> {
  await db.connect();
  fixtures = await ensureOrderFixtures(db);
  token = await apiLogin("admin", "admin123");

  const pSale = `${prefix}-TYPE-SALE`;
  const pRental = `${prefix}-TYPE-RENTAL`;
  const pReplacement = `${prefix}-TYPE-REPLACE`;
  const pSame = `${prefix}-OCC-SAME`;
  const pCross = `${prefix}-OCC-CROSS`;
  const pCancel = `${prefix}-OCC-CANCEL`;
  for (const no of [pSale, pRental, pReplacement, pSame, pCross, pCancel]) await ensureProduct(db, no);
  const productRows = await db.query<any>("SELECT product_id,manufacturing_no FROM prop_product WHERE manufacturing_no IN (?,?,?,?,?,?)", [pSale,pRental,pReplacement,pSame,pCross,pCancel]);
  const p = Object.fromEntries(productRows.map((x: any) => [x.manufacturing_no, Number(x.product_id)]));

  const typed: Array<{ type: "sale" | "rental" | "replacement"; product: string; orderId: number; shipmentId: number }> = [];
  for (const [type, product] of [["sale", pSale], ["rental", pRental], ["replacement", pReplacement]] as const) {
    const orderId = await createOrder(token, fixtures.a, `${prefix}-${type.toUpperCase()}`, 1, type);
    const shipment = await createShipment(token, orderId, "2026-09-15");
    const shipmentId = Number(shipment.shipmentId);
    await addOrThrow(shipmentId, product);
    await saveFields(token, shipmentId, { carrier: "yamato", shipDate: "2026-09-15", boxCount: 1 });
    await confirmMust(shipmentId, [`AUTO-TYPE-${type}-${tag}`]);
    typed.push({ type, product, orderId, shipmentId });
  }
  const saleFixture = typed.find((x) => x.type === "sale")!;
  const saleProductId = p[pSale];
  const saleProductBefore = await db.query<any>("SELECT first_shipment_date,lifecycle_base_month,baseline_shipment_id FROM prop_product WHERE product_id=?", [saleProductId]);
  const saleFilesBefore = await db.query<any>("SELECT file_id,file_type,version,rendered_content FROM prop_shipment_file WHERE shipment_id=? ORDER BY file_id", [saleFixture.shipmentId]);
  const saleRelationsBefore = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=? AND delivery_valid=1", [saleFixture.orderId]);

  const orderO1 = await createOrder(token, fixtures.a, `${prefix}-OCC-O1`, 2);
  const sameA = await createShipment(token, orderO1);
  const sameB = await createShipment(token, orderO1);
  const sameAId = Number(sameA.shipmentId);
  const sameBId = Number(sameB.shipmentId);
  const orderO2 = await createOrder(token, fixtures.a, `${prefix}-OCC-O2`, 1);
  const crossO2 = await createShipment(token, orderO2);
  const crossO2Id = Number(crossO2.shipmentId);
  const orderO3 = await createOrder(token, fixtures.a, `${prefix}-OCC-O3`, 1);
  const reuseO3 = await createShipment(token, orderO3);
  const reuseO3Id = Number(reuseO3.shipmentId);

  const launcher = await launchAdminSession("verify-order-C4b");
  browser = launcher.browser; session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(15000);
  try {    await book.run("发货管理-026", "订单类型不限制产品与首次日期更正", "spec10-28 FEAT-11-shipment VAL-24", async () => {
      const drawer = await openShipmentDrawer(page, saleFixture.orderId);
      const dateInput = formItem(drawer, "発送日").locator("input").first();
      const putPromise = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${saleFixture.shipmentId}`) && r.request().method() === "PUT",
        { timeout: 20000 },
      );
      await dateInput.fill("2026-10-20");
      await dateInput.press("Tab");
      const put = await putPromise;
      const putBody = await put.json() as any;
      await page.waitForTimeout(1200);
      const toast = await readToasts(page);
      const productAfter = await db.query<any>("SELECT first_shipment_date,lifecycle_base_month,baseline_shipment_id FROM prop_product WHERE product_id=?", [saleProductId]);
      const saleFilesAfter = await db.query<any>("SELECT file_id,file_type,version,rendered_content FROM prop_shipment_file WHERE shipment_id=? ORDER BY file_id", [saleFixture.shipmentId]);
      const saleRelationsAfter = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=? AND delivery_valid=1", [saleFixture.orderId]);
      const saleOrderAfter = await getOrder(token, saleFixture.orderId);
      const saleShipmentAfter = await getShipment(token, saleFixture.shipmentId);
      const typeStatuses = await Promise.all(typed.map(async (x) => {
        const ship = await getShipment(token, x.shipmentId);
        const rel = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=? AND delivery_valid=1", [x.orderId]);
        return { type: x.type, status: ship.status, relations: Number(rel[0]?.c) };
      }));
      const typesOk = typeStatuses.every((x) => x.status === "shipped" && x.relations === 1);
      const filesUnchanged = JSON.stringify(saleFilesBefore) === JSON.stringify(saleFilesAfter);
      const passed = typesOk && putBody.code === 200
        && isoDate(productAfter[0]?.first_shipment_date) === "2026-10-20"
        && productAfter[0]?.lifecycle_base_month === "2026-10"
        && Number(productAfter[0]?.baseline_shipment_id) === saleFixture.shipmentId
        && String(saleProductBefore[0]?.baseline_shipment_id) === String(productAfter[0]?.baseline_shipment_id)
        && saleRelationsBefore[0]?.c === saleRelationsAfter[0]?.c && Number(saleOrderAfter.fulfilledQuantity) === 1
        && filesUnchanged && saleShipmentAfter.status === "shipped";
      return {
        status: passed ? "通过" : "不通过",
        actual: `销售/租赁/替代订单寄出结果=${JSON.stringify(typeStatuses)}；销售单更正发运日 2026-09-15→2026-10-20：PUT code=${putBody.code}、提示=“${toast}”；产品首次出货日=${isoDate(productAfter[0]?.first_shipment_date)}、基准月=${productAfter[0]?.lifecycle_base_month}、基准寄送=${productAfter[0]?.baseline_shipment_id}（原=${saleProductBefore[0]?.baseline_shipment_id}）；有效关系 ${saleRelationsBefore[0]?.c}→${saleRelationsAfter[0]?.c}、订单履约=${saleOrderAfter.fulfilledQuantity}；既有文件 ${saleFilesBefore.length} 份、内容未改=${filesUnchanged}；寄送状态=${saleShipmentAfter.status}。`,
        evidence: "API 分别创建销售/租赁/替代订单并寄出；UI 已寄出抽屉修改发运日等待自动保存；DB 对比产品首次出货日/基准月/基准寄送、订单关系与文件快照。",
        requirement: "spec10-28 FEAT-11-shipment VAL-24",
      };
    });

    await book.run("发货管理-027", "准备独占产品", "spec10-28 FEAT-11-shipment VAL-26", async () => {
      const sameRevisionA = Number((await getShipment(token, sameAId)).revision);
      const sameRevisionB = Number((await getShipment(token, sameBId)).revision);
      const sameRace = await Promise.all([
        apiCall(token, "POST", `/prop/shipment/${sameAId}/products`, { revision: sameRevisionA, manufacturingNo: pSame }),
        apiCall(token, "POST", `/prop/shipment/${sameBId}/products`, { revision: sameRevisionB, manufacturingNo: pSame }),
      ]);
      const sameResults = sameRace.map((r, i) => ({ id: i === 0 ? sameAId : sameBId, code: r.code, added: (r.data as any)?.added || [], failures: (r.data as any)?.failures || [] }));
      const sameWinners = sameResults.filter((x) => x.added.includes(pSame));
      const sameLosers = sameResults.filter((x) => !x.added.includes(pSame));
      const sameConflictOk = sameWinners.length === 1 && sameLosers.length === 1
        && /別の発送準備/.test(sameLosers[0]?.failures?.[0]?.reason || "")
        && Number((await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE product_id=?", [p[pSame]]))[0]?.c) === 1;
      const sameWinner = sameResults.find((x) => x.added.includes(pSame))!;
      const sameLoser = sameResults.find((x) => !x.added.includes(pSame))!;
      const removed = await removeProduct(token, sameWinner.id, p[pSame]);
      const readd = await addProduct(token, sameLoser.id, pSame);
      await saveFields(token, sameLoser.id, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
      const sameConfirm = await confirmMust(sameLoser.id, [`AUTO-OCC-SAME-${tag}`]);
      const sameRelation = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=? AND product_id=? AND delivery_valid=1", [orderO1, p[pSame]]);
      const sameReservation = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE product_id=?", [p[pSame]]);

      const crossRevision = Number((await getShipment(token, sameWinner.id)).revision);
      const crossO2Revision = Number((await getShipment(token, crossO2Id)).revision);
      const crossRace = await Promise.all([
        apiCall(token, "POST", `/prop/shipment/${sameWinner.id}/products`, { revision: crossRevision, manufacturingNo: pCross }),
        apiCall(token, "POST", `/prop/shipment/${crossO2Id}/products`, { revision: crossO2Revision, manufacturingNo: pCross }),
      ]);
      const crossResults = crossRace.map((r, i) => ({ id: i === 0 ? sameWinner.id : crossO2Id, code: r.code, added: (r.data as any)?.added || [], failures: (r.data as any)?.failures || [] }));
      const crossWinners = crossResults.filter((x) => x.added.includes(pCross));
      const crossLosers = crossResults.filter((x) => !x.added.includes(pCross));
      const crossConflictOk = crossWinners.length === 1 && crossLosers.length === 1
        && /別の発送準備/.test(crossLosers[0]?.failures?.[0]?.reason || "");
      const crossWinner = crossResults.find((x) => x.added.includes(pCross))!;
      if (crossWinner.id !== crossO2Id) {
        const rm = await removeProduct(token, crossWinner.id, p[pCross]);
        const toO2 = await addOrThrow(crossO2Id, pCross);
        if (toO2.code !== 200) throw new Error("跨订单释放后重新加入失败");
      }
      await saveFields(token, crossO2Id, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
      const crossConfirm = await confirmMust(crossO2Id, [`AUTO-OCC-CROSS-${tag}`]);
      const crossRelation = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=? AND product_id=? AND delivery_valid=1", [orderO2, p[pCross]]);

      const cancelAdd = await addOrThrow(sameWinner.id, pCancel);
      await saveFields(token, sameWinner.id, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
      const cancelWaybill = await generateWaybill(sameWinner.id);
      const cancelResult = await cancelOrder(orderO1, `AUTO C4B 独占取消 ${tag}`);
      const cancelReservation = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE order_id=?", [orderO1]);
      const cancelShipment = await getShipment(token, sameWinner.id);
      const cancelDetail = await apiCall(token, "GET", `/prop/shipment/${sameWinner.id}`);
      const cancelFilesBefore = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?", [sameWinner.id]);
      const cancelConfirmAttempt = await apiCall(token, "POST", `/prop/shipment/${sameWinner.id}/confirm`, {
        revision: Number(cancelDetail.data?.revision), trackingNumbers: [`AUTO-CANCELLED-${tag}`],
      });
      const deletePrep = await apiCall(token, "DELETE", `/prop/shipment/${sameWinner.id}?revision=${Number(cancelDetail.data?.revision)}`);
      const cancelFilesAfter = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?", [sameWinner.id]);
      const reuseAdd = await addProduct(token, reuseO3Id, pCancel);
      const shippedRelationAfterCancel = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=? AND product_id=? AND delivery_valid=1", [orderO1, p[pSame]]);

      const passed = sameConflictOk && removed.code === 200 && readd.code === 200
        && sameConfirm.code === 200 && Number(sameRelation[0]?.c) === 1 && Number(sameReservation[0]?.c) === 0
        && crossConflictOk && crossConfirm.code === 200 && Number(crossRelation[0]?.c) === 1
        && cancelAdd.code === 200 && cancelWaybill.code === 200 && cancelResult.code === 200
        && Number(cancelReservation[0]?.c) === 0 && cancelShipment.status === "preparing"
        && cancelDetail.code === 200 && Number(cancelFilesBefore[0]?.c) === 1
        && cancelConfirmAttempt.code === 409 && /キャンセル済み/.test(cancelConfirmAttempt.msg)
        && deletePrep.code === 200 && Number(cancelFilesAfter[0]?.c) === 0
        && reuseAdd.code === 200 && (reuseAdd.data as any)?.added?.includes(pCancel)
        && Number(shippedRelationAfterCancel[0]?.c) === 1;
      return {
        status: passed ? "通过" : "不通过",
        actual: `同订单并发加入：${JSON.stringify(sameResults)}，单赢家/明确冲突=${sameConflictOk}；移除赢家后加入另一准备 DELETE code=${removed.code}、重新加入 code=${readd.code}、确认=${sameConfirm.code}、关系=${sameRelation[0]?.c}、占用=${sameReservation[0]?.c}。跨订单并发：${JSON.stringify(crossResults)}，单赢家/明确冲突=${crossConflictOk}；确认 O2=${crossConfirm.code}、O2 关系=${crossRelation[0]?.c}。取消 O1：准备加入产品 code=${cancelAdd.code}、面单=${cancelWaybill.code}、取消 code=${cancelResult.code}；占用释放后=${cancelReservation[0]?.c}；原准备仍 preparing=${cancelShipment.status}、GET=${cancelDetail.code}、文件 ${cancelFilesBefore[0]?.c} 份；继续确认 code=${cancelConfirmAttempt.code}“${cancelConfirmAttempt.msg}”；删除准备 code=${deletePrep.code}、文件剩余=${cancelFilesAfter[0]?.c}；产品加入 O3 code=${reuseAdd.code}、added=${JSON.stringify((reuseAdd.data as any)?.added)}；已寄出关系保留=${shippedRelationAfterCancel[0]?.c}。`,
        evidence: "API 对同订单/跨订单两笔准备并发加入同一产品；DB 校验唯一占用；移除/删除后重新加入并确认；取消订单后核对占用释放、原准备可读可删但不可确认、产品可复用、已寄出关系不变。",
        requirement: "spec10-28 FEAT-11-shipment VAL-26",
      };
    });

    const rows = book.list();
    console.log(`[C4B] 完成 ${rows.length} 条；通过=${rows.filter((x) => x.status === "通过").length}；部分验证=${rows.filter((x) => x.status === "部分验证").length}；不通过=${rows.filter((x) => x.status === "不通过").length}`);
    console.log(`[C4B] 026 类型订单=${typed.map((x) => `${x.type}:${x.orderId}/${x.shipmentId}`).join(",")}`);
    console.log(`[C4B] 027 O1=${orderO1} O2=${orderO2} O3=${orderO3} prep=${sameAId}/${sameBId}/${crossO2Id}/${reuseO3Id}`);
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-C4b");
    await db.close();
  }
}
main().catch((error) => { console.error("[C4B] FAILED:", error instanceof Error ? error.stack : error); process.exit(1); });
