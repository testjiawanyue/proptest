/** 订单批量打印补充：打印后确认退出与访问控制（3 条）。 */
import { createHash, randomUUID } from "node:crypto";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiBase,
  runTag, compactText,
} from "./order-runtime-utils.js";
import {
  createBatchFixture, openBatchPage, batchRow, selectBatchRow, setBatchCopies,
  generateBatch,
} from "./order-batch-utils.js";
import { ensureOrderFixtures } from "./order-runtime-utils.js";
import { getShipment, getOrder, shipmentCard } from "./order-shipment-utils.js";
import { createSession, closeSession } from "../../src/actions/session.js";

const book = new ResultBook("reports/order-runtime-results-batch-final.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-BF-${tag}`;
let browser: any;
let adminSession: any;
let anonSession: any;
let restrictedSession: any;

async function rawApi(method: string, path: string, body?: unknown, token?: string): Promise<any> {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { parsed = { text: text.slice(0, 200) }; }
  return { http: response.status, code: parsed.code ?? -1, msg: parsed.msg ?? parsed.text ?? "", data: parsed.data, text };
}

function deniedBatchBody(shipmentId: number, revision: number): any {
  const ids = [shipmentId];
  const requestId = `${randomUUID()}.${createHash("sha256").update(JSON.stringify(ids)).digest("hex")}`;
  return {
    requestId,
    carrier: "yamato",
    issueDate: "2026-10-29",
    items: [{ shipmentId, revision, copies: 1, sourceToken: "denied-source", overrides: {} }],
  };
}

async function loginAs(page: any, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder(/账号|用户名|user|アカウント/i).first().fill(username);
  await page.getByPlaceholder(/密码|password|パスワード/i).first().fill(password);
  await page.getByRole("button", { name: /登\s*录|登录|login|ログイン/i }).first().click();
  await page.waitForURL((url: URL) => !url.pathname.includes("/login"), { timeout: 15000 });
  await page.waitForTimeout(1200);
}

async function inspectBatchPage(page: any): Promise<any> {
  await page.goto("/orders/batch-print", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  const body = compactText(await page.locator("body").innerText(), 1200);
  return {
    finalPath: new URL(page.url()).pathname,
    batchPageCount: await page.locator(".batch-page").count(),
    rowCount: await page.locator("tr.ant-table-row").count(),
    loginVisible: await page.getByPlaceholder(/账号|用户名|user|アカウント/i).first().isVisible().catch(() => false),
    body,
  };
}

async function main(): Promise<void> {
  await db.connect();
  const token = await apiLogin("admin", "admin123");
  const customers = await ensureOrderFixtures(db);
  const confirmFixture = await createBatchFixture(db, token, customers.a, {
    prefix, label: "CONFIRM", productCount: 1, carrier: "yamato",
  });
  const permissionFixture = await createBatchFixture(db, token, customers.b, {
    prefix, label: "PERMISSION", productCount: 1, carrier: "yamato",
  });

  const launcher = await launchAdminSession("verify-order-batch-confirm");
  browser = launcher.browser;
  adminSession = launcher.session;
  const page = adminSession.page;
  page.setDefaultTimeout(20000);

  try {
    await openBatchPage(page);
    await selectBatchRow(page, confirmFixture, 1);
    const generation = await generateBatch(page, token, `reports/batchprint/order-waybills-final-${tag}.xlsx`);
    const documentModal = page.locator(".ant-modal:visible").filter({ hasText: "発送書類の生成" }).last();
    await documentModal.getByRole("button", { name: "閉じる" }).click();
    await documentModal.waitFor({ state: "hidden", timeout: 15000 });
    await page.waitForTimeout(800);

    const row = batchRow(page, confirmFixture);
    await row.getByRole("button", { name: "作業票を変更" }).click();
    const drawer = page.locator(".prop-shipment-drawer");
    await drawer.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1200);
    const drawerBefore = compactText(await drawer.innerText(), 1800);
    const boxItem = drawer.locator(".ant-form-item").filter({ hasText: "箱数" }).first();
    const boxInput = boxItem.locator(".ant-input-number-input").first();
    const saveResponse = page.waitForResponse(
      (response: any) => response.url().includes(`/prop/shipment/${confirmFixture.shipmentId}`)
        && response.request().method() === "PUT",
      { timeout: 20000 },
    );
    await boxInput.fill("2");
    await boxInput.press("Tab");
    const savedBody = await (await saveResponse).json() as any;
    await page.waitForTimeout(900);
    const drawerAfterSave = compactText(await drawer.innerText(), 2200);

    await drawer.locator(".footer button").filter({ hasText: /発送を確定/ }).click();
    const confirmModal = page.locator(".ant-modal:visible").filter({ hasText: /発送を確定|実際に発送済み/ }).last();
    await confirmModal.waitFor({ state: "visible", timeout: 15000 });
    const confirmModalText = compactText(await confirmModal.innerText(), 1200);
    const confirmResponse = page.waitForResponse(
      (response: any) => response.url().includes(`/prop/shipment/${confirmFixture.shipmentId}/confirm`)
        && response.request().method() === "POST",
      { timeout: 30000 },
    );
    await confirmModal.getByRole("button", { name: /発送を確定してメールを生成/ }).click();
    const confirmBody = await (await confirmResponse).json() as any;
    await page.waitForTimeout(2200);
    const drawerAfterConfirm = compactText(await drawer.innerText(), 2200);
    await drawer.getByRole("button", { name: "閉じて一覧に戻る" }).click();
    await drawer.waitFor({ state: "hidden", timeout: 15000 });
    await page.waitForFunction(
      (shipmentNo: string) => ![...document.querySelectorAll("tr.ant-table-row")]
        .some((element) => element.textContent?.includes(shipmentNo)),
      confirmFixture.shipmentNo,
      { timeout: 20000 },
    );
    await page.waitForTimeout(1000);
    const batchPageAfterText = compactText(await page.locator(".batch-page").innerText(), 1600);
    const rowStillOnBatch = await batchRow(page, confirmFixture).count();

    const confirmedShipment = await getShipment(token, confirmFixture.shipmentId);
    const confirmedOrder = await getOrder(token, confirmFixture.orderId);
    const relationRows = await db.query<{ c: number }>(
      "SELECT COUNT(*) c FROM prop_product_order_relation WHERE shipment_id=? AND product_id IN (?)",
      [confirmFixture.shipmentId, confirmFixture.productIds[0]],
    );
    await page.goto(`http://localhost:8090/orders/${confirmFixture.orderId}`);
    await page.locator(".order-detail-page").waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1200);
    const detailCard = shipmentCard(page);
    await detailCard.waitFor({ state: "visible", timeout: 15000 });
    const detailShipmentRows = await detailCard.locator("tr.ant-table-row").count();
    const detailShipmentText = compactText(await detailCard.innerText(), 2000);

    const permBeforeDb = await db.query<any>(
      "SELECT carrier,status,revision FROM prop_shipment WHERE shipment_id=?",
      [permissionFixture.shipmentId],
    );
    const permBeforeFiles = await db.query<{ c: number }>(
      "SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?",
      [permissionFixture.shipmentId],
    );
    const permRevision = Number(permBeforeDb[0]?.revision ?? 1);
    const anonPrepare = await rawApi("POST", "/prop/shipment/batch-labels/prepare", {
      carrier: "yamato", items: [{ shipmentId: permissionFixture.shipmentId, copies: 1 }],
    });
    const anonCreate = await rawApi("POST", "/prop/shipment/batch-labels", deniedBatchBody(permissionFixture.shipmentId, permRevision));
    const anonList = await rawApi("GET", "/prop/shipment/batch-preparations");
    const permAfterAnon = await db.query<any>(
      "SELECT carrier,status,revision FROM prop_shipment WHERE shipment_id=?",
      [permissionFixture.shipmentId],
    );
    const permFilesAfterAnon = await db.query<{ c: number }>(
      "SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?",
      [permissionFixture.shipmentId],
    );

    anonSession = await createSession(browser, { traceName: "verify-order-batch-anon" });
    const anonPage = anonSession.page;
    anonPage.setDefaultTimeout(15000);
    const anonPageResult = await inspectBatchPage(anonPage);
    await closeSession(anonSession, "verify-order-batch-anon");
    anonSession = undefined;

    const restrictedToken = await apiLogin("autocust", "Auto@123456");
    const restrictedPrepare = await rawApi("POST", "/prop/shipment/batch-labels/prepare", {
      carrier: "yamato", items: [{ shipmentId: permissionFixture.shipmentId, copies: 1 }],
    }, restrictedToken);
    const restrictedCreate = await rawApi("POST", "/prop/shipment/batch-labels", deniedBatchBody(permissionFixture.shipmentId, permRevision), restrictedToken);
    const restrictedList = await rawApi("GET", "/prop/shipment/batch-preparations", undefined, restrictedToken);
    const permAfterRestricted = await db.query<any>(
      "SELECT carrier,status,revision FROM prop_shipment WHERE shipment_id=?",
      [permissionFixture.shipmentId],
    );
    const permFilesAfterRestricted = await db.query<{ c: number }>(
      "SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?",
      [permissionFixture.shipmentId],
    );

    restrictedSession = await createSession(browser, { traceName: "verify-order-batch-restricted" });
    const restrictedPage = restrictedSession.page;
    restrictedPage.setDefaultTimeout(15000);
    await loginAs(restrictedPage, "autocust", "Auto@123456");
    const topMenuText = compactText(await restrictedPage.locator(".top-menu").innerText().catch(async () => ""), 600);
    const orderMenuVisible = /订单管理/.test(topMenuText);
    const restrictedPageResult = await inspectBatchPage(restrictedPage);
    await closeSession(restrictedSession, "verify-order-batch-restricted");
    restrictedSession = undefined;

    await book.run("订打补充-044", "打印后修改工作单确认即退出批量页", "FEAT-19 VAL-22", async () => {
      const generated = generation.createBody.code === 200;
      const savedBox = savedBody.code === 200 && /箱数/.test(drawerAfterSave);
      const confirmed = confirmBody.code === 200 && confirmedShipment.status === "shipped"
        && Number(confirmedShipment.boxCount) === 2 && relationRows[0].c === 1;
      const removed = rowStillOnBatch === 0 && !batchPageAfterText.includes(confirmFixture.shipmentNo);
      const inOrder = (confirmedOrder.shipments || []).some((row: any) => Number(row.shipmentId) === confirmFixture.shipmentId && row.status === "shipped")
        && detailShipmentRows === 1 && /ヤマト運輸/.test(detailShipmentText)
        && /発送確定済/.test(detailShipmentText) && /出荷台数/.test(detailShipmentText);
      return {
        status: generated && savedBox && confirmed && removed && inOrder ? "通过" : "不通过",
        actual: `批量打印响应 code=${generation.createBody.code}，文件版本=${JSON.stringify(generation.createBody.data?.files?.map((x: any) => x.version))}；抽屉原箱数=1，修改保存 code=${savedBody.code}；确认弹窗=“${confirmModalText.slice(0, 220)}”，确认响应 code=${confirmBody.code}；确认后状态=${confirmedShipment.status}、箱数=${confirmedShipment.boxCount}、订单关系数=${relationRows[0].c}；关闭后批量页该行数=${rowStillOnBatch}；订单详情出荷记录行数=${detailShipmentRows}、卡片文本=“${detailShipmentText}”、订单 API 寄送状态=${JSON.stringify((confirmedOrder.shipments || []).filter((x: any) => Number(x.shipmentId) === confirmFixture.shipmentId).map((x: any) => x.status))}。`,
        evidence: "先真实批量生成面单，再从批量页打开抽屉将箱数改为 2 并保存，随后在抽屉完成确认寄出；关闭后等待批量页刷新并核对行消失，再用寄送 API、订单 API、订单关系表及订单详情页面交叉验证。",
      };
    });

    await book.run("订打补充-045", "未登录不能访问订单批量打印", "FEAT-19 VAL-21", async () => {
      const apiDenied = [anonList, anonPrepare, anonCreate].every((row) => row.code === 401);
      const noWrite = permAfterAnon[0]?.carrier === permBeforeDb[0]?.carrier
        && permAfterAnon[0]?.status === permBeforeDb[0]?.status
        && Number(permAfterAnon[0]?.revision) === Number(permBeforeDb[0]?.revision)
        && Number(permFilesAfterAnon[0]?.c) === Number(permBeforeFiles[0]?.c);
      const pageDenied = anonPageResult.batchPageCount === 0 && anonPageResult.rowCount === 0
        && anonPageResult.loginVisible && anonPageResult.finalPath.includes("login");
      return {
        status: apiDenied && noWrite && pageDenied ? "通过" : "不通过",
        actual: `未登录页面最终路径=${anonPageResult.finalPath}，批量页容器=${anonPageResult.batchPageCount}，表格行=${anonPageResult.rowCount}，登录控件可见=${anonPageResult.loginVisible}；API list/prepare/create=${JSON.stringify([anonList, anonPrepare, anonCreate].map((x) => ({ http: x.http, code: x.code, msg: x.msg })))}；寄送 DB 前/后 carrier=${permBeforeDb[0]?.carrier}/${permAfterAnon[0]?.carrier}、status=${permBeforeDb[0]?.status}/${permAfterAnon[0]?.status}、revision=${permBeforeDb[0]?.revision}/${permAfterAnon[0]?.revision}，文件数=${permBeforeFiles[0]?.c}/${permFilesAfterAnon[0]?.c}。`,
        evidence: "无 Cookie 新上下文直访批量打印页；无 Token 调用批量列表、prepare、create；随后读取 prop_shipment 与文件表，确认未生成文件、未改写承运商或修订。",
      };
    });

    await book.run("订打补充-046", "无批量打印权限不能访问或操作", "FEAT-19 页面级授权", async () => {
      const apiDenied = [restrictedList, restrictedPrepare, restrictedCreate].every((row) => row.code === 403);
      const noWrite = permAfterRestricted[0]?.carrier === permBeforeDb[0]?.carrier
        && permAfterRestricted[0]?.status === permBeforeDb[0]?.status
        && Number(permAfterRestricted[0]?.revision) === Number(permBeforeDb[0]?.revision)
        && Number(permFilesAfterRestricted[0]?.c) === Number(permBeforeFiles[0]?.c);
      const pageDenied = !orderMenuVisible && restrictedPageResult.batchPageCount === 0
        && restrictedPageResult.rowCount === 0 && restrictedPageResult.finalPath === "/404";
      return {
        status: apiDenied && noWrite && pageDenied ? "通过" : "不通过",
        actual: `autocust 顶部菜单=“${topMenuText}”，含订单管理入口=${orderMenuVisible}；直访批量页最终路径=${restrictedPageResult.finalPath}、批量容器=${restrictedPageResult.batchPageCount}、表格行=${restrictedPageResult.rowCount}；API list/prepare/create=${JSON.stringify([restrictedList, restrictedPrepare, restrictedCreate].map((x) => ({ http: x.http, code: x.code, msg: x.msg })))}；寄送 DB 前/后 carrier=${permBeforeDb[0]?.carrier}/${permAfterRestricted[0]?.carrier}、status=${permBeforeDb[0]?.status}/${permAfterRestricted[0]?.status}、revision=${permBeforeDb[0]?.revision}/${permAfterRestricted[0]?.revision}，文件数=${permBeforeFiles[0]?.c}/${permFilesAfterRestricted[0]?.c}。`,
        evidence: "autocust 登录后读取顶部菜单并直访批量打印页；以该账号 Token 调用批量列表、prepare、create；DB/API 核对无文件、承运商、状态或修订变化。",
      };
    });

    console.log(`[BATCH-FINAL] 完成 3 条；通过=${book.list().filter((x) => x.status === "通过").length}；部分验证=${book.list().filter((x) => x.status === "部分验证").length}；不通过=${book.list().filter((x) => x.status === "不通过").length}`);
    console.log(`[BATCH-FINAL] confirm=${confirmFixture.orderNo}/${confirmFixture.shipmentNo}，permission=${permissionFixture.shipmentNo}`);
  } finally {
    try { if (anonSession) await closeSession(anonSession, "verify-order-batch-anon"); } catch {}
    try { if (restrictedSession) await closeSession(restrictedSession, "verify-order-batch-restricted"); } catch {}
    if (browser && adminSession) await finishSession(browser, adminSession, "verify-order-batch-confirm");
    await db.close();
  }
}

main().catch((error) => {
  console.error("[BATCH-FINAL] FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
