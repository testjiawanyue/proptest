/** 订单批量打印补充：批量生成版本、张数与成功提示（3 条）。 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, runTag,
} from "./order-runtime-utils.js";
import {
  createBatchFixture, openBatchPage, selectBatchRow, setBatchCopies, chooseBatchCarrier,
  batchSummary, generateBatch,
} from "./order-batch-utils.js";
import { ensureOrderFixtures } from "./order-runtime-utils.js";
import { getShipment } from "./order-shipment-utils.js";

const book = new ResultBook("reports/order-runtime-results-batch-generate.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-BG-${tag}`;
let browser: any;
let session: any;

async function waybillVersions(ids: number[]): Promise<any[]> {
  return db.query<any>(
    `SELECT shipment_id shipmentId,version,file_type fileType
     FROM prop_shipment_file WHERE file_type='waybill' AND shipment_id IN (${ids.map(() => "?").join(",")})
     ORDER BY shipment_id,version`,
    ids,
  );
}

async function closeDocumentModal(page: any): Promise<void> {
  const modal = page.locator(".ant-modal:visible").filter({ hasText: "発送書類の生成" }).last();
  await modal.getByRole("button", { name: "閉じる" }).click();
  await modal.waitFor({ state: "hidden", timeout: 15000 });
  await page.waitForTimeout(700);
}

async function clearBatchSelection(page: any): Promise<void> {
  let checked = page.locator("tr.ant-table-row input[type=checkbox]:checked");
  while (await checked.count()) {
    await checked.first().uncheck();
    await page.waitForTimeout(120);
    checked = page.locator("tr.ant-table-row input[type=checkbox]:checked");
  }
  await page.waitForTimeout(300);
}

async function main(): Promise<void> {
  await db.connect();
  const token = await apiLogin("admin", "admin123");
  const customers = await ensureOrderFixtures(db);
  const versionOne = await createBatchFixture(db, token, customers.a, {
    prefix, label: "V1A", productCount: 1, carrier: "yamato",
  });
  const versionTwo = await createBatchFixture(db, token, customers.b, {
    prefix, label: "V1B", productCount: 1, carrier: "yamato",
  });
  const copiesTwo = await createBatchFixture(db, token, customers.a, {
    prefix, label: "COPY2", productCount: 1, carrier: "yamato",
  });
  const copiesOne = await createBatchFixture(db, token, customers.b, {
    prefix, label: "COPY1", productCount: 1, carrier: "yamato",
  });
  const sagawaTwo = await createBatchFixture(db, token, customers.a, {
    prefix, label: "SGW2", productCount: 1, carrier: "sagawa",
  });
  const sagawaOne = await createBatchFixture(db, token, customers.b, {
    prefix, label: "SGW1", productCount: 1, carrier: "sagawa",
  });

  const launcher = await launchAdminSession("verify-order-batch-generate");
  browser = launcher.browser;
  session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(20000);

  try {
    await openBatchPage(page);
    await clearBatchSelection(page);

    const beforeOne = await waybillVersions([versionOne.shipmentId, versionTwo.shipmentId]);
    await selectBatchRow(page, versionOne, 1);
    await selectBatchRow(page, versionTwo, 1);
    const generationOne = await generateBatch(page, token, `reports/batchprint/order-waybills-gen31-${tag}.xlsx`);
    const alertOne = generationOne.modalText;
    await closeDocumentModal(page);
    const afterOne = await waybillVersions([versionOne.shipmentId, versionTwo.shipmentId]);
    const shipmentOne = await getShipment(token, versionOne.shipmentId);
    const shipmentTwo = await getShipment(token, versionTwo.shipmentId);
    const relationsOne = await db.query<{ c: number }>(
      `SELECT COUNT(*) c FROM prop_product_order_relation
       WHERE shipment_id IN (?,?)`,
      [versionOne.shipmentId, versionTwo.shipmentId],
    );

    await clearBatchSelection(page);
    await selectBatchRow(page, copiesTwo, 2);
    await selectBatchRow(page, copiesOne, 1);
    const copiesSummary = await batchSummary(page);
    const generationTwo = await generateBatch(page, token, `reports/batchprint/order-waybills-gen32-${tag}.xlsx`);
    await closeDocumentModal(page);
    const spoolPath = resolve(`reports/batchprint/order-waybills-gen32-${tag}.prn`);
    const printRun = spawnSync("pwsh", [
      "-NoProfile", "-File", "scripts/order/print-batch-workbook.ps1",
      "-Workbook", resolve(generationTwo.workbookPath), "-Pdf", spoolPath,
    ], { encoding: "utf8", timeout: 120000 });
    if (printRun.status !== 0) throw new Error(`整册打印提交失败：${printRun.stderr || printRun.stdout}`);
    const printResult = JSON.parse(printRun.stdout.trim());

    const printerInfo = await db.query<{ c: number }>("SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id IN (?,?) AND file_type='waybill'", [copiesTwo.shipmentId, copiesOne.shipmentId]);

    await clearBatchSelection(page);
    await chooseBatchCarrier(page, "佐川急便");
    await selectBatchRow(page, sagawaTwo, 2);
    await selectBatchRow(page, sagawaOne, 1);
    const sagawaSummary = await batchSummary(page);
    const generationThree = await generateBatch(page, token, `reports/batchprint/order-waybills-gen36-${tag}.xlsx`);
    const sagawaAlert = generationThree.modalText;
    await closeDocumentModal(page);
    const sagawaFiles = await waybillVersions([sagawaTwo.shipmentId, sagawaOne.shipmentId]);
    const sagawaApi = await getShipment(token, sagawaTwo.shipmentId);

    await book.run("订打补充-031", "多笔寄送批量打印逐笔生成面单", "FEAT-19 §4.5、§4.7", async () => {
      const deltas = [versionOne, versionTwo].map((fixture) => {
        const before = beforeOne.filter((row) => Number(row.shipmentId) === fixture.shipmentId).length;
        const after = afterOne.filter((row) => Number(row.shipmentId) === fixture.shipmentId).length;
        return { shipmentId: fixture.shipmentId, before, after, delta: after - before, versions: afterOne.filter((row) => Number(row.shipmentId) === fixture.shipmentId) };
      });
      const passed = deltas.every((row) => row.delta === 1 && row.versions.length === 1 && Number(row.versions[0].version) === 1)
        && shipmentOne.status === "preparing" && shipmentTwo.status === "preparing" && relationsOne[0].c === 0;
      return {
        status: passed ? "通过" : "不通过",
        actual: `两笔批量生成响应 code=${generationOne.createBody.code}、文件=${JSON.stringify((generationOne.createBody.data?.files || []).map((x: any) => ({ shipmentId: x.shipmentId, version: x.version })))}；逐笔 waybill 记录=${JSON.stringify(deltas)}；生成后状态=${shipmentOne.status}/${shipmentTwo.status}，订单产品关系数=${relationsOne[0].c}；工作簿工作表=${JSON.stringify(generationOne.sheetTitles)}。`,
        evidence: "UI 勾选两笔各 1 张生成，捕获 batch-labels 响应与工作簿；DB 对比生成前后每笔 waybill 版本各增加 1，API 核对仍 preparing 且无订单关系。",
      };
    });

    await book.run("订打补充-032", "不同张数批量打印总数量正确", "FEAT-19 VAL-18", async () => {
      const generationOk = /（3 枚）/.test(copiesSummary.button)
        && generationTwo.sheetTitles.length === 3 && generationTwo.copies.join(",") === "2,1";
      return {
        status: generationOk ? "部分验证" : "不通过",
        actual: `勾选张数 2+1 时按钮=“${copiesSummary.button}”，汇总=“${copiesSummary.text}”；工作簿工作表=${JSON.stringify(generationTwo.sheetTitles)}，弹窗内份数=${JSON.stringify(generationTwo.copies)}；桌面 Excel 一次 PrintOut 提交 3 个工作表，生成 ${printResult.outputBytes} 字节 PCL 打印 spool（非 PDF），活动打印机=${printResult.activePrinter}。实体打印机连续出纸与队列完成未取得，故“实际连续输出”仍标为部分验证。`,
        evidence: "UI 设置两笔为 2 张、1 张并一次生成；openpyxl 核对 3 个工作表；Excel COM 对整册执行一次 PrintOut 提交并生成打印 spool；工作表份数与编排由 openpyxl 核对，物理出纸不可证实。",
      };
    });

    await book.run("订打补充-036", "批量打印成功提示", "FEAT-19 §4.5", async () => {
      const expected = "佐川急便の送り状を3枚生成した（発送は確定されない）";
      const passed = sagawaAlert.includes(expected) && sagawaSummary.button.includes("3 枚")
        && generationThree.sheetTitles.length === 3 && sagawaFiles.length === 2 && sagawaApi.carrier === "sagawa";
      return {
        status: passed ? "通过" : "不通过",
        actual: `勾选 2+1 张并选择佐川急便，按钮=“${sagawaSummary.button}”，汇总=“${sagawaSummary.text}”；生成后弹窗提示=“${sagawaAlert}”；工作簿工作表=${JSON.stringify(generationThree.sheetTitles)}；两笔 waybill 版本=${JSON.stringify(sagawaFiles.map((x) => ({ shipmentId: x.shipmentId, version: x.version })))}，寄送承运商=${sagawaApi.carrier}。`,
        evidence: "UI 以佐川急便生成两笔共 3 张，读取保存后的成功提示、汇总、工作簿工作表、逐笔文件版本及寄送承运商。",
      };
    });

    console.log(`[BATCH-GEN] 完成 3 条；通过=${book.list().filter((x) => x.status === "通过").length}；部分验证=${book.list().filter((x) => x.status === "部分验证").length}；不通过=${book.list().filter((x) => x.status === "不通过").length}`);
    console.log(`[BATCH-GEN] v1=${versionOne.shipmentNo}/${versionTwo.shipmentNo}，copies=${copiesTwo.shipmentNo}/${copiesOne.shipmentNo}，sagawa=${sagawaTwo.shipmentNo}/${sagawaOne.shipmentNo}`);
    console.log(`[BATCH-GEN] spool=${spoolPath} bytes=${printResult.outputBytes} printer=${printResult.activePrinter}`);
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-batch-generate");
    await db.close();
  }
}

main().catch((error) => {
  console.error("[BATCH-GEN] FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
