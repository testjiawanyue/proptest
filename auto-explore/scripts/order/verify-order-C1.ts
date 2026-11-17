/** 订单寄送 C1：基础录入与拦截（发货管理-003/004/005/008/017/018）。 */
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiCall,
  runTag, ensureOrderFixtures, readToasts, compactText,
} from "./order-runtime-utils.js";
import {
  ensureProduct, createOrder, createShipment, addProduct, getShipment, productCard,
  openShipmentDrawer, fillRange, clickAdd, switchSingleEntry, fillSingleNo,
} from "./order-shipment-utils.js";

const book = new ResultBook("reports/order-runtime-results-C1.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-C1-${tag}`;
const range = [`${prefix}-R001`, `${prefix}-R002`, `${prefix}-R003`];
const mixed = [`${prefix}-Q101`, `${prefix}-Q102`, `${prefix}-Q103`];
const single = `${prefix}-S1`;

let browser: any;
let session: any;
let token = "";
let fixtures: any;

async function bodyOf(response: any): Promise<any> {
  return response.json().catch(() => ({ code: -1, msg: "" }));
}
async function waitPost(page: any, action: () => Promise<void>): Promise<any> {
  const pending = page.waitForResponse((r: any) => r.url().includes("/products") && r.request().method() === "POST", { timeout: 20000 });
  await action();
  return bodyOf(await pending);
}
async function productIdsByNo(numbers: string[]): Promise<Record<string, number>> {
  const rows = await db.query<{ manufacturing_no: string; product_id: number }>(
    `SELECT manufacturing_no,product_id FROM prop_product WHERE manufacturing_no IN (${numbers.map(() => "?").join(",")})`,
    numbers,
  );
  return Object.fromEntries(rows.map((r) => [r.manufacturing_no, Number(r.product_id)]));
}

async function main(): Promise<void> {
  await db.connect();
  fixtures = await ensureOrderFixtures(db);
  token = await apiLogin("admin", "admin123");
  for (const no of [...range, single]) await ensureProduct(db, no);
  for (const no of [mixed[0], mixed[2]]) await ensureProduct(db, no);
  await ensureProduct(db, mixed[1], { inspection: 0 });
  const flags = await productIdsByNo([...range, ...mixed, single]);

  const order3 = await createOrder(token, fixtures.a, `${prefix}-RANGE`, 3);
  const ship3 = await createShipment(token, order3);
  const order8 = await createOrder(token, fixtures.a, `${prefix}-CARRIER`, 1);
  const ship8 = await createShipment(token, order8);
  await addProduct(token, Number(ship8.shipmentId), single);
  const order17 = await createOrder(token, fixtures.a, `${prefix}-EMPTY`, 1);
  const ship17 = await createShipment(token, order17);
  const order18 = await createOrder(token, fixtures.a, `${prefix}-LIMIT`, 3);
  const ship18 = await createShipment(token, order18);

  const launcher = await launchAdminSession("verify-order-C1");
  browser = launcher.browser;
  session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(12000);

  try {
    await book.run("发货管理-003", "连续编号录入批量添加产品", "FEAT-11-shipment VAL-03", async () => {
      const drawer = await openShipmentDrawer(page, order3);
      await fillRange(page, drawer, `${prefix}-R`, "001", "003");
      const body = await waitPost(page, () => clickAdd(drawer));
      await page.waitForTimeout(1200);
      const rows = productCard(drawer).locator("tr.ant-table-row");
      const uiRows = await rows.count();
      const texts = await rows.allInnerTexts();
      const dbRows = await db.query<any>(
        "SELECT manufacturing_no,specification FROM prop_shipment_product WHERE shipment_id=? ORDER BY sort_order", [ship3.shipmentId]);
      const reservations = await db.query<{ c: number }>(
        "SELECT COUNT(*) c FROM prop_shipment_reservation WHERE shipment_id=?", [ship3.shipmentId]);
      const passed = body.code === 200 && (body.data?.added || []).length === 3 && uiRows === 3
        && dbRows.length === 3 && Number(reservations[0]?.c) === 3
        && texts.every((x: string) => x.includes("AUTO-规格-013"));
      return {
        status: passed ? "通过" : "不通过",
        actual: `接口 code=${body.code}、added=${JSON.stringify(body.data?.added || [])}；UI 产品行=${uiRows}，逐行规格=${texts.map((x: string) => compactText(x, 100)).join(" || ")}；DB 清单=${dbRows.length}、占用=${reservations[0]?.c}。`,
        evidence: "UI 寄送抽屉选择「連番で登録」输入前缀/起止并追加；捕获 POST /products；DB 查询 shipment_product/reservation。",
        requirement: "FEAT-11-shipment VAL-03",
      };
    });

    await book.run("发货管理-004", "删除寄送清单产品", "FEAT-11-shipment 草稿清单删除", async () => {
      const drawer = await openShipmentDrawer(page, order3);
      const card = productCard(drawer);
      const before = await card.locator("tr.ant-table-row").count();
      const target = card.locator("tr.ant-table-row", { hasText: range[0] }).first();
      await target.getByRole("button", { name: "リストから外す" }).click();
      const pop = page.locator(".ant-popconfirm:visible");
      await pop.waitFor({ state: "visible", timeout: 5000 });
      const popText = compactText(await pop.innerText());
      const pending = page.waitForResponse((r: any) => r.url().includes(`/products/${flags[range[0]]}`) && r.request().method() === "DELETE", { timeout: 15000 });
      await pop.locator(".ant-btn-primary").click();
      const response = await pending;
      const body = await bodyOf(response);
      await page.waitForTimeout(900);
      const after = await card.locator("tr.ant-table-row").count();
      const remaining = await db.query<any>("SELECT manufacturing_no FROM prop_shipment_product WHERE shipment_id=? ORDER BY sort_order", [ship3.shipmentId]);
      const removedReservation = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE product_id=?", [flags[range[0]]]);
      const remainingReservations = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE shipment_id=?", [ship3.shipmentId]);
      const passed = popText.includes("今回の発送リストから外す") && body.code === 200 && after === before - 1
        && remaining.length === 2 && !remaining.some((r) => r.manufacturing_no === range[0])
        && Number(removedReservation[0]?.c) === 0 && Number(remainingReservations[0]?.c) === 2;
      return {
        status: passed ? "通过" : "不通过",
        actual: `确认文案=“${popText}”；DELETE code=${body.code}；UI 行 ${before}→${after}；DB 剩余=${remaining.map((r) => r.manufacturing_no).join(",")}；被删产品占用=${removedReservation[0]?.c}、其余占用=${remainingReservations[0]?.c}。`,
        evidence: "UI 产品行点击「リストから外す」并在 Popconfirm 确认；捕获 DELETE；DB 对比清单与占用。",
        requirement: "FEAT-11-shipment 草稿清单删除",
      };
    });

    await book.run("发货管理-005", "添加重复产品被拦截", "FEAT-11-shipment 清单去重", async () => {
      const drawer = await openShipmentDrawer(page, order3);
      const card = productCard(drawer);
      const before = await card.locator("tr.ant-table-row").count();
      await switchSingleEntry(drawer);
      await fillSingleNo(drawer, range[1]);
      const body = await waitPost(page, () => clickAdd(drawer));
      await page.waitForTimeout(900);
      const after = await card.locator("tr.ant-table-row").count();
      const alerts = (await drawer.locator(".ant-alert-warning").allInnerTexts()).join(" | ");
      const dbCount = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_product WHERE shipment_id=? AND manufacturing_no=?", [ship3.shipmentId, range[1]]);
      const failures = body.data?.failures || [];
      const passed = body.code === 200 && (body.data?.added || []).length === 0
        && failures.some((x: any) => /登録されている/.test(String(x.reason)))
        && after === before && Number(dbCount[0]?.c) === 1 && /登録されている/.test(alerts);
      return {
        status: passed ? "通过" : "不通过",
        actual: `code=${body.code}、added=${JSON.stringify(body.data?.added || [])}、failures=${JSON.stringify(failures)}；UI 行 ${before}→${after}；提示=“${compactText(alerts)}”；DB 同号行=${dbCount[0]?.c}。`,
        evidence: "UI 切换「1件ずつ登録」再次录入已在清单中的制造番号；读取失败 Alert 与 DB 清单计数。",
        requirement: "FEAT-11-shipment 清单去重",
      };
    });

    await book.run("发货管理-008", "快递公司必填校验", "FEAT-11-shipment 发送确认必填", async () => {
      const drawer = await openShipmentDrawer(page, order8);
      await drawer.locator(".footer").getByRole("button", { name: /発送を確定/ }).click();
      const modal = page.locator(".ant-modal:visible").filter({ hasText: "送り状ナンバーを追加して発送を確定" }).last();
      await modal.waitFor({ state: "visible", timeout: 8000 });
      const modalText = compactText(await modal.innerText(), 500);
      await modal.getByRole("button", { name: /発送を確定してメールを生成/ }).click();
      await page.waitForTimeout(1000);
      const toasts = await readToasts(page);
      const shipment = await getShipment(token, Number(ship8.shipmentId));
      const rel = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_product_order_relation WHERE shipment_id=?", [ship8.shipmentId]);
      const mail = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=? AND file_type='mail'", [ship8.shipmentId]);
      const passed = /配送業者を選択する/.test(toasts) && shipment.status === "preparing"
        && Number(rel[0]?.c) === 0 && Number(mail[0]?.c) === 0;
      return {
        status: passed ? "通过" : "不通过",
        actual: `确认弹窗可见=${modalText.includes("配送業者：未選択")}；点击最终确认后提示=“${compactText(toasts)}”；寄送状态=${shipment.status}，订单关系=${rel[0]?.c}，邮件=${mail[0]?.c}。`,
        evidence: "UI 未选配送业者打开发送确认并点击最终确认；读取 ant-message、GET shipment 与 DB 关系/邮件。",
        requirement: "FEAT-11-shipment 发送确认必填",
      };
    });

    await book.run("发货管理-017", "无产品时保存与打印被拦截", "FEAT-11-shipment VAL-04；VAL-14；VAL-02", async () => {
      const drawer = await openShipmentDrawer(page, order17);
      const labels = ["送り状を生成（1枚）", "納品書を印刷", "保障確認書を印刷"];
      const disabled: Record<string, boolean> = {};
      for (const label of labels) disabled[label] = await drawer.getByRole("button", { name: label }).isDisabled();
      await drawer.locator(".footer").getByRole("button", { name: "保 存" }).click();
      await page.waitForTimeout(1000);
      const toasts = await readToasts(page);
      const prepare = await apiCall(token, "GET", `/prop/shipment/${ship17.shipmentId}/documents/prepare?type=waybill`);
      const after = await getShipment(token, Number(ship17.shipmentId));
      const files = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?", [ship17.shipmentId]);
      const passed = /製品を1台以上登録する/.test(toasts) && Object.values(disabled).every(Boolean)
        && prepare.code !== 200 && after.status === "preparing" && Number(files[0]?.c) === 0;
      return {
        status: passed ? "通过" : "不通过",
        actual: `保存提示=“${compactText(toasts)}”；三个文件按钮 disabled=${JSON.stringify(disabled)}；API prepare code=${prepare.code}“${prepare.msg}”；状态=${after.status}、文件=${files[0]?.c}。`,
        evidence: "UI 空清单点击保存并检查文件按钮 disabled；API 复核 prepare；DB 文件计数。",
        requirement: "FEAT-11-shipment VAL-04；VAL-14；VAL-02",
      };
    });

    await book.run("发货管理-018", "连续录入一次超过100台被拦截", "FEAT-11-shipment VAL-03；VAL-02；VAL-14", async () => {
      const drawer = await openShipmentDrawer(page, order18);
      await fillRange(page, drawer, `${prefix}-X`, "001", "102");
      const over = await waitPost(page, () => clickAdd(drawer));
      await page.waitForTimeout(700);
      const overVisible = compactText(await drawer.innerText());
      const overToasts = await readToasts(page);
      const overAlert = (await drawer.locator(".ant-alert-warning").allInnerTexts()).join(" | ");

      await fillRange(page, drawer, `${prefix}-X`, "003", "001");
      const reversed = await waitPost(page, () => clickAdd(drawer));
      await page.waitForTimeout(500);

      await fillRange(page, drawer, `${prefix}-Q`, "101", "103");
      const mixedBody = await waitPost(page, () => clickAdd(drawer));
      await page.waitForTimeout(1000);
      const rows = await productCard(drawer).locator("tr.ant-table-row").count();
      const alerts = (await drawer.locator(".ant-alert-warning").allInnerTexts()).join(" | ");
      const failedReservation = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_reservation WHERE product_id=?", [flags[mixed[1]]]);
      const failedRow = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_product WHERE product_id=?", [flags[mixed[1]]]);
      const added = mixedBody.data?.added || [];
      const failures = mixedBody.data?.failures || [];
      const visibleCountMessage = /100台|100 台/.test(overToasts + " | " + overAlert);
      const blockingOk = over.code === 409 && /100台/.test(over.msg) && reversed.code === 409 && /開始番号/.test(reversed.msg);
      const mixedOk = mixedBody.code === 200 && added.length === 2 && failures.length === 1
        && rows === 2 && /Q102/.test(alerts) && Number(failedReservation[0]?.c) === 0 && Number(failedRow[0]?.c) === 0;
      const passed = blockingOk && mixedOk && visibleCountMessage;
      return {
        status: passed ? "通过" : (blockingOk && mixedOk ? "部分验证" : "不通过"),
        actual: `超100台：HTTP body code=${over.code}“${over.msg}”，页面可见提示=${visibleCountMessage}（toasts=“${compactText(overToasts)}”，alerts=“${compactText(overAlert)}”）；起始>结束 code=${reversed.code}“${reversed.msg}”；混合范围 code=${mixedBody.code}、added=${JSON.stringify(added)}、failures=${JSON.stringify(failures)}、UI 行=${rows}、失败编号提示=“${compactText(alerts)}”、失败项占用/清单=${failedReservation[0]?.c}/${failedRow[0]?.c}。`,
        evidence: "UI 连续编号输入 001–102、003–001、101–103；捕获 /products 响应；读取页面可见 Alert/Toast 与 DB 占用/清单。",
        requirement: "FEAT-11-shipment VAL-03；VAL-02；VAL-14",
      };
    });

    const rows = book.list();
    console.log(`[C1] 完成 ${rows.length} 条；通过=${rows.filter((x) => x.status === "通过").length}；部分验证=${rows.filter((x) => x.status === "部分验证").length}；不通过=${rows.filter((x) => x.status === "不通过").length}`);
    console.log(`[C1] 订单 003=${order3} 008=${order8} 017=${order17} 018=${order18}`);
    console.log(`[C1] 寄送 003=${ship3.shipmentId} 008=${ship8.shipmentId} 017=${ship17.shipmentId} 018=${ship18.shipmentId}`);
    console.log(`[C1] 产品 ${JSON.stringify(flags)}`);
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-C1");
    await db.close();
  }
}
main().catch((error) => { console.error("[C1] FAILED:", error instanceof Error ? error.stack : error); process.exit(1); });