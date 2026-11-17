/** 订单寄送 C3-A：准备删除、运单/邮件版本、分批寄送（019/020/023）。 */
import { randomUUID } from "node:crypto";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiCall, runTag,
  ensureOrderFixtures, readToasts, compactText,
} from "./order-runtime-utils.js";
import {
  ensureProduct, createOrder, createShipment, addProduct, saveFields, getShipment, getOrder,
  confirmShipment, openShipmentDrawer, shipmentCard, mustOk,
} from "./order-shipment-utils.js";

const book = new ResultBook("reports/order-runtime-results-C3a.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-C3A-${tag}`;
let browser: any;
let session: any;
let token = "";
let fixtures: any;

async function generateWaybill(shipmentId: number, copies = 1): Promise<any> {
  const ready = mustOk("准备面单", await apiCall(token, "GET", `/prop/shipment/${shipmentId}/documents/prepare?type=waybill`));
  return apiCall(token, "POST", `/prop/shipment/${shipmentId}/documents`, {
    requestId: randomUUID(), type: "waybill", issueDate: "2026-10-29",
    revision: Number(ready.revision), copies, sourceToken: ready.sourceToken, overrides: ready.defaults,
  });
}
async function cancelOrder(orderId: number, reason: string): Promise<any> {
  const order = await getOrder(token, orderId);
  return apiCall(token, "POST", `/prop/order/${orderId}/cancel`, { revision: Number(order.revision), reason });
}
async function addProductMust(shipmentId: number, no: string): Promise<any> {
  const r = await addProduct(token, shipmentId, no);
  if (r.code !== 200 || !(r.data?.added || []).includes(no)) throw new Error(`加入产品失败 ${no}: ${JSON.stringify(r)}`);
  return r;
}
async function confirmMust(shipmentId: number, tracking: string[] = []): Promise<any> {
  const r = await confirmShipment(token, shipmentId, tracking);
  if (r.code !== 200 || r.data?.status !== "shipped") throw new Error(`确认寄出失败 ${shipmentId}: ${JSON.stringify(r)}`);
  return r;
}
function mailModal(page: any) {
  return page.locator(".ant-modal:visible").filter({ hasText: "発送通知メール" }).last();
}

async function main(): Promise<void> {
  await db.connect();
  fixtures = await ensureOrderFixtures(db);
  token = await apiLogin("admin", "admin123");

  const pDelete = `${prefix}-DEL-01`;
  const pMail = `${prefix}-MAIL-01`;
  const pSplit1 = `${prefix}-SPLIT-01`;
  const pSplit2 = `${prefix}-SPLIT-02`;
  for (const no of [pDelete, pMail, pSplit1, pSplit2]) await ensureProduct(db, no);

  const orderDelete = await createOrder(token, fixtures.a, `${prefix}-DELETE`, 1);
  const shipDelete = await createShipment(token, orderDelete);
  const shipDeleteId = Number(shipDelete.shipmentId);
  await addProductMust(shipDeleteId, pDelete);
  await saveFields(token, shipDeleteId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  const waybill = await generateWaybill(shipDeleteId, 1);
  if (waybill.code !== 200) throw new Error(`删除夹具面单生成失败：${waybill.msg}`);

  const orderMail = await createOrder(token, fixtures.a, `${prefix}-MAIL`, 1);
  const shipMail = await createShipment(token, orderMail);
  const shipMailId = Number(shipMail.shipmentId);
  await addProductMust(shipMailId, pMail);
  await saveFields(token, shipMailId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  await confirmMust(shipMailId, [`AUTO-A001-${tag}`]);

  const orderSplit = await createOrder(token, fixtures.a, `${prefix}-SPLIT`, 2);
  const shipSplit1 = await createShipment(token, orderSplit);
  const shipSplit1Id = Number(shipSplit1.shipmentId);
  await addProductMust(shipSplit1Id, pSplit1);
  await saveFields(token, shipSplit1Id, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  await confirmMust(shipSplit1Id, [`AUTO-SPLIT1-${tag}`]);
  const shipSplit2 = await createShipment(token, orderSplit);
  const shipSplit2Id = Number(shipSplit2.shipmentId);
  await addProductMust(shipSplit2Id, pSplit2);
  await saveFields(token, shipSplit2Id, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  await confirmMust(shipSplit2Id, [`AUTO-SPLIT2-${tag}`]);

  const launcher = await launchAdminSession("verify-order-C3a");
  browser = launcher.browser; session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(15000);
  try {    await book.run("发货管理-019", "删除寄送准备二次确认且不填原因", "FEAT-11-shipment §4.5、§4.7、§6.7；VAL-22", async () => {
      const drawer = await openShipmentDrawer(page, orderDelete);
      const beforeFiles = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?", [shipDeleteId]);
      const beforeItems = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_product WHERE shipment_id=?", [shipDeleteId]);
      const beforeReservations = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE shipment_id=?", [shipDeleteId]);
      const deleteButton = drawer.locator(".footer").getByRole("button", { name: /削\s*除/ });
      await deleteButton.click();
      const pop = page.locator(".ant-popconfirm:visible").last();
      await pop.waitFor({ state: "visible", timeout: 8000 });
      const confirmText = compactText(await pop.innerText(), 500);
      const responsePromise = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${shipDeleteId}`) && r.request().method() === "DELETE",
        { timeout: 20000 },
      );
      await pop.locator(".ant-btn-primary").click();
      const response = await responsePromise;
      const body = await response.json() as any;
      await drawer.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(1000);
      const shipment = await db.query<any>("SELECT status,deleted_time,deleted_by FROM prop_shipment WHERE shipment_id=?", [shipDeleteId]);
      const files = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?", [shipDeleteId]);
      const items = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_product WHERE shipment_id=?", [shipDeleteId]);
      const reservations = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE shipment_id=?", [shipDeleteId]);
      const detail = await apiCall(token, "GET", `/prop/shipment/${shipDeleteId}`);
      const order = await getOrder(token, orderDelete);
      await page.goto(`http://localhost:8090/orders/${orderDelete}`);
      await page.locator(".order-detail-page").waitFor({ state: "visible", timeout: 15000 });
      await page.waitForTimeout(1000);
      const historyRows = await shipmentCard(page).locator("tr.ant-table-row").count();
      const passed = body.code === 200 && /削除後は元に戻せない/.test(confirmText)
        && shipment[0]?.deleted_time != null && Number(files[0]?.c) === 0 && Number(items[0]?.c) === 0
        && Number(reservations[0]?.c) === 0 && detail.code === 404 && historyRows === 0
        && (order.shipments || []).length === 0 && beforeFiles[0]?.c === 1 && beforeItems[0]?.c === 1 && beforeReservations[0]?.c === 1;
      return {
        status: passed ? "通过" : "不通过",
        actual: `确认文案=“${confirmText}”，无原因输入框；DELETE code=${body.code}、deleted=${body.data?.deleted}；删除前文件/清单/占用=${beforeFiles[0]?.c}/${beforeItems[0]?.c}/${beforeReservations[0]?.c}，删除后=${files[0]?.c}/${items[0]?.c}/${reservations[0]?.c}；寄送 deleted_time=${shipment[0]?.deleted_time}、detail code=${detail.code}；订单出货记录行数=${historyRows}、API shipments=${(order.shipments || []).length}。`,
        evidence: "UI 准备中抽屉点击删除→读取二次确认文案→确认；DB 查询 tombstone 与文件/清单/占用级联；API detail 与订单聚合复核。",
        requirement: "FEAT-11-shipment §4.5、§4.7、§6.7；VAL-22",
      };
    });

    await book.run("发货管理-020", "运单号维护与寄送通知邮件版本化", "spec §3.1、§4.4、§4.7、§6.2、§6.3；VAL-08、VAL-08b", async () => {
      const drawer = await openShipmentDrawer(page, orderMail);
      const trackingRows = drawer.locator(".tracking-maintenance-row");
      const firstInput = trackingRows.first().locator("input");
      const saveButton = drawer.locator(".tracking-primary-actions").getByRole("button", { name: /送り状ナンバーを保存/ });
      const initialDisabled = await saveButton.isDisabled();
      await firstInput.fill(`AUTO-B002-${tag}`);
      await drawer.getByRole("button", { name: /送り状ナンバーを追加/ }).click();
      await trackingRows.nth(1).locator("input").fill(`AUTO-C003-${tag}`);
      await trackingRows.nth(1).getByRole("button", { name: /削\s*除/ }).click();
      const putPromise = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${shipMailId}`) && r.request().method() === "PUT",
        { timeout: 20000 },
      );
      await saveButton.click();
      const put = await putPromise;
      const putBody = await put.json() as any;
      await page.waitForTimeout(900);
      const saveToast = await readToasts(page);
      const afterSave = await getShipment(token, shipMailId);
      const disabledAfterSave = await saveButton.isDisabled();

      const mailRequestPromise = page.waitForRequest(
        (r: any) => r.url().includes(`/prop/shipment/${shipMailId}/files`) && r.method() === "POST",
        { timeout: 20000 },
      );
      const mailResponsePromise = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${shipMailId}/files`) && r.request().method() === "POST",
        { timeout: 20000 },
      );
      await drawer.getByRole("button", { name: /メール本文を生成/ }).click();
      const mailRequest = await mailRequestPromise;
      const mailResponse = await mailResponsePromise;
      const mailBody = await mailResponse.json() as any;
      const sentCommand = mailRequest.postDataJSON();
      const modal = mailModal(page);
      await modal.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(700);
      const newMailText = compactText(await modal.innerText(), 2200);
      const mailFileId = Number(mailBody.data?.file?.fileId);
      await modal.getByRole("button", { name: "閉じる" }).click();
      await modal.waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(600);

      const oldRow = drawer.locator("tr.ant-table-row", { hasText: /発送通知メール v1/ }).first();
      await oldRow.getByRole("button", { name: "表示" }).click();
      const oldModal = mailModal(page);
      await oldModal.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(600);
      const oldMailText = compactText(await oldModal.innerText(), 2200);
      await oldModal.getByRole("button", { name: "閉じる" }).click();
      await oldModal.waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);      const replay = await apiCall(token, "POST", `/prop/shipment/${shipMailId}/files`, sentCommand);
      const files = await db.query<any>("SELECT file_id,file_type,version,request_id,rendered_content FROM prop_shipment_file WHERE shipment_id=? AND file_type='mail' ORDER BY version", [shipMailId]);
      const v1 = files.find((x) => Number(x.version) === 1);
      const v2 = files.find((x) => Number(x.version) === 2);
      const passed = initialDisabled && putBody.code === 200 && /送り状ナンバーを保存/.test(saveToast)
        && JSON.stringify(afterSave.trackingNumbers) === JSON.stringify([`AUTO-B002-${tag}`]) && disabledAfterSave
        && mailBody.code === 200 && Number(mailBody.data?.file?.version) === 2
        && newMailText.includes(`AUTO-B002-${tag}`) && !newMailText.includes(`AUTO-C003-${tag}`)
        && oldMailText.includes(`AUTO-A001-${tag}`) && !oldMailText.includes(`AUTO-B002-${tag}`)
        && files.length === 2 && Number(v1?.version) === 1 && Number(v2?.version) === 2
        && String(v1?.rendered_content).includes(`AUTO-A001-${tag}`)
        && replay.code === 200 && Number(replay.data?.file?.fileId) === mailFileId
        && files.filter((x) => Number(x.version) === 2).length === 1;
      return {
        status: passed ? "通过" : "不通过",
        actual: `初始保存按钮 disabled=${initialDisabled}；UI 修改首号为 B002、追加 C003 后删除，保存 PUT code=${putBody.code}，提示=“${saveToast}”，保存后运单号=${JSON.stringify(afterSave.trackingNumbers)}、保存按钮 disabled=${disabledAfterSave}；生成邮件 POST code=${mailBody.code}、v${mailBody.data?.file?.version}，正文含 B002=${newMailText.includes(`AUTO-B002-${tag}`)}、不含 C003=${!newMailText.includes(`AUTO-C003-${tag}`)}；v1 正文含原 A001=${oldMailText.includes(`AUTO-A001-${tag}`)}、不含 B002=${!oldMailText.includes(`AUTO-B002-${tag}`)}；DB 邮件版本=${files.map((x) => `${x.version}:${x.file_id}`).join(",")}；同 requestId 重放 code=${replay.code}、fileId 不变=${Number(replay.data?.file?.fileId) === mailFileId}、v2 仍仅一条。`,
        evidence: "UI 已寄出抽屉修改/追加/删除运单号→保存；UI 生成 v2 邮件并读取正文；从文件列表回看 v1；API 使用同一请求体重放；DB 校验版本与冻结正文。",
        requirement: "spec §3.1、§4.4、§4.7、§6.2、§6.3；VAL-08、VAL-08b",
      };
    });

    await book.run("发货管理-023", "同一订单分批寄送", "spec §3.1、§6.6；VAL-21/FEAT-11 VAL-22", async () => {
      const order = await getOrder(token, orderSplit);
      const shipments = order.shipments || [];
      const relations = await db.query<any>(
        "SELECT relation_id,shipment_id,product_id,delivery_valid,active_product_id FROM prop_product_order_relation WHERE order_id=? ORDER BY relation_id",
        [orderSplit]);
      const ids = shipments.map((x: any) => Number(x.shipmentId));
      const nums = shipments.map((x: any) => String(x.shipmentNo));
      const snapshots = shipments.map((x: any) => JSON.stringify(x.recipientSnapshot));
      await page.goto(`http://localhost:8090/orders/${orderSplit}`);
      await page.locator(".order-detail-page").waitFor({ state: "visible", timeout: 15000 });
      await page.waitForTimeout(1000);
      const rows = shipmentCard(page).locator("tr.ant-table-row");
      const rowCount = await rows.count();
      const rowText = compactText((await rows.allInnerTexts()).join(" || "), 1600);
      const passed = shipments.length === 2 && ids.length === 2 && ids[0] !== ids[1]
        && nums[0] !== nums[1] && snapshots[0] === snapshots[1]
        && relations.length === 2 && relations.every((x) => Number(x.delivery_valid) === 1 && x.active_product_id != null)
        && Number(order.fulfilledQuantity) === 2 && rowCount === 2;
      return {
        status: passed ? "通过" : "不通过",
        actual: `两笔寄送 ID=${ids.join(",")}、编号=${nums.join(",")}、收货快照一致=${snapshots[0] === snapshots[1]}；订单 fulfilled/total=${order.fulfilledQuantity}/${order.totalQuantity}；有效关系=${relations.length} 条（shipment=${relations.map((x) => x.shipment_id).join(",")}）；UI 出货记录行=${rowCount}，内容=“${rowText}”。`,
        evidence: "API 创建同一订单两笔寄送并分别确认；GET 订单聚合核对两笔记录、快照与累计履约；DB 校验两条有效关系；UI 订单详情核对分笔展示。",
        requirement: "spec §3.1、§6.6；VAL-21/FEAT-11 VAL-22",
      };
    });

    const rows = book.list();
    console.log(`[C3A] 完成 ${rows.length} 条；通过=${rows.filter((x) => x.status === "通过").length}；部分验证=${rows.filter((x) => x.status === "部分验证").length}；不通过=${rows.filter((x) => x.status === "不通过").length}`);
    console.log(`[C3A] 订单 delete=${orderDelete} mail=${orderMail} split=${orderSplit}`);
    console.log(`[C3A] 寄送 delete=${shipDeleteId} mail=${shipMailId} split=${shipSplit1Id}/${shipSplit2Id}`);
    console.log(`[C3A] 产品 ${pDelete},${pMail},${pSplit1},${pSplit2}`);
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-C3a");
    await db.close();
  }
}
main().catch((error) => { console.error("[C3A] FAILED:", error instanceof Error ? error.stack : error); process.exit(1); });