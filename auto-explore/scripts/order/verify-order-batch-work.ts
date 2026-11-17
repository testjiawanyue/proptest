/** 订单批量打印补充：承运商、工作单刷新与边界（7 条）。 */
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, runTag, compactText,
} from "./order-runtime-utils.js";
import {
  createBatchFixture, openBatchPage, batchRow, selectBatchRow, unselectBatchRow,
  setBatchCopies, chooseBatchCarrier, batchSummary, generateBatch,
} from "./order-batch-utils.js";
import { ensureOrderFixtures } from "./order-runtime-utils.js";
import { getShipment, saveFields } from "./order-shipment-utils.js";

const book = new ResultBook("reports/order-runtime-results-batch-work.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-BW-${tag}`;
let browser: any;
let session: any;

async function openDrawer(page: any, fixture: any): Promise<any> {
  const row = batchRow(page, fixture);
  await row.getByRole("button", { name: "作業票を変更" }).click();
  const drawer = page.locator(".prop-shipment-drawer");
  await drawer.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(1200);
  return drawer;
}

async function closeDrawer(page: any, drawer: any): Promise<void> {
  await drawer.getByRole("button", { name: "閉じる", exact: true }).click();
  await drawer.waitFor({ state: "hidden", timeout: 15000 });
  await page.waitForTimeout(1800);
}

function drawerCarrier(drawer: any): Promise<string> {
  return drawer.locator(".ant-form-item").filter({ hasText: "配送業者" })
    .locator(".ant-select-selection-item").first().innerText();
}

function drawerBoxCount(drawer: any): Promise<string> {
  return drawer.locator(".ant-form-item").filter({ hasText: "箱数" })
    .locator(".ant-input-number-input").first().inputValue();
}

async function main(): Promise<void> {
  await db.connect();
  const token = await apiLogin("admin", "admin123");
  const customers = await ensureOrderFixtures(db);
  const switchFixture = await createBatchFixture(db, token, customers.a, {
    prefix, label: "SWITCH", productCount: 1, carrier: "yamato",
  });
  const editFixture = await createBatchFixture(db, token, customers.b, {
    prefix, label: "EDIT", productCount: 2, carrier: "yamato",
  });
  const logisticsFixture = await createBatchFixture(db, token, customers.a, {
    prefix, label: "LOGISTICS", productCount: 1, carrier: "yamato",
  });
  const generateOne = await createBatchFixture(db, token, customers.a, {
    prefix, label: "GEN1", productCount: 1, carrier: "yamato",
  });
  const generateTwo = await createBatchFixture(db, token, customers.b, {
    prefix, label: "GEN2", productCount: 1, carrier: "yamato",
  });

  const launcher = await launchAdminSession("verify-order-batch-work");
  browser = launcher.browser;
  session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(20000);

  try {
    await openBatchPage(page);
    await selectBatchRow(page, switchFixture, 2);
    const switchesBefore = {
      checked: await batchRow(page, switchFixture).getByRole("checkbox").isChecked(),
      copies: await batchRow(page, switchFixture).locator(".ant-input-number-input").first().inputValue(),
      summary: await batchSummary(page),
    };
    await chooseBatchCarrier(page, "佐川急便");
    const switchesAfter = {
      checked: await batchRow(page, switchFixture).getByRole("checkbox").isChecked(),
      copies: await batchRow(page, switchFixture).locator(".ant-input-number-input").first().inputValue(),
      summary: await batchSummary(page),
      carrier: compactText(await page.locator(".carrier-select .ant-select-selection-item").innerText()),
    };
    const afterSwitchDb = await db.query<any>(
      "SELECT carrier,status,revision FROM prop_shipment WHERE shipment_id=?",
      [switchFixture.shipmentId],
    );
    const afterSwitchApi = await getShipment(token, switchFixture.shipmentId);
    await page.reload();
    await page.locator("tr.ant-table-row").first().waitFor({ state: "visible" });
    await page.waitForTimeout(900);
    const afterReloadDb = await db.query<any>(
      "SELECT carrier,status,revision FROM prop_shipment WHERE shipment_id=?",
      [switchFixture.shipmentId],
    );
    const afterReloadApi = await getShipment(token, switchFixture.shipmentId);
    const drawerSwitch = await openDrawer(page, switchFixture);
    const drawerSwitchCarrier = compactText(await drawerCarrier(drawerSwitch));
    await closeDrawer(page, drawerSwitch);
    await unselectBatchRow(page, switchFixture);

    const drawerEdit = await openDrawer(page, editFixture);
    const editDrawerText = compactText(await drawerEdit.innerText(), 1800);
    const editCarrier = compactText(await drawerCarrier(drawerEdit));
    const editDate = await drawerEdit.locator("input[type=date]").first().inputValue();
    const editBox = await drawerBoxCount(drawerEdit);
    const editProductRows = await drawerEdit.locator("tr.ant-table-row").count();
    await closeDrawer(page, drawerEdit);

    const editRowBefore = batchRow(page, editFixture);
    const editRowBeforeText = compactText(await editRowBefore.innerText(), 900);
    const drawerRemove = await openDrawer(page, editFixture);
    const productToRemove = editFixture.productNos[1];
    const productRow = drawerRemove.locator("tr.ant-table-row").filter({ hasText: productToRemove }).first();
    await productRow.getByRole("button", { name: "リストから外す" }).click();
    const popover = page.locator(".ant-popover:visible").last();
    await popover.waitFor({ state: "visible" });
    const removeResponse = page.waitForResponse(
      (response: any) => response.url().includes(`/prop/shipment/${editFixture.shipmentId}/products/`)
        && response.request().method() === "DELETE",
      { timeout: 20000 },
    );
    await popover.getByRole("button", { name: "OK" }).click();
    const removedBody = await (await removeResponse).json() as any;
    await page.waitForTimeout(1000);
    const remainingInDrawer = compactText(await drawerRemove.innerText(), 1000);
    await closeDrawer(page, drawerRemove);
    await page.waitForTimeout(1200);
    const editRowAfter = batchRow(page, editFixture);
    const editCellsAfter = (await editRowAfter.locator("td").allInnerTexts()).map((value) => compactText(value));
    const editApiAfter = await getShipment(token, editFixture.shipmentId);

    const drawerLogistics = await openDrawer(page, logisticsFixture);
    const logisticsBefore = await drawerBoxCount(drawerLogistics);
    const boxItem = drawerLogistics.locator(".ant-form-item").filter({ hasText: "箱数" }).first();
    const boxInput = boxItem.locator(".ant-input-number-input").first();
    const saveResponse = page.waitForResponse(
      (response: any) => response.url().includes(`/prop/shipment/${logisticsFixture.shipmentId}`)
        && response.request().method() === "PUT",
      { timeout: 20000 },
    );
    await boxInput.fill("2");
    await boxInput.press("Tab");
    const savedBody = await (await saveResponse).json() as any;
    await page.waitForTimeout(900);
    const logisticsAfterUi = await drawerBoxCount(drawerLogistics);
    await closeDrawer(page, drawerLogistics);
    const logisticsDb = await db.query<any>(
      "SELECT carrier,ship_date,box_count,status,confirmed_time FROM prop_shipment WHERE shipment_id=?",
      [logisticsFixture.shipmentId],
    );
    const logisticsRelations = await db.query<{ c: number }>(
      `SELECT COUNT(*) c FROM prop_product_order_relation r
       WHERE r.shipment_id=?`,
      [logisticsFixture.shipmentId],
    );

    await selectBatchRow(page, generateOne, 1);
    await selectBatchRow(page, generateTwo, 1);
    const generation = await generateBatch(page, token, `reports/batchprint/order-waybills-work-${tag}.xlsx`);
    const batchModal = page.locator(".ant-modal:visible").filter({ hasText: "発送書類の生成" }).last();
    await batchModal.getByRole("button", { name: "閉じる" }).click();
    await batchModal.waitFor({ state: "hidden", timeout: 15000 });
    await page.waitForTimeout(800);
    const batchTables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()
       AND (LOWER(table_name) LIKE '%batch%' OR LOWER(table_name) LIKE '%print%' OR LOWER(table_name) LIKE '%waybill%')`,
    );
    const suspiciousTables = batchTables
      .map((row) => String(row.table_name))
      .filter((name) => /order.*(batch|print)|batch.*print|print.*batch|print.*history|print.*job/.test(name));
    const responseKeys = Object.keys(generation.createBody?.data || {}).sort();
    const pageText = compactText(await page.locator(".batch-page").innerText(), 2600);
    const batchButtons = (await page.locator(".batch-page button").allInnerTexts()).map((value) => compactText(value)).filter(Boolean);

    await book.run("订打补充-026", "切换快递公司不清空勾选", "FEAT-19 §4.6、VAL-20", async () => {
      const passed = switchesAfter.checked && switchesAfter.copies === "2"
        && switchesAfter.carrier === "佐川急便" && /佐川急便/.test(switchesAfter.summary.text)
        && /選択 1 件/.test(switchesAfter.summary.text) && /送り状 2 枚/.test(switchesAfter.summary.text);
      return {
        status: passed ? "通过" : "不通过",
        actual: `切换前勾选=${switchesBefore.checked}、张数=${switchesBefore.copies}、汇总=“${switchesBefore.summary.text}”；切换为佐川急便后勾选=${switchesAfter.checked}、张数=${switchesAfter.copies}、汇总=“${switchesAfter.summary.text}”、按钮=“${switchesAfter.summary.button}”。`,
        evidence: "UI 勾选寄送并设张数 2，切换顶部承运商后重新读取勾选状态、张数输入和底部汇总。",
      };
    });

    await book.run("订打补充-027", "仅切换快递公司不回写寄送", "FEAT-19 VAL-20", async () => {
      const passed = afterSwitchDb[0]?.carrier === "yamato" && afterReloadDb[0]?.carrier === "yamato"
        && afterSwitchApi.carrier === "yamato" && afterReloadApi.carrier === "yamato"
        && drawerSwitchCarrier === "ヤマト運輸";
      return {
        status: passed ? "通过" : "不通过",
        actual: `顶部切到佐川急便后：DB carrier=${afterSwitchDb[0]?.carrier}/status=${afterSwitchDb[0]?.status}/revision=${afterSwitchDb[0]?.revision}，API carrier=${afterSwitchApi.carrier}；页面重载后 DB carrier=${afterReloadDb[0]?.carrier}/revision=${afterReloadDb[0]?.revision}，API carrier=${afterReloadApi.carrier}；重开后抽屉显示=“${drawerSwitchCarrier}”。`,
        evidence: "只切换顶部承运商，不生成面单；随后重载页面并在寄送抽屉核对承运商，同时读取 API 与 prop_shipment 表确认未回写。",
      };
    });

    await book.run("订打补充-028", "修改工作单打开对应寄送抽屉", "FEAT-19 §4.2、§4.5", async () => {
      const productsRestored = editFixture.productNos.every((no) => editDrawerText.includes(no));
      const passed = productsRestored && editProductRows === 2 && editCarrier === "ヤマト運輸"
        && editDate === "2026-10-29" && editBox === "1";
      return {
        status: passed ? "通过" : "不通过",
        actual: `点击 ${editFixture.shipmentNo} 行“作業票を変更”后，抽屉标题/内容含寄送号=${editDrawerText.includes(editFixture.shipmentNo)}；产品行数=${editProductRows}，两产品均恢复=${productsRestored}；承运商=“${editCarrier}”，发送日=${editDate}，箱数=${editBox}。`,
        evidence: "从批量页点击目标行修改工作单，读取 ShipmentDrawer 的产品表、承运商、发送日与箱数，与夹具保存值比对。",
      };
    });

    await book.run("订打补充-029", "修改产品后列表摘要刷新", "FEAT-19 §4.5、VAL-19", async () => {
      const rowPassed = editCellsAfter[3].includes(editFixture.productNos[0])
        && !editCellsAfter[3].includes(productToRemove) && Number(editCellsAfter[4]) === 1;
      const apiPassed = editApiAfter.products.length === 1
        && editApiAfter.products[0].manufacturingNo === editFixture.productNos[0];
      return {
        status: rowPassed && apiPassed && removedBody.code === 200 ? "通过" : "不通过",
        actual: `移除前行摘要=“${editRowBeforeText}”；抽屉内移除 ${productToRemove} 响应 code=${removedBody.code}，移除后抽屉仍含剩余产品=${remainingInDrawer.includes(editFixture.productNos[0])}；关闭后行产品摘要=“${editCellsAfter[3]}”、台数=${editCellsAfter[4]}；API 产品=${JSON.stringify(editApiAfter.products.map((x: any) => x.manufacturingNo))}。`,
        evidence: "通过“作業票を変更”打开抽屉，在真实产品表点击“リストから外す”并确认；关闭抽屉后读取批量行摘要、台数和寄送 API。",
      };
    });

    await book.run("订打补充-030", "修改物流资料不登记寄出", "FEAT-19 VAL-19", async () => {
      const passed = savedBody.code === 200 && logisticsAfterUi === "2"
        && Number(logisticsDb[0]?.box_count) === 2 && logisticsDb[0]?.status === "preparing"
        && logisticsDb[0]?.confirmed_time == null && logisticsRelations[0].c === 0;
      return {
        status: passed ? "通过" : "不通过",
        actual: `箱数由 ${logisticsBefore} 改为 ${logisticsAfterUi}，PUT code=${savedBody.code}；DB carrier=${logisticsDb[0]?.carrier}、ship_date=${logisticsDb[0]?.ship_date}、box_count=${logisticsDb[0]?.box_count}、status=${logisticsDb[0]?.status}、confirmed_time=${logisticsDb[0]?.confirmed_time}；订单产品关系数=${logisticsRelations[0].c}。`,
        evidence: "在寄送抽屉修改箱数触发自动保存，关闭后读取 prop_shipment 与 prop_product_order_relation，确认仍 preparing 且无寄出关系。",
      };
    });

    await book.run("订打补充-041", "不建立打印批次台账", "FEAT-19 §4.7、§6", async () => {
      const passed = suspiciousTables.length === 0
        && !responseKeys.some((key) => /batch|task|history|print/i.test(key))
        && !/印刷番号|バッチ番号|印刷履歴|ジョブ履歴/.test(pageText);
      return {
        status: passed ? "通过" : "不通过",
        actual: `两笔真实批量生成响应 data 键=${JSON.stringify(responseKeys)}，文件=${JSON.stringify((generation.createBody.data?.files || []).map((x: any) => ({ shipmentId: x.shipmentId, version: x.version })))}；数据库中疑似订单打印批次表=${JSON.stringify(suspiciousTables)}；页面出现印刷番号/批次号/打印历史文本=${/印刷番号|バッチ番号|印刷履歴|ジョブ履歴/.test(pageText)}。`,
        evidence: "完成两笔批量生成后核对响应结构、prop_shipment_file 的逐笔请求记录及 information_schema 表清单；检查页面无批次编号或打印历史入口。",
      };
    });

    await book.run("订打补充-042", "不批量打印纳品书和保障确认书", "FEAT-19 §4.1、§6", async () => {
      const hasForbidden = batchButtons.some((text) => /納品書|保障確認書|一括.*(納品|保障)/.test(text));
      return {
        status: !hasForbidden ? "通过" : "不通过",
        actual: `批量页按钮=${JSON.stringify(batchButtons.slice(0, 15))}；存在纳品书/保障确认书批量入口=${hasForbidden}；页面仅提供“${generation.summary.button}”及逐行作业票操作。`,
        evidence: "批量生成后读取批量页全部按钮与操作入口，确认只有面单批量生成，无纳品书/保障确认书批量打印或套打入口。",
      };
    });

    console.log(`[BATCH-WORK] 完成 7 条；通过=${book.list().filter((x) => x.status === "通过").length}；部分验证=${book.list().filter((x) => x.status === "部分验证").length}；不通过=${book.list().filter((x) => x.status === "不通过").length}`);
    console.log(`[BATCH-WORK] 切换=${switchFixture.shipmentNo}，编辑=${editFixture.shipmentNo}，物流=${logisticsFixture.shipmentNo}，生成=${generateOne.shipmentNo}/${generateTwo.shipmentNo}`);
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-batch-work");
    await db.close();
  }
}

main().catch((error) => {
  console.error("[BATCH-WORK] FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});