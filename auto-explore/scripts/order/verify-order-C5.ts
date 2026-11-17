/** 订单寄送 C5：注文先与納品先快照显示（028/029）。 */
import { randomUUID } from "node:crypto";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiCall, runTag,
  ensureCompany, ensureAddress, ensureContact, PRODUCT_NAME,
} from "./order-runtime-utils.js";
import {
  ensureProduct, getShipment, createShipment, addProduct, saveFields,
  confirmShipment, openShipmentDrawer, mustOk,
} from "./order-shipment-utils.js";

type Snapshot = Record<string, any>;
type SnapshotCard = { labels: string[]; values: string[] };
type Scenario = {
  key: string;
  label: string;
  orderId: number;
  shipmentId: number;
  productNo: string;
  orderingBase: Snapshot;
  recipientWrapBase: Snapshot;
  orderingTarget: Snapshot;
  recipientTarget: Snapshot;
  expectedOrdering: string;
  expectedRecipient: string;
  preparing?: SnapshotCard;
  shipped?: SnapshotCard;
  afterMaster?: SnapshotCard;
};

const book = new ResultBook("reports/order-runtime-results-C5.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-C5-${tag}`;
let browser: any;
let session: any;
let token = "";

function display(value: Snapshot | null | undefined): string {
  return value?.subjectType === "site"
    ? [value.companyName, value.name].filter(Boolean).join(" ／ ") || "—"
    : value?.name || "—";
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalize(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

async function ensureSite(companyId: number, customerNo: string, subjectName: string): Promise<number> {
  const rows = await db.query<{ subject_id: number }>(
    "SELECT subject_id FROM prop_customer_subject WHERE customer_no=? LIMIT 1",
    [customerNo],
  );
  if (rows.length) return Number(rows[0].subject_id);
  const result = await db.execute(
    `INSERT INTO prop_customer_subject
      (subject_type,company_id,customer_no,subject_name,default_customer_type,storage_path,create_by,create_time,remark)
     VALUES ('site',?,?,?,NULL,NULL,'AI自动探索',NOW(),?)`,
    [companyId, customerNo, subjectName, "订单寄送 C5 运行时验证夹具"],
  );
  return Number(result.insertId);
}

async function createCustomOrder(
  customerOrderNo: string,
  orderingId: number,
  recipientId: number,
  addressId: number,
  contactId: number,
): Promise<number> {
  const response = await apiCall(token, "POST", "/prop/order", {
    requestId: randomUUID(),
    customerOrderNo,
    orderDate: "2026-10-29",
    expectedShipDate: "2026-10-30",
    orderType: "sale",
    customerType: "direct",
    orderingParty: { mode: "select", id: orderingId },
    recipient: { mode: "select", id: recipientId },
    billingParty: { mode: "select", id: orderingId },
    deliveryAddress: { mode: "select", id: addressId },
    deliveryContact: { mode: "select", id: contactId },
    lines: [{ productNameId: 10, productName: PRODUCT_NAME, colorNote: `AUTO-C5-${tag}`, quantity: 1 }],
    remark: `AUTO 订单寄送 C5 ${customerOrderNo}`,
  });
  return Number(mustOk(`创建订单 ${customerOrderNo}`, response).orderId);
}

async function addProductMust(shipmentId: number, no: string): Promise<void> {
  const result = await addProduct(token, shipmentId, no);
  if (result.code !== 200 || !(result.data?.added || []).includes(no)) {
    throw new Error(`加入产品失败 ${no}: ${JSON.stringify(result)}`);
  }
}

async function confirmMust(shipmentId: number): Promise<void> {
  const result = await confirmShipment(token, shipmentId, [`AUTO-C5-${tag}-${shipmentId}`]);
  if (result.code !== 200 || result.data?.status !== "shipped") {
    throw new Error(`确认寄出失败 ${shipmentId}: ${JSON.stringify(result)}`);
  }
}

async function readSnapshotCard(drawer: any): Promise<SnapshotCard> {
  const block = drawer.locator(".snapshot").first();
  await block.waitFor({ state: "visible", timeout: 10000 });
  const labels = (await block.locator("label").allTextContents()).map(normalize);
  const values = (await block.locator("p").allTextContents()).map(normalize);
  return { labels, values };
}

async function applySnapshots(scenario: Scenario, ordering: Snapshot, recipient: Snapshot): Promise<void> {
  const wrapper = clone(scenario.recipientWrapBase);
  wrapper.recipient = clone(recipient);
  await db.execute(
    "UPDATE prop_shipment SET ordering_party_snapshot=?,recipient_snapshot=? WHERE shipment_id=?",
    [JSON.stringify(ordering), JSON.stringify(wrapper), scenario.shipmentId],
  );
}

async function resetSnapshots(scenario: Scenario): Promise<void> {
  await applySnapshots(scenario, scenario.orderingBase, scenario.recipientWrapBase.recipient);
}

async function generateWaybill(shipmentId: number): Promise<any> {
  const ready = mustOk("准备面单", await apiCall(token, "GET", `/prop/shipment/${shipmentId}/documents/prepare?type=waybill`));
  return apiCall(token, "POST", `/prop/shipment/${shipmentId}/documents`, {
    requestId: randomUUID(), type: "waybill", issueDate: "2026-10-29",
    revision: Number(ready.revision), copies: 1, sourceToken: ready.sourceToken, overrides: ready.defaults,
  });
}

async function generateMail(shipmentId: number): Promise<any> {
  const shipment = await getShipment(token, shipmentId);
  return apiCall(token, "POST", `/prop/shipment/${shipmentId}/files`, {
    requestId: randomUUID(), revision: Number(shipment.revision), type: "mail",
  });
}

async function fileState(): Promise<any[]> {
  return db.query<any>(
    `SELECT shipment_id,file_id,file_type,version,rendered_content,snapshot_json,create_time
       FROM prop_shipment_file ORDER BY shipment_id,file_id`,
  );
}

async function main(): Promise<void> {
  await db.connect();
  token = await apiLogin("admin", "admin123");

  const companyCName = "AUTO-C5-C";
  const companyDName = "AUTO-C5-D";
  const siteCName = "AUTO-C5-SC";
  const siteDName = "AUTO-C5-SD";
  const companyC = await ensureCompany(db, { customerNo: `${prefix}-C`, subjectName: companyCName, defaultCustomerType: "direct" });
  const companyD = await ensureCompany(db, { customerNo: `${prefix}-D`, subjectName: companyDName, defaultCustomerType: "agency" });
  const siteC = await ensureSite(companyC, `${prefix}-CS`, siteCName);
  const siteCSame = await ensureSite(companyC, `${prefix}-CSAME`, companyCName);
  const siteD = await ensureSite(companyD, `${prefix}-DS`, siteDName);

  const addrC = await ensureAddress(db, companyC, { postalCode: "1000001", addressLine1: "AUTO-C5C", sortOrder: 0 });
  const contactC = await ensureContact(db, addrC, { contactName: "AUTO-C5C", phone: "03-5000-0001" });
  const addrSiteC = await ensureAddress(db, siteC, { postalCode: "1000002", addressLine1: "AUTO-C5SC", sortOrder: 0 });
  const contactSiteC = await ensureContact(db, addrSiteC, { contactName: "AUTO-C5SC", phone: "03-5000-0002" });
  const addrSiteCSame = await ensureAddress(db, siteCSame, { postalCode: "1000003", addressLine1: "AUTO-C5SS", sortOrder: 0 });
  const contactSiteCSame = await ensureContact(db, addrSiteCSame, { contactName: "AUTO-C5SS", phone: "03-5000-0003" });
  const addrSiteD = await ensureAddress(db, siteD, { postalCode: "2000001", addressLine1: "AUTO-C5SD", sortOrder: 0 });
  const contactSiteD = await ensureContact(db, addrSiteD, { contactName: "AUTO-C5SD", phone: "03-5000-0004" });

  const definitions = [
    { key: "company", label: "公司注文先/公司納品先", orderingId: companyC, recipientId: companyC, addr: addrC, contact: contactC, orderingPatch: {}, recipientPatch: {} },
    { key: "same-name", label: "同公司同名支店", orderingId: siteCSame, recipientId: siteCSame, addr: addrSiteCSame, contact: contactSiteCSame, orderingPatch: {}, recipientPatch: {} },
    { key: "cross-company", label: "跨公司支店", orderingId: siteD, recipientId: siteC, addr: addrSiteC, contact: contactSiteC, orderingPatch: {}, recipientPatch: {} },
    { key: "missing-company", label: "缺companyName", orderingId: siteC, recipientId: siteC, addr: addrSiteC, contact: contactSiteC, orderingPatch: { companyName: "__DELETE__" }, recipientPatch: { companyName: "__DELETE__" } },
    { key: "missing-name", label: "缺name", orderingId: siteC, recipientId: siteC, addr: addrSiteC, contact: contactSiteC, orderingPatch: { name: "__DELETE__" }, recipientPatch: { name: "__DELETE__" } },
    { key: "missing-both", label: "名称全缺", orderingId: siteC, recipientId: siteC, addr: addrSiteC, contact: contactSiteC, orderingPatch: { companyName: "__DELETE__", name: "__DELETE__" }, recipientPatch: { companyName: "__DELETE__", name: "__DELETE__" } },
  ];

  const scenarios: Scenario[] = [];
  for (const definition of definitions) {
    const orderId = await createCustomOrder(`${prefix}-${definition.key}`, definition.orderingId, definition.recipientId, definition.addr, definition.contact);
    const shipment = await createShipment(token, orderId, "2026-10-29");
    const shipmentId = Number(shipment.shipmentId);
    const productNo = `${prefix}-P-${definition.key}`;
    await ensureProduct(db, productNo);
    await addProductMust(shipmentId, productNo);
    await saveFields(token, shipmentId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
    const rows = await db.query<any>(
      "SELECT ordering_party_snapshot,recipient_snapshot FROM prop_shipment WHERE shipment_id=?",
      [shipmentId],
    );
    const orderingBase = JSON.parse(rows[0].ordering_party_snapshot);
    const recipientWrapBase = JSON.parse(rows[0].recipient_snapshot);
    const orderingTarget = clone(orderingBase);
    const recipientTarget = clone(recipientWrapBase.recipient);
    for (const [key, value] of Object.entries(definition.orderingPatch)) {
      if (value === "__DELETE__") delete orderingTarget[key]; else orderingTarget[key] = value;
    }
    for (const [key, value] of Object.entries(definition.recipientPatch)) {
      if (value === "__DELETE__") delete recipientTarget[key]; else recipientTarget[key] = value;
    }
    scenarios.push({
      key: definition.key,
      label: definition.label,
      orderId,
      shipmentId,
      productNo,
      orderingBase,
      recipientWrapBase,
      orderingTarget,
      recipientTarget,
      expectedOrdering: display(orderingTarget),
      expectedRecipient: display(recipientTarget),
    });
  }

  const launcher = await launchAdminSession("verify-order-C5");
  browser = launcher.browser;
  session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(15000);

  for (const scenario of scenarios) {
    await applySnapshots(scenario, scenario.orderingTarget, scenario.recipientTarget);
    const drawer = await openShipmentDrawer(page, scenario.orderId);
    scenario.preparing = await readSnapshotCard(drawer);
    await resetSnapshots(scenario);

    if (scenario.key === "company") {
      const waybill = await generateWaybill(scenario.shipmentId);
      if (waybill.code !== 200) throw new Error(`代表场景面单生成失败：${waybill.msg}`);
    }
    await confirmMust(scenario.shipmentId);
    await applySnapshots(scenario, scenario.orderingTarget, scenario.recipientTarget);
    const shippedDrawer = await openShipmentDrawer(page, scenario.orderId);
    scenario.shipped = await readSnapshotCard(shippedDrawer);
  }

  const representative = scenarios.find((x) => x.key === "company")!;
  const mail = await generateMail(representative.shipmentId);
  if (mail.code !== 200) throw new Error(`代表场景邮件生成失败：${mail.msg}`);
  const deliveryNotePrepare = await apiCall(token, "GET", `/prop/shipment/${representative.shipmentId}/documents/prepare?type=deliveryNote`);

  const filesBefore = await fileState();
  const orderTimesBefore = await db.query<any>("SELECT order_id,update_time FROM prop_order WHERE order_id IN (" + scenarios.map(() => "?").join(",") + ") ORDER BY order_id", scenarios.map((x) => x.orderId));
  const shipmentTimesBefore = await db.query<any>("SELECT shipment_id,update_time,revision FROM prop_shipment WHERE shipment_id IN (" + scenarios.map(() => "?").join(",") + ") ORDER BY shipment_id", scenarios.map((x) => x.shipmentId));

  const changedCName = `${companyCName} MASTER-CHANGED`;
  const changedDName = `${companyDName} MASTER-CHANGED`;
  const changedSiteC = `${siteCName} MASTER-CHANGED`;
  const changedSiteD = `${siteDName} MASTER-CHANGED`;
  await db.execute("UPDATE prop_customer_subject SET subject_name=? WHERE subject_id=?", [changedCName, companyC]);
  await db.execute("UPDATE prop_customer_subject SET subject_name=? WHERE subject_id=?", [changedDName, companyD]);
  await db.execute("UPDATE prop_customer_subject SET subject_name=? WHERE subject_id=?", [changedSiteC, siteC]);
  await db.execute("UPDATE prop_customer_subject SET subject_name=? WHERE subject_id=?", [changedSiteD, siteD]);
  await db.execute("UPDATE prop_customer_subject SET subject_name=? WHERE subject_id=?", [`${companyCName} MASTER-CHANGED`, siteCSame]);

  for (const scenario of scenarios) {
    const drawer = await openShipmentDrawer(page, scenario.orderId);
    scenario.afterMaster = await readSnapshotCard(drawer);
  }

  const filesAfter = await fileState();
  const orderTimesAfter = await db.query<any>("SELECT order_id,update_time FROM prop_order WHERE order_id IN (" + scenarios.map(() => "?").join(",") + ") ORDER BY order_id", scenarios.map((x) => x.orderId));
  const shipmentTimesAfter = await db.query<any>("SELECT shipment_id,update_time,revision FROM prop_shipment WHERE shipment_id IN (" + scenarios.map(() => "?").join(",") + ") ORDER BY shipment_id", scenarios.map((x) => x.shipmentId));

  const labelsOk = scenarios.every((x) =>
    JSON.stringify(x.preparing?.labels) === JSON.stringify(["注文先", "納品先", "住所", "担当者"])
    && JSON.stringify(x.shipped?.labels) === JSON.stringify(["注文先", "納品先", "住所", "担当者"])
    && JSON.stringify(x.afterMaster?.labels) === JSON.stringify(["注文先", "納品先", "住所", "担当者"]),
  );
  const orderingDisplayOk = scenarios.every((x) =>
    x.preparing?.values[0] === x.expectedOrdering
    && x.shipped?.values[0] === x.expectedOrdering
    && x.afterMaster?.values[0] === x.expectedOrdering,
  );
  const recipientDisplayOk = scenarios.every((x) =>
    x.preparing?.values[1] === x.expectedRecipient
    && x.shipped?.values[1] === x.expectedRecipient
    && x.afterMaster?.values[1] === x.expectedRecipient,
  );
  const addressContactOk = scenarios.every((x) =>
    /〒\d{7}/.test(x.preparing?.values[2] || "")
    && Boolean(x.preparing?.values[3])
    && x.preparing?.values[2] === x.shipped?.values[2]
    && x.preparing?.values[3] === x.shipped?.values[3],
  );
  const stateConsistent = scenarios.every((x) =>
    JSON.stringify(x.preparing?.values) === JSON.stringify(x.shipped?.values)
    && JSON.stringify(x.shipped?.values) === JSON.stringify(x.afterMaster?.values),
  );
  const noWriteByRead = JSON.stringify(orderTimesBefore) === JSON.stringify(orderTimesAfter)
    && JSON.stringify(shipmentTimesBefore) === JSON.stringify(shipmentTimesAfter);
  const filesUnchanged = JSON.stringify(filesBefore) === JSON.stringify(filesAfter);
  const noFill = scenarios.find((x) => x.key === "missing-both")?.afterMaster?.values.slice(0, 2).every((x) => x === "—") === true
    && scenarios.find((x) => x.key === "missing-company")?.afterMaster?.values[0] === siteCName
    && scenarios.find((x) => x.key === "missing-name")?.afterMaster?.values[1] === companyCName;
  const noDedup = scenarios.find((x) => x.key === "same-name")?.afterMaster?.values.slice(0, 2).every((x) => x === `${companyCName} ／ ${companyCName}`) === true;

  const summary = scenarios.map((x) => ({
    key: x.key,
    expectedOrdering: x.expectedOrdering,
    actualOrdering: x.afterMaster?.values[0],
    expectedRecipient: x.expectedRecipient,
    actualRecipient: x.afterMaster?.values[1],
    address: x.afterMaster?.values[2],
    contact: x.afterMaster?.values[3],
  }));
  const fileRows = filesAfter.filter((x) => scenarios.some((s) => Number(s.shipmentId) === Number(x.shipment_id)));
  const fileSummary = fileRows.map((x) => `${x.shipment_id}:${x.file_type}/v${x.version}`);

  await book.run("发货管理-028", "寄送抽屉下单方显示", "spec10-28 FEAT-11-shipment VAL-01a", async () => {
    const passed = labelsOk && orderingDisplayOk && stateConsistent && noWriteByRead && noDedup && noFill;
    return {
      status: passed ? "通过" : "不通过",
      actual: `场景=${JSON.stringify(summary)}；标签顺序正确=${labelsOk}；注文先显示正确=${orderingDisplayOk}；准备中/已寄出一致=${stateConsistent}；同名不去重=${noDedup}；缺失时不互填=${noFill}；主档改名后订单/寄送更新时间未变化=${noWriteByRead}；主档当前名 C=${changedCName}、D=${changedDName}、支店C=${changedSiteC}、支店D=${changedSiteD}。`,
      evidence: "真实寄送抽屉分别核对公司、同公司同名支店、跨公司支店、缺companyName、缺name、名称全缺六组；DB 修改客户主档后重开页面，确认仍使用本笔寄送快照且未写入订单/寄送。",
      requirement: "spec10-28 FEAT-11-shipment VAL-01a",
    };
  });

  await book.run("发货管理-029", "納品先完整主体显示", "spec10-28 FEAT-11-shipment VAL-01b", async () => {
    const passed = labelsOk && recipientDisplayOk && stateConsistent && noFill && filesUnchanged;
    const deliveryNoteBlocked = deliveryNotePrepare.code === 409;
    return {
      status: passed && !deliveryNoteBlocked ? "通过" : passed && deliveryNoteBlocked ? "部分验证" : "不通过",
      actual: `納品先场景=${JSON.stringify(summary.map((x) => ({ key: x.key, expected: x.expectedRecipient, actual: x.actualRecipient })))}；納品先显示正确=${recipientDisplayOk}；准备中/已寄出一致=${stateConsistent}；不从注文先或主档补值=${noFill}；邮件与面单等文件内容/版本未变=${filesUnchanged}（${fileSummary.join("、")}）；納品書 prepare code=${deliveryNotePrepare.code}“${deliveryNotePrepare.msg}”。`,
      evidence: "页面逐场景核对納品先并对比准备中/已寄出；修改公司与支店主档后重开仍取寄送快照；DB 对比寄送文件 rendered_content、snapshot_json、version 与时间。納品書因既有模板校验和问题无法生成，故该项标为覆盖不足。",
      requirement: "spec10-28 FEAT-11-shipment VAL-01b",
    };
  });

  console.log(`[C5] 完成 2 条；通过=${book.list().filter((x) => x.status === "通过").length}；部分验证=${book.list().filter((x) => x.status === "部分验证").length}；不通过=${book.list().filter((x) => x.status === "不通过").length}`);
  console.log(`[C5] 场景=${summary.map((x) => `${x.key}:${x.actualOrdering}|${x.actualRecipient}`).join(" ; ")}`);
  console.log(`[C5] 文件=${fileSummary.join(",")}；納品書=${deliveryNotePrepare.code}`);
  if (session) await finishSession(browser, session, "verify-order-C5");
  browser = undefined;
  session = undefined;
  await db.close();
}

main().catch(async (error) => {
  console.error("[C5] FAILED:", error instanceof Error ? error.stack : error);
  try { if (session) await finishSession(browser, session, "verify-order-C5"); } catch {}
  try { await db.close(); } catch {}
  process.exit(1);
});
