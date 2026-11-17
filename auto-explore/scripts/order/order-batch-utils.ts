/** 订单批量打印页夹具、选择与整批生成助手。 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { Page } from "playwright";
import type { DbClient } from "../customer/customer-runtime-utils.js";
import type { CustomerFixture } from "./order-runtime-utils.js";
import { PRODUCT_NAME, apiBase, compactText } from "./order-runtime-utils.js";
import {
  ensureProduct, createOrder, createShipment, addProduct, saveFields, getOrder, getShipment,
} from "./order-shipment-utils.js";

export type BatchFixture = {
  label: string;
  productNos: string[];
  productIds: number[];
  orderId: number;
  shipmentId: number;
  orderNo: string;
  shipmentNo: string;
  carrier: string;
};

export async function createBatchFixture(
  db: DbClient,
  token: string,
  customer: CustomerFixture,
  input: { prefix: string; label: string; productCount: number; carrier?: string },
): Promise<BatchFixture> {
  const productNos: string[] = [];
  const productIds: number[] = [];
  for (let i = 1; i <= input.productCount; i += 1) {
    const no = `${input.prefix}-${input.label}-P${i}`;
    productNos.push(no);
    productIds.push(await ensureProduct(db, no));
  }
  const orderId = await createOrder(token, customer, `${input.prefix}-${input.label}`, input.productCount);
  const shipment = await createShipment(token, orderId, "2026-10-29");
  const shipmentId = Number(shipment.shipmentId);
  for (const no of productNos) {
    const result = await addProduct(token, shipmentId, no);
    if (result.code !== 200 || !(result.data?.added || []).includes(no)) {
      throw new Error(`批量夹具加入产品失败 ${no}: ${JSON.stringify(result)}`);
    }
  }
  const carrier = input.carrier ?? "yamato";
  const saved = await saveFields(token, shipmentId, { carrier, shipDate: "2026-10-29", boxCount: 1 });
  if (saved.code !== 200) throw new Error(`批量夹具保存承运商失败：${saved.msg}`);
  const order = await getOrder(token, orderId);
  const detail = await getShipment(token, shipmentId);
  return {
    label: input.label,
    productNos,
    productIds,
    orderId,
    shipmentId,
    orderNo: String(order.orderNo),
    shipmentNo: String(detail.shipmentNo),
    carrier,
  };
}

export async function openBatchPage(page: Page): Promise<void> {
  await page.goto("http://localhost:8090/orders/batch-print");
  await page.locator("h2", { hasText: "送り状一括生成" }).waitFor({ state: "visible", timeout: 15000 });
  await page.locator("tr.ant-table-row").first().waitFor({ state: "visible", timeout: 15000 });
  await page.waitForTimeout(900);
}

export function batchRow(page: Page, fixture: BatchFixture): any {
  return page.locator("tr.ant-table-row").filter({ hasText: fixture.shipmentNo }).first();
}

export async function setBatchCopies(page: Page, fixture: BatchFixture, copies: number | null): Promise<void> {
  const input = batchRow(page, fixture).locator(".ant-input-number-input").first();
  await input.fill(copies === null ? "" : String(copies));
  await input.press("Tab");
  await page.waitForTimeout(250);
}

export async function selectBatchRow(page: Page, fixture: BatchFixture, copies = 1): Promise<void> {
  const row = batchRow(page, fixture);
  await row.waitFor({ state: "visible", timeout: 15000 });
  const checkbox = row.getByRole("checkbox");
  if (!(await checkbox.isChecked())) await checkbox.check();
  await setBatchCopies(page, fixture, copies);
}

export async function unselectBatchRow(page: Page, fixture: BatchFixture): Promise<void> {
  const checkbox = batchRow(page, fixture).getByRole("checkbox");
  if (await checkbox.isChecked()) await checkbox.uncheck();
  await page.waitForTimeout(250);
}

export async function chooseBatchCarrier(page: Page, label: string): Promise<void> {
  await page.locator(".carrier-select").click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ hasText: label }).first().click();
  await page.waitForTimeout(400);
}

export async function batchSummary(page: Page): Promise<{ text: string; button: string; disabled: boolean }> {
  const footer = page.locator(".batch-footer");
  const button = footer.locator("button.ant-btn-primary");
  return {
    text: compactText(await footer.innerText()),
    button: compactText(await button.innerText()),
    disabled: await button.isDisabled(),
  };
}

export function workbookSummary(filePath: string): any {
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

export async function generateBatch(page: Page, token: string, outputPath: string): Promise<any> {
  const summary = await batchSummary(page);
  const preparePromise = page.waitForResponse(
    (r: any) => r.url().includes("/prop/shipment/batch-labels/prepare") && r.request().method() === "POST",
    { timeout: 30000 },
  );
  await page.locator(".batch-footer button.ant-btn-primary").click();
  const prepareResponse = await preparePromise;
  const prepareBody = await prepareResponse.json() as any;
  const modal = page.locator(".ant-modal:visible").filter({ hasText: "発送書類の生成" }).last();
  await modal.waitFor({ state: "visible", timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll(".document-member").length > 0, null, { timeout: 20000 });
  await page.waitForTimeout(500);
  const memberCount = await modal.locator(".document-member").count();
  const copies = await modal.locator(".document-member input.ant-input-number-input").evaluateAll((inputs: any[]) => inputs.map((x) => x.value));
  const createPromise = page.waitForResponse(
    (r: any) => /\/prop\/shipment\/batch-labels$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    { timeout: 60000 },
  );
  await modal.getByRole("button", { name: "生 成" }).or(modal.getByRole("button", { name: "生成" })).last().click();
  const createResponse = await createPromise;
  const createBody = await createResponse.json() as any;
  if (createBody.code !== 200) throw new Error(`批量生成失败 code=${createBody.code}：${createBody.msg}`);
  const command = JSON.parse(createResponse.request().postData() || "{}");
  const contentResponse = await fetch(`${apiBase}/prop/shipment/batch-labels/content`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(command),
  });
  if (!contentResponse.ok) throw new Error(`批量内容下载失败：HTTP ${contentResponse.status}`);
  const bytes = Buffer.from(await contentResponse.arrayBuffer());
  if (bytes.subarray(0, 2).toString("utf8") !== "PK") throw new Error(`批量内容不是 XLSX：${bytes.toString("utf8").slice(0, 200)}`);
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, bytes);
  await page.waitForTimeout(800);
  const modalText = compactText(await modal.innerText());
  const workbook = workbookSummary(outputPath);
  return {
    summary,
    prepareBody,
    createBody,
    memberCount,
    copies,
    modalText,
    workbookPath: outputPath,
    sheetTitles: workbook.sheets.map((x: any) => String(x.title)),
    sheets: workbook.sheets,
  };
}
