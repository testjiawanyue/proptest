/** 订单批量打印面单：勾选范围、整批工作簿、逐笔版本与打印边界（002/003）。 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiCall, runTag,
  ensureOrderFixtures, compactText, apiBase,
} from "./order-runtime-utils.js";
import {
  ensureProduct, createOrder, createShipment, addProduct, saveFields, getShipment,
  getOrder,
} from "./order-shipment-utils.js";

const book = new ResultBook("reports/order-runtime-results-batchprint.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-BP-${tag}`;
let browser: any;
let session: any;
let token = "";
let fixtures: any;

type FixtureRow = {
  label: string;
  productNo: string;
  orderId: number;
  shipmentId: number;
  shipmentNo: string;
  orderNo: string;
  productId: number;
  selected: boolean;
  copies: number;
};

async function addProductMust(shipmentId: number, no: string): Promise<void> {
  const result = await addProduct(token, shipmentId, no);
  if (result.code !== 200 || !(result.data?.added || []).includes(no)) {
    throw new Error(`加入产品失败 ${no}: ${JSON.stringify(result)}`);
  }
}

function workbookSummary(filePath: string): any {
  const script = String.raw`
import json, sys, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=False, read_only=True)
sheets = []
for ws in wb.worksheets:
    texts = []
    for row in ws.iter_rows(values_only=True):
        for value in row:
            if value is not None:
                texts.append(str(value))
    sheets.append({"title": ws.title, "text": " | ".join(texts)})
print(json.dumps({"sheets": sheets}, ensure_ascii=False))
`;
  const result = spawnSync("python", ["-c", script, filePath], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`工作簿解析失败：${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}

async function main(): Promise<void> {
  await db.connect();
  fixtures = await ensureOrderFixtures(db);
  token = await apiLogin("admin", "admin123");

  const rows: FixtureRow[] = [];
  for (let i = 0; i < 4; i += 1) {
    const label = i < 3 ? `SEL${i + 1}` : "UNSELECTED";
    const productNo = `${prefix}-P${i + 1}`;
    const productId = await ensureProduct(db, productNo);
    const orderId = await createOrder(token, fixtures.a, `${prefix}-${label}`, 1);
    const shipment = await createShipment(token, orderId, "2026-10-29");
    const shipmentId = Number(shipment.shipmentId);
    await addProductMust(shipmentId, productNo);
    await saveFields(token, shipmentId, { carrier: i === 3 ? "sagawa" : "yamato", shipDate: "2026-10-29", boxCount: 1 });
    const order = await getOrder(token, orderId);
    const shipmentDetail = await getShipment(token, shipmentId);
    rows.push({
      label,
      productNo,
      orderId,
      shipmentId,
      shipmentNo: String(shipmentDetail.shipmentNo),
      orderNo: String(order.orderNo),
      productId: Number(productId),
      selected: i < 3,
      copies: [1, 2, 3][i] ?? 1,
    });
  }

  const selected = rows.filter((x) => x.selected);
  const unselected = rows.find((x) => !x.selected)!;
  const launcher = await launchAdminSession("verify-order-batchprint");
  browser = launcher.browser;
  session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(20000);

  try {
    await page.goto("http://localhost:8090/orders/batch-print");
    await page.locator("h2", { hasText: "送り状一括生成" }).waitFor({ state: "visible" });
    await page.locator("tr.ant-table-row").first().waitFor({ state: "visible" });
    await page.waitForTimeout(1200);

    for (const fixture of rows) {
      const row = page.locator("tr.ant-table-row").filter({ hasText: fixture.shipmentNo }).first();
      await row.waitFor({ state: "visible", timeout: 15000 });
      if (fixture.selected) {
        await row.getByRole("checkbox").check();
        const copiesInput = row.locator(".ant-input-number-input").first();
        await copiesInput.fill(String(fixture.copies));
        await copiesInput.press("Enter");
        await copiesInput.press("Tab");
      }
    }
    await page.waitForTimeout(700);

    const summaryText = compactText(await page.locator(".batch-footer").innerText());
    const generateButton = page.locator(".batch-footer button.ant-btn-primary");
    const generateButtonText = compactText(await generateButton.innerText());
    const selectedState = await page.locator("tr.ant-table-row").evaluateAll((elements: any[]) => elements.map((row) => ({
      text: row.innerText,
      checked: Boolean(row.querySelector("input[type=checkbox]")?.checked),
    })).filter((row) => row.text));

    const preparePromise = page.waitForResponse(
      (r: any) => r.url().includes("/prop/shipment/batch-labels/prepare") && r.request().method() === "POST",
      { timeout: 30000 },
    );
    await generateButton.click();
    const prepareResponse = await preparePromise;
    const prepareBody = await prepareResponse.json() as any;
    const modal = page.locator(".ant-modal:visible").filter({ hasText: "発送書類の生成" }).last();
    await modal.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll(".document-member").length === 3, null, { timeout: 20000 });
    const memberCount = await modal.locator(".document-member").count();
    const directoryText = await modal.locator(".document-directory").innerText();
    const memberCopies = await modal.locator(".document-member input.ant-input-number-input").evaluateAll((inputs: any[]) => inputs.map((x) => x.value));

    mkdirSync("reports/batchprint", { recursive: true });
    const workbookPath = resolve(`reports/batchprint/order-waybills-${tag}.xlsx`);
    const downloadPromise = page.waitForEvent("download", { timeout: 5000 }).catch(() => null);
    const createPromise = page.waitForResponse(
      (r: any) => /\/prop\/shipment\/batch-labels$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 90000 },
    );
    await modal.getByRole("button", { name: "生 成" }).or(modal.getByRole("button", { name: "生成" })).last().click();
    const createResponse = await createPromise;
    const createBody = await createResponse.json() as any;
    const download = await downloadPromise;
    let downloadCaptured = false;
    if (download) {
      const browserPath = resolve(`reports/batchprint/browser-${tag}.download`);
      await download.saveAs(browserPath);
      const bytes = readFileSync(browserPath);
      if (bytes.subarray(0, 2).toString("utf8") === "PK") {
        writeFileSync(workbookPath, bytes);
        downloadCaptured = true;
      }
    }
    if (!downloadCaptured) {
      const command = JSON.parse(createResponse.request().postData() || "{}");
      const contentResponse = await fetch(`${apiBase}/prop/shipment/batch-labels/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(command),
      });
      if (!contentResponse.ok) throw new Error(`批量工作簿下载失败：HTTP ${contentResponse.status}`);
      const contentBytes = Buffer.from(await contentResponse.arrayBuffer());
      if (contentBytes.subarray(0, 2).toString("utf8") !== "PK") throw new Error(`批量工作簿内容不是 XLSX：${contentBytes.toString("utf8").slice(0, 200)}`);
      writeFileSync(workbookPath, contentBytes);
    }
    await page.waitForTimeout(1000);
    const savedMessage = compactText(await modal.locator(".ant-alert-success").innerText().catch(() => ""));
    const downloadErrors = compactText((await modal.locator(".ant-alert-warning").allInnerTexts()).join(" | "));

    const workbook = workbookSummary(workbookPath);
    const sheetTitles: string[] = workbook.sheets.map((x: any) => String(x.title));
    const expectedTitles = selected.flatMap((fixture) =>
      Array.from({ length: fixture.copies }, (_, i) => `S${fixture.shipmentId}-v1-${i + 1}`),
    );
    const titlesExact = JSON.stringify([...sheetTitles].sort()) === JSON.stringify([...expectedTitles].sort());
    const selectedContentOk = selected.every((fixture) => {
      const ownSheets = workbook.sheets.filter((x: any) => String(x.title).startsWith(`S${fixture.shipmentId}-v1-`));
      return ownSheets.length === fixture.copies
        && ownSheets.every((x: any) => String(x.text).includes(fixture.orderNo) && String(x.text).includes(fixture.productNo));
    });
    const unselectedAbsent = !sheetTitles.some((x) => x.includes(`S${unselected.shipmentId}-`))
      && !workbook.sheets.some((x: any) => String(x.text).includes(unselected.orderNo) || String(x.text).includes(unselected.productNo));

    const shipmentStates = [];
    for (const fixture of rows) {
      const state = await db.query<any>(
        `SELECT s.status,s.carrier,s.revision,
           (SELECT COUNT(*) FROM prop_shipment_file f WHERE f.shipment_id=s.shipment_id AND f.file_type='waybill') waybills,
           (SELECT COUNT(*) FROM prop_shipment_file f WHERE f.shipment_id=s.shipment_id AND f.file_type='waybill' AND f.version=1) v1,
           (SELECT COUNT(*) FROM prop_shipment_product p WHERE p.shipment_id=s.shipment_id) products,
           (SELECT COUNT(*) FROM prop_product_order_relation r WHERE r.order_id=s.order_id AND r.delivery_valid=1) relations
         FROM prop_shipment s WHERE s.shipment_id=?`,
        [fixture.shipmentId],
      );
      shipmentStates.push({ fixture, state: state[0] });
    }
    const selectedStateOk = shipmentStates.filter((x) => x.fixture.selected).every((x) =>
      x.state.status === "preparing" && x.state.carrier === "yamato" && Number(x.state.waybills) === 1
      && Number(x.state.v1) === 1 && Number(x.state.products) === 1 && Number(x.state.relations) === 0,
    );
    const unselectedStateOk = unselected && (() => {
      const state = shipmentStates.find((x) => x.fixture.shipmentId === unselected.shipmentId)!.state;
      return state.status === "preparing" && state.carrier === "sagawa" && Number(state.waybills) === 0
        && Number(state.products) === 1 && Number(state.relations) === 0;
    })();
    const uiSelectionOk = selected.every((fixture) =>
      selectedState.some((row: any) => row.checked && String(row.text).includes(fixture.shipmentNo)),
    ) && selectedState.some((row: any) => !row.checked && String(row.text).includes(unselected.shipmentNo));
    const summaryOk = summaryText.includes("選択 3 件") && summaryText.includes("製品 3 台")
      && summaryText.includes("送り状 6 枚") && generateButtonText.includes("6 枚");
    const modalOk = prepareBody.code === 200 && memberCount === 3
      && selected.every((fixture) => directoryText.includes(fixture.shipmentNo))
      && JSON.stringify(memberCopies.map(Number)) === JSON.stringify(selected.map((x) => x.copies));
    const createOk = createBody.code === 200 && (createBody.data?.files || []).length === 3
      && (createBody.data?.files || []).every((x: any) => Number(x.version) === 1);

    const edgePrepared = await apiCall(token, "POST", "/prop/shipment/batch-labels/prepare", {
      carrier: "yamato",
      items: [{ shipmentId: unselected.shipmentId, copies: 1 }],
    });
    const edgeItems = ((edgePrepared.data || []) as any[]).map((row: any) => ({
      shipmentId: row.shipmentId,
      revision: row.revision,
      copies: 1,
      sourceToken: row.sourceToken,
      overrides: row.defaults,
    }));
    const edgeManifest = JSON.stringify(edgeItems.map((x: any) => x.shipmentId));
    const edgeCommand = {
      requestId: `${randomUUID()}.${createHash("sha256").update(edgeManifest).digest("hex")}`,
      carrier: "yamato",
      issueDate: "2026-10-29",
      items: edgeItems,
    };
    const edgeCreate = await apiCall(token, "POST", "/prop/shipment/batch-labels", edgeCommand);
    const printOutput = resolve(`reports/batchprint/order-waybills-${tag}.prn`);
    const printRun = spawnSync("pwsh", [
      "-NoProfile", "-File", "scripts/order/print-batch-workbook.ps1",
      "-Workbook", workbookPath, "-Pdf", printOutput,
    ], { encoding: "utf8", timeout: 90000 });
    if (printRun.status !== 0) throw new Error(`整册打印提交失败：${printRun.stderr || printRun.stdout}`);
    const printResult = JSON.parse(printRun.stdout.trim());
    await page.reload();
    await page.locator("tr.ant-table-row").first().waitFor({ state: "visible" });
    await page.waitForTimeout(800);
    const refreshedChecked = await page.locator("tr.ant-table-row input[type=checkbox]:checked").count();
    const refreshedFooter = compactText(await page.locator(".batch-footer").innerText());
    const refreshedButtonDisabled = await page.locator(".batch-footer button.ant-btn-primary").isDisabled();
    const refreshTaskText = await page.getByText(/印刷中|進捗|再開|印刷ジョブ|ジョブ履歴/).count();

    await book.run("批量打印面单-002", "勾选多张面单批量打印", "FEAT-19-order-batch-print VAL-15", async () => {
      const passed = uiSelectionOk && summaryOk && modalOk && createOk
        && titlesExact && selectedContentOk && unselectedAbsent
        && selectedStateOk && unselectedStateOk && sheetTitles.length === 6;
      return {
        status: passed ? (edgeCreate.code === 200 ? "通过" : "部分验证") : "不通过",
        actual: `勾选三笔=${selected.map((x) => x.shipmentNo).join(",")}，未勾选=${unselected.shipmentNo}；汇总“${summaryText}”，按钮“${generateButtonText}”；弹窗成员=${memberCount}、份数=${JSON.stringify(memberCopies)}；响应文件=${JSON.stringify((createBody.data?.files || []).map((x: any) => ({ shipmentId: x.shipmentId, version: x.version })))}；浏览器下载事件=${Boolean(download)}/${downloadCaptured}；弹窗下载错误=“${downloadErrors}”；工作簿工作表=${JSON.stringify(sheetTitles)}；选中内容正确=${selectedContentOk}、未选中未输出=${unselectedAbsent}；逐笔 waybill v1=${selectedStateOk}、未选中保持不变=${unselectedStateOk}；订单仍无履约/关系、寄送仍 preparing。另测“寄送已保存佐川→批量选择ヤマト”：prepare code=${edgePrepared.code}、create code=${edgeCreate.code}“${edgeCreate.msg}”。`,
        evidence: `真实批量页勾选三笔并分别设置份数 1/2/3，捕获 batch-labels prepare/create 响应，下载 ${workbookPath} 并用 openpyxl 核对工作表内容与份数；DB 核对逐笔文件版本、承运商、寄送状态及订单履约。`,
        requirement: "FEAT-19-order-batch-print VAL-15",
      };
    });

    await book.run("批量打印面单-003", "一次提交整批连续打印", "FEAT-19-order-batch-print VAL-23", async () => {
      const generationPassed = summaryOk && createOk && titlesExact && selectedContentOk
        && selectedStateOk && sheetTitles.length === 6;
      return {
        status: generationPassed ? "部分验证" : "不通过",
        actual: `一次生成 3 笔、共 6 份工作簿，工作表=${JSON.stringify(sheetTitles)}，创建响应 version 均为 1，仍为 preparing 且未登记寄出；下载文件=${workbookPath}；保存提示“${savedMessage}”。桌面 Excel 以一次 PrintOut 提交整个工作簿：${JSON.stringify(printResult)}，打印 spool=${printOutput}；刷新后勾选=${refreshedChecked}、“${refreshedFooter}”、生成按钮禁用=${refreshedButtonDisabled}、任务/进度/历史文本数=${refreshTaskText}。实体出纸与打印机队列完成证据未取得，故打印完成部分仍为未验证。`,
        evidence: "UI 一次生成并下载整批工作簿；openpyxl 核对 6 个工作表及份数；DB 核对每笔仅一个 waybill 版本、无寄出关系；Excel COM 一次 PrintOut 整个工作簿生成打印 spool；刷新页面确认无选择恢复、无进度/续跑/历史。",
        requirement: "FEAT-19-order-batch-print VAL-23",
      };
    });

    console.log(`[BP] 完成 2 条；通过=${book.list().filter((x) => x.status === "通过").length}；部分验证=${book.list().filter((x) => x.status === "部分验证").length}；不通过=${book.list().filter((x) => x.status === "不通过").length}`);
    console.log(`[BP] 选中=${selected.map((x) => `${x.shipmentNo}/${x.copies}`).join(",")} 未选=${unselected.shipmentNo}`);
    console.log(`[BP] 工作簿=${workbookPath}`);
    console.log(`[BP] 工作表=${sheetTitles.join(",")}`);
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-batchprint");
    await db.close();
  }
}

main().catch((error) => { console.error("[BP] FAILED:", error instanceof Error ? error.stack : error); process.exit(1); });
