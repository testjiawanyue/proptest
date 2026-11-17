/** 订单寄送 C4-A：局部保存草稿与邮件冻结（024/025）。 */
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiCall, runTag,
  ensureOrderFixtures, readToasts, compactText, formItem, pickOptionScroll,
} from "./order-runtime-utils.js";
import {
  ensureProduct, createOrder, createShipment, addProduct, saveFields, getShipment,
  confirmShipment, openShipmentDrawer, switchSingleEntry, fillSingleNo, clickAdd,
} from "./order-shipment-utils.js";

const book = new ResultBook("reports/order-runtime-results-C4a.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-C4A-${tag}`;
let browser: any;
let session: any;
let token = "";
let fixtures: any;

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
async function makeShipped(orderNo: string, productNo: string, tracking: string): Promise<{ orderId: number; shipmentId: number }> {
  const orderId = await createOrder(token, fixtures.a, orderNo, 1);
  const shipment = await createShipment(token, orderId);
  const shipmentId = Number(shipment.shipmentId);
  await addProductMust(shipmentId, productNo);
  await saveFields(token, shipmentId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  await confirmMust(shipmentId, [tracking]);
  return { orderId, shipmentId };
}

async function main(): Promise<void> {
  await db.connect();
  fixtures = await ensureOrderFixtures(db);
  token = await apiLogin("admin", "admin123");

  const p024Shipped = `${prefix}-024S`;
  const p024Preparing = `${prefix}-024P`;
  const p025 = `${prefix}-025`;
  for (const no of [p024Shipped, p024Preparing, p025]) await ensureProduct(db, no);

  const shipped024 = await makeShipped(`${prefix}-024-SHIP`, p024Shipped, `AUTO-024-A001-${tag}`);
  const order024Prep = await createOrder(token, fixtures.a, `${prefix}-024-PREP`, 1);
  const ship024Prep = await createShipment(token, order024Prep);
  const ship024PrepId = Number(ship024Prep.shipmentId);
  const shipped025 = await makeShipped(`${prefix}-025-SHIP`, p025, `AUTO-025-A001-${tag}`);

  const launcher = await launchAdminSession("verify-order-C4a");
  browser = launcher.browser; session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(15000);
  try {    await book.run("发货管理-024", "局部保存与刷新保留其他未保存草稿", "spec10-28 FEAT-11-shipment VAL-04a（spec 4.5）", async () => {
      const drawer = await openShipmentDrawer(page, shipped024.orderId);
      const trackingInput = drawer.locator(".tracking-maintenance-row").first().locator("input");
      const trackingSave = drawer.locator(".tracking-primary-actions").getByRole("button", { name: /送り状ナンバーを保存/ });
      await trackingInput.fill(`AUTO-024-B002-${tag}`);
      const carrierItem = drawer.locator(".ant-form-item").filter({ hasText: "配送業者" }).last();
      const carrierPutPromise = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${shipped024.shipmentId}`) && r.request().method() === "PUT",
        { timeout: 20000 },
      );
      await carrierItem.locator(".ant-select").click();
      await pickOptionScroll(page, "佐川急便");
      const carrierPut = await carrierPutPromise;
      const carrierBody = await carrierPut.json() as any;
      await page.waitForTimeout(1000);
      const afterCarrier = await getShipment(token, shipped024.shipmentId);
      const trackingValueAfterCarrier = await trackingInput.inputValue();
      const footerAfterCarrier = compactText(await drawer.locator(".footer").innerText(), 600);
      const trackingSaveEnabled = !(await trackingSave.isDisabled());
      const draftPreserved = carrierBody.code === 200 && afterCarrier.carrier === "sagawa"
        && JSON.stringify(afterCarrier.trackingNumbers) === JSON.stringify([`AUTO-024-A001-${tag}`])
        && trackingValueAfterCarrier === `AUTO-024-B002-${tag}` && /未保存の変更あり/.test(footerAfterCarrier)
        && trackingSaveEnabled;

      await drawer.locator(".footer").getByRole("button", { name: /閉じて一覧に戻る|閉じる/ }).click();
      const discardModal = page.locator(".ant-modal-confirm:visible").last();
      await discardModal.waitFor({ state: "visible", timeout: 8000 });
      await discardModal.locator(".ant-btn-primary").click();
      await drawer.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(800);
      const reopened = await openShipmentDrawer(page, shipped024.orderId);
      const reopenedTracking = await reopened.locator(".tracking-maintenance-row").first().locator("input").inputValue();
      const reopenedCarrier = await reopened.locator(".ant-form-item").filter({ hasText: "配送業者" }).last().locator(".ant-select-selection-item").innerText().catch(() => "");
      const discardOk = reopenedTracking === `AUTO-024-A001-${tag}` && reopenedCarrier.includes("佐川急便");
      await reopened.locator(".footer").getByRole("button", { name: /閉じて一覧に戻る|閉じる/ }).click();
      await page.waitForTimeout(600);

      const prepDrawer = await openShipmentDrawer(page, order024Prep);
      let failOnce = true;
      const routePattern = `**/prop/shipment/${ship024PrepId}`;
      await page.route(routePattern, async (route: any) => {
        const req = route.request();
        if (failOnce && req.method() === "PUT") {
          const body = req.postDataJSON();
          if ((body?.fields || []).includes("boxCount")) {
            failOnce = false;
            await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 409, msg: "AUTO_SIMULATED_BOX_SAVE_FAILURE" }) });
            return;
          }
        }
        await route.continue();
      });
      const boxInput = formItem(prepDrawer, "箱数").locator("input").first();
      const failedPutPromise = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${ship024PrepId}`) && r.request().method() === "PUT",
        { timeout: 20000 },
      );
      await boxInput.fill("2");
      await boxInput.press("Tab");
      const failedPut = await failedPutPromise;
      const failedBody = await failedPut.json() as any;
      await page.waitForTimeout(900);
      const failedToast = await readToasts(page);
      const prepAfterFailure = await getShipment(token, ship024PrepId);
      const footerAfterFailure = compactText(await prepDrawer.locator(".footer").innerText(), 600);
      const boxValueAfterFailure = await boxInput.inputValue();

      await switchSingleEntry(prepDrawer);
      await fillSingleNo(prepDrawer, p024Preparing);
      const addPromise = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${ship024PrepId}/products`) && r.request().method() === "POST",
        { timeout: 20000 },
      );
      await clickAdd(prepDrawer);
      const addResponse = await addPromise;
      const addBody = await addResponse.json() as any;
      await page.waitForTimeout(1200);
      const boxAfterAdd = await boxInput.inputValue();
      const footerAfterAdd = compactText(await prepDrawer.locator(".footer").innerText(), 600);
      const preservedAcrossRefresh = boxAfterAdd === "2" && /未保存の変更あり/.test(footerAfterAdd);

      await page.unroute(routePattern);
      const manualSavePromise = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${ship024PrepId}`) && r.request().method() === "PUT",
        { timeout: 20000 },
      );
      await prepDrawer.locator(".footer").getByRole("button", { name: /保\s*存/ }).click();
      const manualSave = await manualSavePromise;
      const manualBody = await manualSave.json() as any;
      await page.waitForTimeout(1000);
      const prepFinal = await getShipment(token, ship024PrepId);
      const savedOk = failedBody.code === 409 && prepAfterFailure.boxCount == null && boxValueAfterFailure === "2"
        && /未保存の変更あり/.test(footerAfterFailure) && addBody.code === 200
        && preservedAcrossRefresh && manualBody.code === 200 && Number(prepFinal.boxCount) === 2;
      const passed = draftPreserved && discardOk && savedOk;
      return {
        status: passed ? "部分验证" : "不通过",
        actual: `场景1：已寄出记录输入 B002 未保存后切换ヤマト→佐川，PUT code=${carrierBody.code}、DB carrier=${afterCarrier.carrier}、运单号仍=${JSON.stringify(afterCarrier.trackingNumbers)}、输入框仍=${trackingValueAfterCarrier}、footer=“${footerAfterCarrier}”、保存按钮可用=${trackingSaveEnabled}；关闭并确认放弃后重开，运单号恢复=${reopenedTracking}、carrier 显示=“${reopenedCarrier}”，已写入承运商未回滚=${discardOk}。场景2：拦截箱数自动保存返回 code=${failedBody.code}“${failedBody.msg}”，toast=“${failedToast}”，DB boxCount=${prepAfterFailure.boxCount}、输入框=${boxValueAfterFailure}、footer=“${footerAfterFailure}”；随后 UI 加入合法产品 code=${addBody.code}，刷新后箱数输入=${boxAfterAdd}、footer=“${footerAfterAdd}”；移除故障后手动保存 code=${manualBody.code}、最终 DB boxCount=${prepFinal.boxCount}。迟到响应跨对象覆盖、结果未知安全退出未构造，故为部分验证。`,
        evidence: "UI 已寄出抽屉修改未保存运单号→切换承运商等待自动保存→关闭放弃后重开；UI 准备抽屉用 Playwright 路由注入一次箱数 PUT 业务失败→继续 UI 加入产品→检查草稿保留→手动保存；DB/API 对比。",
        requirement: "spec10-28 FEAT-11-shipment VAL-04a（spec 4.5）",
      };
    });    await book.run("发货管理-025", "邮件使用已保存资料、不隐式保存草稿", "spec10-28 FEAT-11-shipment VAL-08a（spec 4.5、6.2）", async () => {
      const drawer = await openShipmentDrawer(page, shipped025.orderId);
      const trackingInput = drawer.locator(".tracking-maintenance-row").first().locator("input");
      const generateButton = drawer.getByRole("button", { name: /メール本文を生成/ });
      const trackingSave = drawer.locator(".tracking-primary-actions").getByRole("button", { name: /送り状ナンバーを保存/ });

      await trackingInput.fill(`AUTO-025-B002-${tag}`);
      const enabledWhileDirty = !(await generateButton.isDisabled());
      const firstMailRequest = page.waitForRequest(
        (r: any) => r.url().includes(`/prop/shipment/${shipped025.shipmentId}/files`) && r.method() === "POST",
        { timeout: 20000 },
      );
      const firstMailResponse = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${shipped025.shipmentId}/files`) && r.request().method() === "POST",
        { timeout: 20000 },
      );
      await generateButton.click();
      await firstMailRequest;
      const firstMail = await firstMailResponse;
      const firstBody = await firstMail.json() as any;
      const firstModal = mailModal(page);
      await firstModal.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(700);
      const firstMailText = compactText(await firstModal.innerText(), 2200);
      await firstModal.getByRole("button", { name: "閉じる" }).click();
      await firstModal.waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(600);
      const afterFirstMail = await getShipment(token, shipped025.shipmentId);
      const draftKeptAfterMail = (await trackingInput.inputValue()) === `AUTO-025-B002-${tag}`
        && !(await trackingSave.isDisabled());
      const firstUsesSaved = firstBody.code === 200 && Number(firstBody.data?.file?.version) === 2
        && firstMailText.includes(`AUTO-025-A001-${tag}`) && !firstMailText.includes(`AUTO-025-B002-${tag}`)
        && JSON.stringify(afterFirstMail.trackingNumbers) === JSON.stringify([`AUTO-025-A001-${tag}`]) && draftKeptAfterMail;

      const savePromise = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${shipped025.shipmentId}`) && r.request().method() === "PUT",
        { timeout: 20000 },
      );
      await trackingSave.click();
      const saveResponse = await savePromise;
      const saveBody = await saveResponse.json() as any;
      await page.waitForTimeout(900);
      const savedShipment = await getShipment(token, shipped025.shipmentId);

      const secondMailRequest = page.waitForRequest(
        (r: any) => r.url().includes(`/prop/shipment/${shipped025.shipmentId}/files`) && r.method() === "POST",
        { timeout: 20000 },
      );
      const secondMailResponse = page.waitForResponse(
        (r: any) => r.url().includes(`/prop/shipment/${shipped025.shipmentId}/files`) && r.request().method() === "POST",
        { timeout: 20000 },
      );
      await generateButton.click();
      const secondRequest = await secondMailRequest;
      const secondMail = await secondMailResponse;
      const secondBody = await secondMail.json() as any;
      const replayCommand = secondRequest.postDataJSON();
      const secondModal = mailModal(page);
      await secondModal.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(700);
      const secondMailText = compactText(await secondModal.innerText(), 2200);
      const secondFileId = Number(secondBody.data?.file?.fileId);
      await secondModal.getByRole("button", { name: "閉じる" }).click();
      await secondModal.waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(600);

      const oldRow = drawer.locator("tr.ant-table-row", { hasText: /発送通知メール v2/ }).first();
      await oldRow.getByRole("button", { name: "表示" }).click();
      const oldModal = mailModal(page);
      await oldModal.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(600);
      const oldText = compactText(await oldModal.innerText(), 2200);
      await oldModal.getByRole("button", { name: "閉じる" }).click();
      await oldModal.waitFor({ state: "hidden", timeout: 8000 }).catch(() => undefined);

      const replay = await apiCall(token, "POST", `/prop/shipment/${shipped025.shipmentId}/files`, replayCommand);
      const files = await db.query<any>("SELECT file_id,version,request_id,rendered_content FROM prop_shipment_file WHERE shipment_id=? AND file_type='mail' ORDER BY version", [shipped025.shipmentId]);
      const v1 = files.find((x) => Number(x.version) === 1);
      const v2 = files.find((x) => Number(x.version) === 2);
      const v3 = files.find((x) => Number(x.version) === 3);
      const passed = firstUsesSaved && saveBody.code === 200
        && JSON.stringify(savedShipment.trackingNumbers) === JSON.stringify([`AUTO-025-B002-${tag}`])
        && secondBody.code === 200 && Number(secondBody.data?.file?.version) === 3
        && secondMailText.includes(`AUTO-025-B002-${tag}`) && !secondMailText.includes(`AUTO-025-A001-${tag}`)
        && oldText.includes(`AUTO-025-A001-${tag}`) && !oldText.includes(`AUTO-025-B002-${tag}`)
        && files.length === 3 && Number(v1?.version) === 1 && Number(v2?.version) === 2 && Number(v3?.version) === 3
        && String(v1?.rendered_content).includes(`AUTO-025-A001-${tag}`)
        && String(v2?.rendered_content).includes(`AUTO-025-A001-${tag}`)
        && replay.code === 200 && Number(replay.data?.file?.fileId) === secondFileId
        && files.filter((x) => Number(x.version) === 3).length === 1;
      return {
        status: passed ? "通过" : "不通过",
        actual: `未保存 B002 时生成按钮仍可用=${enabledWhileDirty}；首次生成 v${firstBody.data?.file?.version}，正文使用已保存 A001=${firstMailText.includes(`AUTO-025-A001-${tag}`)}、不含 B002=${!firstMailText.includes(`AUTO-025-B002-${tag}`)}，DB 运单号仍=A001、UI 草稿保留=${draftKeptAfterMail}；保存 PUT code=${saveBody.code}、DB=${JSON.stringify(savedShipment.trackingNumbers)}；再次生成 v${secondBody.data?.file?.version}，正文含 B002=${secondMailText.includes(`AUTO-025-B002-${tag}`)}；回看 v2 正文仍为 A001=${oldText.includes(`AUTO-025-A001-${tag}`)}；DB 版本=${files.map((x) => `${x.version}:${x.file_id}`).join(",")}；同请求重放 code=${replay.code}、fileId 不变=${Number(replay.data?.file?.fileId) === secondFileId}、未新增 v3。`,
        evidence: "UI 已寄出抽屉制造 B002 未保存草稿→直接生成邮件读取正文→保存 B002→再次生成→回看 v2；API 同请求重放；DB 校验运单号、邮件版本与冻结正文。",
        requirement: "spec10-28 FEAT-11-shipment VAL-08a（spec 4.5、6.2）",
      };
    });

    const rows = book.list();
    console.log(`[C4A] 完成 ${rows.length} 条；通过=${rows.filter((x) => x.status === "通过").length}；部分验证=${rows.filter((x) => x.status === "部分验证").length}；不通过=${rows.filter((x) => x.status === "不通过").length}`);
    console.log(`[C4A] 024 已寄出=${shipped024.orderId}/${shipped024.shipmentId} 准备=${order024Prep}/${ship024PrepId}`);
    console.log(`[C4A] 025 已寄出=${shipped025.orderId}/${shipped025.shipmentId}`);
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-C4a");
    await db.close();
  }
}
main().catch((error) => { console.error("[C4A] FAILED:", error instanceof Error ? error.stack : error); process.exit(1); });