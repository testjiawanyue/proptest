/** 订单寄送 C3-B：确认失败边界与首次生产质检资格（022/030）。 */
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiCall, runTag,
  ensureOrderFixtures, ensureCompany, ensureAddress, ensureContact, readToasts, compactText,
} from "./order-runtime-utils.js";
import {
  ensureProduct, createOrder, createShipment, addProduct, saveFields, getShipment, getOrder,
  confirmShipment, openShipmentDrawer, mustOk,
} from "./order-shipment-utils.js";

const book = new ResultBook("reports/order-runtime-results-C3b.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-C3B-${tag}`;
let browser: any;
let session: any;
let token = "";
let fixtures: any;

async function addProductMust(shipmentId: number, no: string): Promise<any> {
  const r = await addProduct(token, shipmentId, no);
  if (r.code !== 200 || !(r.data?.added || []).includes(no)) throw new Error(`加入产品失败 ${no}: ${JSON.stringify(r)}`);
  return r;
}
async function cancelOrder(orderId: number, reason: string): Promise<any> {
  const order = await getOrder(token, orderId);
  return apiCall(token, "POST", `/prop/order/${orderId}/cancel`, { revision: Number(order.revision), reason });
}
async function confirmMust(shipmentId: number, tracking: string[] = []): Promise<any> {
  const r = await confirmShipment(token, shipmentId, tracking);
  if (r.code !== 200 || r.data?.status !== "shipped") throw new Error(`确认寄出失败 ${shipmentId}: ${JSON.stringify(r)}`);
  return r;
}
async function blockedState(orderId: number, shipmentId: number, productId: number) {
  const relations = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=?", [orderId]);
  const mails = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=? AND file_type='mail'", [shipmentId]);
  const shipment = await db.query<any>("SELECT status,confirmed_time FROM prop_shipment WHERE shipment_id=?", [shipmentId]);
  const product = await db.query<any>("SELECT first_shipment_date,lifecycle_base_month,baseline_shipment_id FROM prop_product WHERE product_id=?", [productId]);
  return { relations: Number(relations[0]?.c), mails: Number(mails[0]?.c), shipment: shipment[0], product: product[0] };
}

async function main(): Promise<void> {
  await db.connect();
  fixtures = await ensureOrderFixtures(db);
  token = await apiLogin("admin", "admin123");

  const pCancelled = `${prefix}-CANCEL-01`;
  const pLinked = `${prefix}-LINKED-01`;
  const pScrapped = `${prefix}-SCRAP-01`;
  const pMissing = `${prefix}-MISSING-01`;
  const pMasterDeleted = `${prefix}-MASTERDEL-01`;
  const pGood = `${prefix}-GOOD-01`;
  const pZero = `${prefix}-ZERO-01`;
  const pMixedOk = `${prefix}-MIX01`;
  const pMixedBad = `${prefix}-MIX02`;
  const pInvalid = `${prefix}-INVALID-01`;
  const pFlip1 = `${prefix}-FLIP-01`;
  const pFlip2 = `${prefix}-FLIP-02`;
  const pDeleted = `${prefix}-DELETED-01`;
  const pScrappedAdd = `${prefix}-SCRAPADD-01`;
  const pQty1 = `${prefix}-QTY-01`;
  const pQty2 = `${prefix}-QTY-02`;
  for (const no of [pCancelled, pLinked, pScrapped, pMissing, pMasterDeleted, pGood, pMixedOk, pInvalid, pFlip1, pFlip2, pScrappedAdd, pQty1, pQty2]) await ensureProduct(db, no);
  await ensureProduct(db, pZero, { inspection: 0 });
  await ensureProduct(db, pMixedBad, { inspection: 0 });
  await ensureProduct(db, pDeleted, { deleted: true });
  const ids = await db.query<any>("SELECT product_id,manufacturing_no FROM prop_product WHERE manufacturing_no IN (" + [pCancelled,pLinked,pScrapped,pMissing,pMasterDeleted,pGood,pZero,pMixedOk,pMixedBad,pInvalid,pFlip1,pFlip2,pDeleted,pScrappedAdd,pQty1,pQty2].map(() => "?").join(",") + ")", [pCancelled,pLinked,pScrapped,pMissing,pMasterDeleted,pGood,pZero,pMixedOk,pMixedBad,pInvalid,pFlip1,pFlip2,pDeleted,pScrappedAdd,pQty1,pQty2]);
  const p = Object.fromEntries(ids.map((x: any) => [x.manufacturing_no, Number(x.product_id)]));

  const orderCancelled = await createOrder(token, fixtures.a, `${prefix}-CANCEL`, 1);
  const shipCancelled = await createShipment(token, orderCancelled);
  const shipCancelledId = Number(shipCancelled.shipmentId);
  await addProductMust(shipCancelledId, pCancelled);
  await saveFields(token, shipCancelledId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  const cancelled = await cancelOrder(orderCancelled, `AUTO C3B cancel ${tag}`);
  if (cancelled.code !== 200) throw new Error(`取消夹具订单失败：${cancelled.msg}`);

  const orderLinked1 = await createOrder(token, fixtures.a, `${prefix}-LINK1`, 1);
  const shipLinked1 = await createShipment(token, orderLinked1);
  const shipLinked1Id = Number(shipLinked1.shipmentId);
  await addProductMust(shipLinked1Id, pLinked);
  await saveFields(token, shipLinked1Id, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  await confirmMust(shipLinked1Id, [`AUTO-LINK1-${tag}`]);
  const orderLinked2 = await createOrder(token, fixtures.a, `${prefix}-LINK2`, 1);
  const shipLinked2 = await createShipment(token, orderLinked2);
  const shipLinked2Id = Number(shipLinked2.shipmentId);
  await saveFields(token, shipLinked2Id, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  await db.execute(
    `INSERT INTO prop_shipment_product(shipment_id,product_id,manufacturing_no,specification,adopted_product_name,sort_order,create_by,create_time)
     VALUES (?,?,?,?,?,1,'AI自动探索',NOW())`,
    [shipLinked2Id, p[pLinked], pLinked, "AUTO-规格-013", "AUTO-MD-SAME"]);
  await db.execute(
    "INSERT INTO prop_shipment_reservation(product_id,shipment_id,order_id,create_by,create_time) VALUES (?,?,?,'AI自动探索',NOW())",
    [p[pLinked], shipLinked2Id, orderLinked2]);

  const orderScrapped = await createOrder(token, fixtures.a, `${prefix}-SCRAP`, 1);
  const shipScrapped = await createShipment(token, orderScrapped);
  const shipScrappedId = Number(shipScrapped.shipmentId);
  await addProductMust(shipScrappedId, pScrapped);
  await saveFields(token, shipScrappedId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  await db.execute("UPDATE prop_product SET scrapped_time=NOW() WHERE product_id=?", [p[pScrapped]]);

  const orderMissing = await createOrder(token, fixtures.a, `${prefix}-MISSING`, 1);
  const shipMissing = await createShipment(token, orderMissing);
  const shipMissingId = Number(shipMissing.shipmentId);
  await addProductMust(shipMissingId, pMissing);
  await saveFields(token, shipMissingId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  const missingDetail = await getShipment(token, shipMissingId);
  const brokenSnapshot = JSON.parse(JSON.stringify(missingDetail.recipientSnapshot));
  brokenSnapshot.address.postalCode = "";
  brokenSnapshot.address.addressLine1 = "";
  await db.execute("UPDATE prop_shipment SET recipient_snapshot=? WHERE shipment_id=?", [JSON.stringify(brokenSnapshot), shipMissingId]);

  const subjectId = await ensureCompany(db, { customerNo: `${prefix}-MST`, subjectName: `AUTO-C3B 主档删除会社 ${tag}`, defaultCustomerType: "direct" });
  const addressId = await ensureAddress(db, subjectId, { postalCode: "3000001", addressLine1: `AUTO-C3B 主档删除地址 ${tag}`, sortOrder: 0 });
  const contactId = await ensureContact(db, addressId, { contactName: `AUTO-C3B 主档删除联系人 ${tag}`, phone: "03-5555-6666" });
  const masterFixture = { companyId: subjectId, companyName: `AUTO-C3B 主档删除会社 ${tag}`, customerNo: `${prefix}-MST`, addressId, addressLine1: `AUTO-C3B 主档删除地址 ${tag}`, contactId, contactName: `AUTO-C3B 主档删除联系人 ${tag}` };
  const orderMasterDeleted = await createOrder(token, masterFixture, `${prefix}-MASTERDEL`, 1);
  const shipMasterDeleted = await createShipment(token, orderMasterDeleted);
  const shipMasterDeletedId = Number(shipMasterDeleted.shipmentId);
  await addProductMust(shipMasterDeletedId, pMasterDeleted);
  await saveFields(token, shipMasterDeletedId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  const masterSnapshotBefore = (await getShipment(token, shipMasterDeletedId)).recipientSnapshot;
  await db.execute("DELETE FROM prop_customer_contact WHERE contact_id=?", [contactId]);
  await db.execute("DELETE FROM prop_customer_address WHERE address_id=?", [addressId]);
  await db.execute("DELETE FROM prop_customer_subject WHERE subject_id=?", [subjectId]);

  const launcher = await launchAdminSession("verify-order-C3b");
  browser = launcher.browser; session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(15000);
  try {    await book.run("发货管理-022", "确认寄出失败边界", "spec §4.6、§5；VAL-14", async () => {
      const cancelDetail = await getShipment(token, shipCancelledId);
      const cancelConfirm = await apiCall(token, "POST", `/prop/shipment/${shipCancelledId}/confirm`, {
        revision: Number(cancelDetail.revision), trackingNumbers: [`AUTO-CANCEL-FAIL-${tag}`],
      });
      const cancelState = await blockedState(orderCancelled, shipCancelledId, p[pCancelled]);

      const linkedDetail = await getShipment(token, shipLinked2Id);
      const linkedConfirm = await apiCall(token, "POST", `/prop/shipment/${shipLinked2Id}/confirm`, {
        revision: Number(linkedDetail.revision), trackingNumbers: [`AUTO-LINKED-FAIL-${tag}`],
      });
      const linkedState = await blockedState(orderLinked2, shipLinked2Id, p[pLinked]);

      const scrappedDetail = await getShipment(token, shipScrappedId);
      const scrappedConfirm = await apiCall(token, "POST", `/prop/shipment/${shipScrappedId}/confirm`, {
        revision: Number(scrappedDetail.revision), trackingNumbers: [`AUTO-SCRAP-FAIL-${tag}`],
      });
      const scrappedState = await blockedState(orderScrapped, shipScrappedId, p[pScrapped]);

      const drawer = await openShipmentDrawer(page, orderMissing);
      const confirmOpen = drawer.locator(".footer").getByRole("button", { name: /発送を確定/ });
      await confirmOpen.click();
      const modal = page.locator(".ant-modal:visible").filter({ hasText: "送り状ナンバーを追加して発送を確定" }).last();
      await modal.waitFor({ state: "visible", timeout: 10000 });
      const responsePromise = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${shipMissingId}/confirm`) && r.request().method() === "POST",
        { timeout: 20000 },
      );
      await modal.getByRole("button", { name: /発送を確定してメールを生成/ }).click();
      const response = await responsePromise;
      const missingBody = await response.json() as any;
      await page.waitForTimeout(1000);
      const missingUi = compactText(await readToasts(page) + " | " + await drawer.innerText(), 1400);
      const missingState = await blockedState(orderMissing, shipMissingId, p[pMissing]);

      const beforeMasterConfirm = await getShipment(token, shipMasterDeletedId);
      const masterConfirm = await confirmShipment(token, shipMasterDeletedId, [`AUTO-MASTER-DELETED-${tag}`]);
      const afterMasterConfirm = await getShipment(token, shipMasterDeletedId);
      const masterRows = await db.query<any>("SELECT (SELECT COUNT(*) FROM prop_customer_subject WHERE subject_id=?) subject_count,(SELECT COUNT(*) FROM prop_customer_address WHERE address_id=?) address_count,(SELECT COUNT(*) FROM prop_customer_contact WHERE contact_id=?) contact_count", [subjectId, addressId, contactId]);
      const masterRelations = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=? AND delivery_valid=1", [orderMasterDeleted]);
      const masterMails = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=? AND file_type='mail'", [shipMasterDeletedId]);

      const commonBlocked = (x: any) => x.relations === 0 && x.mails === 0 && x.shipment?.status === "preparing";
      const emptyBaseline = (x: any) => x.product?.first_shipment_date == null && x.product?.lifecycle_base_month == null && x.product?.baseline_shipment_id == null;
      const blockedOk = commonBlocked(cancelState) && emptyBaseline(cancelState)
        && commonBlocked(linkedState) && linkedState.product?.baseline_shipment_id != null
        && commonBlocked(scrappedState) && emptyBaseline(scrappedState)
        && commonBlocked(missingState) && emptyBaseline(missingState);
      const boundsOk = cancelConfirm.code === 409 && /キャンセル済み/.test(cancelConfirm.msg)
        && linkedConfirm.code === 409 && /関連付け/.test(linkedConfirm.msg)
        && scrappedConfirm.code === 409 && /廃棄/.test(scrappedConfirm.msg)
        && missingBody.code === 409 && /配送/.test(missingBody.msg);
      const masterOk = masterConfirm.code === 200 && masterConfirm.data?.status === "shipped"
        && JSON.stringify(beforeMasterConfirm.recipientSnapshot) === JSON.stringify(afterMasterConfirm.recipientSnapshot)
        && Number(masterRows[0]?.subject_count) === 0 && Number(masterRows[0]?.address_count) === 0 && Number(masterRows[0]?.contact_count) === 0
        && Number(masterRelations[0]?.c) === 1 && Number(masterMails[0]?.c) === 1;
      return {
        status: blockedOk && boundsOk && masterOk ? "通过" : "不通过",
        actual: `取消订单：code=${cancelConfirm.code}“${cancelConfirm.msg}”；产品已关联：code=${linkedConfirm.code}“${linkedConfirm.msg}”；产品报废：code=${scrappedConfirm.code}“${scrappedConfirm.msg}”；配送快照缺失（UI 最终确认）：code=${missingBody.code}“${missingBody.msg}”，页面/提示=“${missingUi}”。四场景均为 preparing、关系 0、邮件 0；已关联产品保留原首出货基准、其余无基准=${blockedOk}。主档删除但快照完整：confirm code=${masterConfirm.code}、status=${masterConfirm.data?.status}、快照保持一致=${JSON.stringify(beforeMasterConfirm.recipientSnapshot) === JSON.stringify(afterMasterConfirm.recipientSnapshot)}、主档删除后行数 subject/address/contact=${masterRows[0]?.subject_count}/${masterRows[0]?.address_count}/${masterRows[0]?.contact_count}、有效关系=${masterRelations[0]?.c}、邮件=${masterMails[0]?.c}。`,
        evidence: "API 构造取消订单/已关联/报废/配送快照缺失场景并直提确认；配送缺失另走 UI 最终确认读取响应；另物理删除客户主档后按订单快照确认；DB 校验状态、关系、邮件、产品基线与主档行数。",
        requirement: "spec §4.6、§5；VAL-14",
      };
    });

    await book.run("发货管理-030", "正常出货首次生产质检资格", "FEAT-11-shipment VAL-28（问题01B）", async () => {
      const orderGood = await createOrder(token, fixtures.a, `${prefix}-GOOD`, 1);
      const shipGood = await createShipment(token, orderGood);
      const shipGoodId = Number(shipGood.shipmentId);
      await addProductMust(shipGoodId, pGood);
      await saveFields(token, shipGoodId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
      const firstConfirm = await confirmShipment(token, shipGoodId, [`AUTO-GOOD-${tag}`]);
      const goodDbAfterFirst = await db.query<any>("SELECT status,confirmed_time FROM prop_shipment WHERE shipment_id=?", [shipGoodId]);
      const secondConfirm = await confirmShipment(token, shipGoodId, [`AUTO-IRRELEVANT-${tag}`]);
      const goodDb = await db.query<any>("SELECT status,confirmed_time FROM prop_shipment WHERE shipment_id=?", [shipGoodId]);
      const goodMails = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=? AND file_type='mail'", [shipGoodId]);
      const goodRelations = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=? AND delivery_valid=1", [orderGood]);

      const orderZero = await createOrder(token, fixtures.a, `${prefix}-ZERO`, 1);
      const shipZero = await createShipment(token, orderZero);
      const shipZeroId = Number(shipZero.shipmentId);
      const zeroAdd = await addProduct(token, shipZeroId, pZero);
      const zeroItems = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_product WHERE shipment_id=?", [shipZeroId]);
      const zeroReservations = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE shipment_id=?", [shipZeroId]);

      const orderMixed = await createOrder(token, fixtures.a, `${prefix}-MIX`, 2);
      const shipMixed = await createShipment(token, orderMixed);
      const shipMixedId = Number(shipMixed.shipmentId);
      const mixed = await apiCall(token, "POST", `/prop/shipment/${shipMixedId}/products`, {
        revision: Number((await getShipment(token, shipMixedId)).revision), prefix: `${prefix}-MIX`, start: "01", end: "02",
      });
      const mixedItems = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_product WHERE shipment_id=?", [shipMixedId]);
      const mixedReservations = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE shipment_id=?", [shipMixedId]);

      const orderInvalid = await createOrder(token, fixtures.a, `${prefix}-INVALID`, 1);
      const shipInvalid = await createShipment(token, orderInvalid);
      const shipInvalidId = Number(shipInvalid.shipmentId);
      await db.execute("UPDATE prop_product SET initial_production_inspection_passed=2 WHERE product_id=?", [p[pInvalid]]);
      const invalidAdd = await addProduct(token, shipInvalidId, pInvalid);

      const orderFlip = await createOrder(token, fixtures.a, `${prefix}-FLIP`, 2);
      const shipFlip = await createShipment(token, orderFlip);
      const shipFlipId = Number(shipFlip.shipmentId);
      await addProductMust(shipFlipId, pFlip1);
      await addProductMust(shipFlipId, pFlip2);
      await saveFields(token, shipFlipId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
      await db.execute("UPDATE prop_product SET initial_production_inspection_passed=0 WHERE product_id=?", [p[pFlip2]]);
      const flipDetail = await getShipment(token, shipFlipId);
      const flipConfirm = await apiCall(token, "POST", `/prop/shipment/${shipFlipId}/confirm`, {
        revision: Number(flipDetail.revision), trackingNumbers: [`AUTO-FLIP-FAIL-${tag}`],
      });
      const flipRelations = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE order_id=?", [orderFlip]);
      const flipMails = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=? AND file_type='mail'", [shipFlipId]);
      const flipProducts = await db.query<any>("SELECT manufacturing_no,first_shipment_date,lifecycle_base_month,baseline_shipment_id FROM prop_product WHERE product_id IN (?,?) ORDER BY product_id", [p[pFlip1], p[pFlip2]]);
      const flipShipment = await db.query<any>("SELECT status,confirmed_time FROM prop_shipment WHERE shipment_id=?", [shipFlipId]);
      const flipOrder = await getOrder(token, orderFlip);

      const orderScrapAdd = await createOrder(token, fixtures.a, `${prefix}-SCRAPADD`, 1);
      const shipScrapAdd = await createShipment(token, orderScrapAdd);
      const shipScrapAddId = Number(shipScrapAdd.shipmentId);
      await db.execute("UPDATE prop_product SET scrapped_time=NOW() WHERE product_id=?", [p[pScrappedAdd]]);
      const scrapAdd = await addProduct(token, shipScrapAddId, pScrappedAdd);

      const orderDeletedAdd = await createOrder(token, fixtures.a, `${prefix}-DELADD`, 1);
      const shipDeletedAdd = await createShipment(token, orderDeletedAdd);
      const shipDeletedAddId = Number(shipDeletedAdd.shipmentId);
      const deletedAdd = await addProduct(token, shipDeletedAddId, pDeleted);

      const orderQty = await createOrder(token, fixtures.a, `${prefix}-QTY`, 2);
      const shipQty = await createShipment(token, orderQty);
      const shipQtyId = Number(shipQty.shipmentId);
      await addProductMust(shipQtyId, pQty1);
      await addProductMust(shipQtyId, pQty2);
      await saveFields(token, shipQtyId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
      await db.execute("UPDATE prop_order_line SET quantity=1 WHERE order_id=?", [orderQty]);
      const qtyDetail = await getShipment(token, shipQtyId);
      const qtyConfirm = await apiCall(token, "POST", `/prop/shipment/${shipQtyId}/confirm`, {
        revision: Number(qtyDetail.revision), trackingNumbers: [`AUTO-QTY-FAIL-${tag}`],
      });
      const qtyState = await blockedState(orderQty, shipQtyId, p[pQty1]);
      const schema = await db.query<any>("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='prop_product' AND column_name='initial_production_inspection_passed'");
      let nullRejected = false;
      try {
        await db.execute("UPDATE prop_product SET initial_production_inspection_passed=NULL WHERE product_id=?", [p[pGood]]);
      } catch { nullRejected = true; }

      const mixedData = mixed.data as any;
      const zeroReason = (zeroAdd.data as any)?.failures?.[0]?.reason || "";
      const invalidReason = (invalidAdd.data as any)?.failures?.[0]?.reason || "";
      const scrapReason = (scrapAdd.data as any)?.failures?.[0]?.reason || "";
      const deletedReason = (deletedAdd.data as any)?.failures?.[0]?.reason || "";
      const addFailuresOk = zeroAdd.code === 200 && (zeroAdd.data as any)?.added?.length === 0 && /初回生産検査/.test(zeroReason)
        && Number(zeroItems[0]?.c) === 0 && Number(zeroReservations[0]?.c) === 0
        && mixed.code === 200 && JSON.stringify(mixedData?.added) === JSON.stringify([pMixedOk]) && mixedData?.failures?.length === 1
        && mixedData.failures[0].manufacturingNo === pMixedBad && /初回生産検査/.test(mixedData.failures[0].reason)
        && Number(mixedItems[0]?.c) === 1 && Number(mixedReservations[0]?.c) === 1
        && invalidAdd.code === 200 && (invalidAdd.data as any)?.added?.length === 0 && /検査/.test(invalidReason)
        && scrapAdd.code === 200 && (scrapAdd.data as any)?.added?.length === 0 && /廃棄/.test(scrapReason)
        && deletedAdd.code === 200 && (deletedAdd.data as any)?.added?.length === 0 && /削除/.test(deletedReason);
      const flipAtomic = flipConfirm.code === 409 && /初回生産検査/.test(flipConfirm.msg)
        && Number(flipRelations[0]?.c) === 0 && Number(flipMails[0]?.c) === 0 && flipShipment[0]?.status === "preparing"
        && flipShipment[0]?.confirmed_time == null && flipProducts.every((x: any) => x.first_shipment_date == null && x.lifecycle_base_month == null && x.baseline_shipment_id == null)
        && Number(flipOrder.fulfilledQuantity) === 0;
      const qtyBlocked = qtyConfirm.code === 409 && /残数|数量/.test(qtyConfirm.msg) && qtyState.relations === 0 && qtyState.shipment?.status === "preparing";
      const goodOk = firstConfirm.code === 200 && firstConfirm.data?.status === "shipped"
        && secondConfirm.code === 200 && secondConfirm.data?.status === "shipped"
        && String(goodDb[0]?.confirmed_time) === String(goodDbAfterFirst[0]?.confirmed_time)
        && Number(goodMails[0]?.c) === 1 && Number(goodRelations[0]?.c) === 1;
      const schemaOk = schema[0]?.is_nullable === "NO" && String(schema[0]?.column_default) === "0" && nullRejected;
      return {
        status: goodOk && addFailuresOk && flipAtomic && qtyBlocked ? "部分验证" : "不通过",
        actual: `判定 good/add/flip/qty/schema=${goodOk}/${addFailuresOk}/${flipAtomic}/${qtyBlocked}/${schemaOk}。标记1：首次确认 code=${firstConfirm.code}/status=${firstConfirm.data?.status}，重复确认 code=${secondConfirm.code}、confirmed_time 不变=${String(goodDb[0]?.confirmed_time) === String(goodDbAfterFirst[0]?.confirmed_time)}、邮件=${goodMails[0]?.c}、有效关系=${goodRelations[0]?.c}。标记0：added=${JSON.stringify((zeroAdd.data as any)?.added)}、reason=“${zeroReason}”、清单/占用=${zeroItems[0]?.c}/${zeroReservations[0]?.c}。混合连续：added=${JSON.stringify(mixedData?.added)}、failures=${JSON.stringify(mixedData?.failures)}、清单/占用=${mixedItems[0]?.c}/${mixedReservations[0]?.c}。非法标记2：reason=“${invalidReason}”。报废/删除：reason=“${scrapReason}”/“${deletedReason}”。加入后变 0：确认 code=${flipConfirm.code}“${flipConfirm.msg}”，关系/邮件=${flipRelations[0]?.c}/${flipMails[0]?.c}，状态=${flipShipment[0]?.status}，产品基线全空=${flipProducts.every((x: any) => x.first_shipment_date == null && x.lifecycle_base_month == null && x.baseline_shipment_id == null)}，履约=${flipOrder.fulfilledQuantity}。剩余数量：确认 code=${qtyConfirm.code}“${qtyConfirm.msg}”。NULL/缺失：列 is_nullable/default=${schema[0]?.is_nullable}/${schema[0]?.column_default}，尝试写 NULL 被拒=${nullRejected}，当前 schema 无法构造 NULL/缺失状态。`,
        evidence: "API 种入标记 1/0/非法 2/报废/删除产品并执行单件、连续、混合加入与确认；确认前锁后重读复核原子性；DB 校验清单/占用/关系/邮件/产品基线；重复确认验证事实幂等；查询 information_schema 验证 NULL 不可达。",
        requirement: "FEAT-11-shipment VAL-28（问题01B）",
      };
    });

    const rows = book.list();
    console.log(`[C3B] 完成 ${rows.length} 条；通过=${rows.filter((x) => x.status === "通过").length}；部分验证=${rows.filter((x) => x.status === "部分验证").length}；不通过=${rows.filter((x) => x.status === "不通过").length}`);
    console.log(`[C3B] 022 订单 cancel=${orderCancelled} linked=${orderLinked1}/${orderLinked2} scrap=${orderScrapped} missing=${orderMissing} master=${orderMasterDeleted}`);
    console.log("[C3B] 030 夹具已在用例内创建");
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-C3b");
    await db.close();
  }
}
main().catch((error) => { console.error("[C3B] FAILED:", error instanceof Error ? error.stack : error); process.exit(1); });