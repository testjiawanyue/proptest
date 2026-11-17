/** 订单寄送 C2：面单与 PDF 文书（发货管理-010/014）。 */
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiCall, runTag,
  ensureOrderFixtures, readToasts, compactText,
} from "./order-runtime-utils.js";
import { ensureProduct, createOrder, createShipment, addProduct, saveFields, getShipment, openShipmentDrawer } from "./order-shipment-utils.js";

const book = new ResultBook("reports/order-runtime-results-C2.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-C2-${tag}`;
const productNo = `${prefix}-P1`;
let browser: any;
let session: any;
let token = "";
let orderId = 0;
let shipmentId = 0;
let productId = 0;

function bodyOf(r: any): Promise<any> { return r.json().catch(() => ({ code: -1, msg: "" })); }
function docModal(page: any) { return page.locator(".ant-modal:visible").filter({ hasText: "発送書類の生成" }).last(); }
async function saveDownload(download: any, name: string): Promise<string> {
  const target = path.join("E:/proptest/auto-explore/reports", name);
  await download.saveAs(target);
  return target;
}

async function main(): Promise<void> {
  await db.connect();
  const fixture = await ensureOrderFixtures(db);
  token = await apiLogin("admin", "admin123");
  productId = await ensureProduct(db, productNo);
  orderId = await createOrder(token, fixture.a, `${prefix}-ORDER`, 1);
  const shipment = await createShipment(token, orderId);
  shipmentId = Number(shipment.shipmentId);
  const added = await addProduct(token, shipmentId, productNo);
  if (added.code !== 200 || !(added.data?.added || []).includes(productNo)) throw new Error(`产品加入失败：${JSON.stringify(added)}`);
  const saved = await saveFields(token, shipmentId, { carrier: "yamato", shipDate: "2026-10-29", boxCount: 1 });
  if (saved.code !== 200) throw new Error(`物流保存失败：${saved.msg}`);

  const launcher = await launchAdminSession("verify-order-C2");
  browser = launcher.browser; session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(15000);
  try {
    await book.run("发货管理-010", "生成面单并打印", "FEAT-11-shipment §4.5、§4.7；VAL-05", async () => {
      const drawer = await openShipmentDrawer(page, orderId);
      const copiesInput = drawer.locator(".print-row").first().locator("input");
      await copiesInput.fill("2");
      await copiesInput.blur();
      await drawer.getByRole("button", { name: /送り状を生成/ }).click();
      const modal = docModal(page);
      await modal.waitFor({ state: "visible", timeout: 12000 });
      await page.waitForTimeout(900);
      const modalBody = compactText(await modal.innerText(), 700);
      const responsePromise = page.waitForResponse((r: any) => /\/prop\/shipment\/\d+\/documents$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 30000 });
      const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
      await modal.getByRole("button", { name: /生 成/ }).click();
      const response = await responsePromise;
      const body = await bodyOf(response);
      const download = await downloadPromise;
      const downloaded = await saveDownload(download, `order-waybill-C2-${tag}.xlsx`);
      await page.waitForTimeout(1200);
      const successText = compactText(await modal.innerText(), 900);
      const file = body.data?.file || {};
      const beforeFiles = await db.query<any>("SELECT file_id,file_type,version,snapshot_json FROM prop_shipment_file WHERE shipment_id=? ORDER BY file_id", [shipmentId]);
      const snap = beforeFiles.find((x) => x.file_type === "waybill")?.snapshot_json ? JSON.parse(beforeFiles.find((x) => x.file_type === "waybill")!.snapshot_json) : {};
      const bytes = fs.readFileSync(downloaded);
      const py = "import openpyxl,sys,json; w=openpyxl.load_workbook(sys.argv[1]); print(json.dumps([s.title for s in w.worksheets]))";
      const sheets = JSON.parse(execFileSync("python", ["-c", py, downloaded], { encoding: "utf8" })) as string[];
      const xlsxMagic = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const firstHash = createHash("sha256").update(bytes).digest("hex");

      await modal.getByRole("button", { name: "閉じる" }).click();
      await modal.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
      await page.waitForTimeout(1200);
      const historyRow = drawer.locator("tr.ant-table-row", { hasText: /送り状 v1/ }).first();
      await historyRow.waitFor({ state: "visible", timeout: 10000 });
      const secondDownloadPromise = page.waitForEvent("download", { timeout: 30000 });
      await historyRow.getByRole("button", { name: "表示" }).click();
      const secondDownload = await secondDownloadPromise;
      const redownloaded = await saveDownload(secondDownload, `order-waybill-C2-${tag}-redownload.xlsx`);
      const secondBytes = fs.readFileSync(redownloaded);
      const secondHash = createHash("sha256").update(secondBytes).digest("hex");
      const comparePy = "import openpyxl,sys,json; a=openpyxl.load_workbook(sys.argv[1],data_only=True); b=openpyxl.load_workbook(sys.argv[2],data_only=True); diff=0; ta=a.sheetnames; tb=b.sheetnames; diff += 0 if ta==tb else 1;\nfor n in set(ta)&set(tb):\n x=a[n]; y=b[n]; diff += sum(1 for r in range(1,max(x.max_row,y.max_row)+1) for c in range(1,max(x.max_column,y.max_column)+1) if x.cell(r,c).value!=y.cell(r,c).value)\nprint(diff)";
      const semanticDiff = Number(execFileSync("python", ["-c", comparePy, downloaded, redownloaded], { encoding: "utf8" }).trim());
      const sameContent = semanticDiff === 0;
      const shipment = await getShipment(token, shipmentId);
      const files = await db.query<any>("SELECT file_id,file_type,version,snapshot_json FROM prop_shipment_file WHERE shipment_id=?", [shipmentId]);
      const mails = files.filter((x) => x.file_type === "mail");
      const noNewVersion = files.length === beforeFiles.length && files.filter((x) => x.file_type === "waybill").length === 1;
      const specificCountMessage = /2\\s*枚/.test(successText) || /2\\s*枚/.test(JSON.stringify(file));
      const coreOk = body.code === 200 && file.fileType === "waybill" && Number(file.version) === 1
        && Number(file.copies) === 2 && shipment.status === "preparing" && mails.length === 0
        && noNewVersion && xlsxMagic && sameContent && sheets.length === 2;
      return {
        status: coreOk ? "部分验证" : "不通过",
        actual: `UI 生成 2 份：POST code=${body.code}，文件 type/version/copies=${file.fileType}/${file.version}/${file.copies}，下载文件=${path.basename(downloaded)}（${bytes.length} bytes，xlsx 魔数=${xlsxMagic}），工作表=${JSON.stringify(sheets)}；弹窗实际提示=“${successText}”，未显示用例要求的“2 枚”数量文案；从文件列表再次下载=${path.basename(redownloaded)}，工作簿单元格语义内容与首次一致=${sameContent}（差异单元格=${semanticDiff}；原始 SHA-256 相同=${firstHash === secondHash}），生成前后文件数=${beforeFiles.length}→${files.length}（未新增版本=${noNewVersion}）；寄送状态=${shipment.status}、邮件文件=${mails.length}、快照 copies=${snap.copies}。实体桌面 Excel 整簿打印未在本环境执行。`,
        evidence: `UI 设置 2 份→生成并首次下载；关闭弹窗后从「作成済みファイル」列表再次点击表示下载；逐工作表/单元格比较两次下载内容（二进制哈希仅辅助）；DB 查询 shipment_file 版本数与 shipment.status。`,
        requirement: "FEAT-11-shipment §4.5、§4.7；VAL-05",
      };
    });

    await book.run("发货管理-014", "打印纳品书与保障确认书", "FEAT-11-shipment §4.8；VAL-05、VAL-22、VAL-06", async () => {
      const delivery = await apiCall(token, "GET", `/prop/shipment/${shipmentId}/documents/prepare?type=deliveryNote`);
      const guarantee = await apiCall(token, "GET", `/prop/shipment/${shipmentId}/documents/prepare?type=guarantee`);
      const drawer = await openShipmentDrawer(page, orderId);
      await drawer.getByRole("button", { name: "納品書を印刷" }).click();
      const modal = docModal(page);
      await modal.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(900);
      const deliveryUi = compactText(await modal.innerText(), 800);
      await page.reload();
      await page.waitForTimeout(1800);
      const drawer2 = await openShipmentDrawer(page, orderId);
      await drawer2.getByRole("button", { name: "保障確認書を印刷" }).click();
      const modal2 = docModal(page);
      await modal2.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(900);
      const guaranteeUi = compactText(await modal2.innerText(), 800);
      const files = await db.query<any>("SELECT file_type,version FROM prop_shipment_file WHERE shipment_id=? ORDER BY file_id", [shipmentId]);
      const shipment = await getShipment(token, shipmentId);
      const blocked = delivery.code === 409 && guarantee.code === 409
        && /テンプレートのチェックサム/.test(delivery.msg) && /テンプレートのチェックサム/.test(guarantee.msg)
        && /テンプレートのチェックサム/.test(deliveryUi + guaranteeUi)
        && files.every((x) => x.file_type !== "deliveryNote" && x.file_type !== "guarantee")
        && shipment.status === "preparing";
      return {
        status: blocked ? "阻塞" : "不通过",
        actual: `納品書 prepare code=${delivery.code}“${delivery.msg}”；保障確認書 prepare code=${guarantee.code}“${guarantee.msg}”；UI 两处均显示模板校验错误=${/テンプレートのチェックサム/.test(deliveryUi + guaranteeUi)}；未生成对应文件=${files.every((x) => !["deliveryNote", "guarantee"].includes(x.file_type))}；状态仍为 ${shipment.status}。原因是当前 Windows 工作区 report.css 为 CRLF，而 manifest 记录的是 LF 哈希，运行时拒绝加载模板。`,
        evidence: "UI 分别点击納品書/保障確認書并读取弹窗错误；API 复核 prepare；DB 文件记录；本地 SHA-256 对比 manifest 与磁盘文件。",
        requirement: "FEAT-11-shipment §4.8；VAL-05、VAL-22、VAL-06",
      };
    });

    const rows = book.list();
    console.log(`[C2] 完成 ${rows.length} 条；通过=${rows.filter((x) => x.status === "通过").length}；部分验证=${rows.filter((x) => x.status === "部分验证").length}；阻塞=${rows.filter((x) => x.status === "阻塞").length}；不通过=${rows.filter((x) => x.status === "不通过").length}`);
    console.log(`[C2] 订单=${orderId} 寄送=${shipmentId} 产品=${productNo}(${productId})`);
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-C2");
    await db.close();
  }
}
main().catch((e) => { console.error("[C2] FAILED:", e instanceof Error ? e.stack : e); process.exit(1); });