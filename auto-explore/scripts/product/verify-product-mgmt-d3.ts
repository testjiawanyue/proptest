/**
 * 产品管理 D3 批：详情-014（解除关联基准 keep/clear/取消）、详情-015（首次寄送日期更正联动）。
 * 使用产品 35 / 订单 17 / 关系 4 / 发货 27；全程备份并在 finally 恢复，删除测试期间新增产品事件。
 */
import { chromium, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, apiLogin, apiCall, finishSession, compact,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook("reports/product-mgmt-runtime-results-d3.json");
const db = new DbClient();
const REQ = "FEAT-08 产品管理（解除关联 / 日期更正）";
const BACKUP_PATH = "reports/product-mgmt-d3-backup.json";
let token = "";
let page: Page;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = async (locator: import("playwright").Locator) => compact(await locator.innerText().catch(() => ""));

const BACKUP: {
  product: Record<string, unknown> | null;
  shipment: Record<string, unknown> | null;
  relation: Record<string, unknown> | null;
  maxEventId: number;
  shipmentProductCount: number;
} = { product: null, shipment: null, relation: null, maxEventId: 0, shipmentProductCount: 0 };

async function loadBackup(): Promise<void> {
  const products = await db.query<Record<string, unknown>>(
    `SELECT DATE_FORMAT(first_shipment_date,'%Y-%m-%d %H:%i:%s') firstShipmentDate,
            lifecycle_base_month, baseline_shipment_id, external_product_name
       FROM prop_product WHERE product_id=35`);
  const shipments = await db.query<Record<string, unknown>>(
    `SELECT DATE_FORMAT(ship_date,'%Y-%m-%d %H:%i:%s') shipDate, status, revision,
            DATE_FORMAT(confirmed_time,'%Y-%m-%d %H:%i:%s') confirmedTime
       FROM prop_shipment WHERE shipment_id=27`);
  const relations = await db.query<Record<string, unknown>>(
    `SELECT relation_id, product_id, order_id, shipment_id, shipment_product_id, active_product_id,
            delivery_valid, ended_by, DATE_FORMAT(ended_time,'%Y-%m-%d %H:%i:%s') endedTime,
            ended_reason, baseline_action FROM prop_product_order_relation WHERE relation_id=4`);
  const maxEvent = await db.query<{ maxId: number | null }>("SELECT MAX(event_id) maxId FROM prop_production_event");
  const sp = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_shipment_product WHERE shipment_id=27");
  BACKUP.product = products[0] ?? null;
  BACKUP.shipment = shipments[0] ?? null;
  BACKUP.relation = relations[0] ?? null;
  BACKUP.maxEventId = Number(maxEvent[0]?.maxId ?? 0);
  BACKUP.shipmentProductCount = Number(sp[0]?.cnt ?? 0);
  writeFileSync(BACKUP_PATH, JSON.stringify(BACKUP, null, 2), "utf-8");
}

async function restoreAll(): Promise<void> {
  try {
    if (BACKUP.relation) {
      await db.execute(
        `UPDATE prop_product_order_relation SET active_product_id=?, delivery_valid=?, ended_by=NULL, ended_time=NULL,
           ended_reason=NULL, baseline_action=NULL WHERE relation_id=4`,
        [BACKUP.relation.active_product_id, BACKUP.relation.delivery_valid]);
    }
    if (BACKUP.product) {
      await db.execute(
        `UPDATE prop_product SET first_shipment_date=?, lifecycle_base_month=?, baseline_shipment_id=?, external_product_name=?
          WHERE product_id=35`,
        [BACKUP.product.firstShipmentDate, BACKUP.product.lifecycle_base_month,
          BACKUP.product.baseline_shipment_id, BACKUP.product.external_product_name]);
    }
    if (BACKUP.shipment) {
      await db.execute("UPDATE prop_shipment SET ship_date=? WHERE shipment_id=27", [BACKUP.shipment.shipDate]);
    }
    if (BACKUP.maxEventId > 0) {
      await db.execute("DELETE FROM prop_production_event WHERE product_id=35 AND event_id>?", [BACKUP.maxEventId]);
    }
    console.log("[restore] 产品 35 / 关系 4 / 发货 27 已恢复");
  } catch (error) {
    console.error("[restore] 失败：", error);
  }
}

async function productState(): Promise<Record<string, unknown>> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT DATE_FORMAT(first_shipment_date,'%Y-%m-%d %H:%i:%s') firstShipmentDate,
            lifecycle_base_month, baseline_shipment_id FROM prop_product WHERE product_id=35`);
  return rows[0] ?? {};
}

async function relationState(): Promise<Record<string, unknown>> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT delivery_valid, ended_by, DATE_FORMAT(ended_time,'%Y-%m-%d %H:%i:%s') endedTime,
            ended_reason, baseline_action FROM prop_product_order_relation WHERE relation_id=4`);
  return rows[0] ?? {};
}

async function openReleaseModal(): Promise<import("playwright").Locator> {
  await page.goto("/orders/17", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const row = page.locator("tbody tr.ant-table-row", { hasText: "20261028" }).first();
  await row.waitFor({ state: "visible", timeout: 20000 });
  await row.getByRole("button", { name: /関連付けを解除/ }).click();
  const modal = page.locator(".ant-modal:visible").filter({ hasText: "関連付けを解除" }).last();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  await modal.locator(".ant-radio-wrapper").first().waitFor({ state: "visible", timeout: 10000 });
  return modal;
}

async function openShipmentDrawer(): Promise<import("playwright").Locator> {
  await page.goto("/orders/17", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const row = page.locator("tbody tr.ant-table-row", { hasText: "11:19:39" }).first();
  await row.waitFor({ state: "visible", timeout: 20000 });
  await row.getByRole("button", { name: /詳細|表示/ }).first().click();
  const drawer = page.locator(".ant-drawer:visible").last();
  await drawer.waitFor({ state: "visible", timeout: 15000 });
  await drawer.locator('input[type="date"]').first().waitFor({ state: "visible", timeout: 10000 });
  return drawer;
}

async function main(): Promise<void> {
  await db.connect();
  token = await apiLogin(config.app.loginUser, config.app.loginPassword);
  await loadBackup();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-mgmt-d3" });
  page = session.page;
  page.setDefaultTimeout(15000);
  await login(page);
  try {
    await book.run("产品详情展示-014", "解除关联的两种基准处理", REQ, async () => {
      const beforeProduct = await productState();
      const beforeRelation = await relationState();

      const cancelModal = await openReleaseModal();
      await page.waitForTimeout(600);
      const modalText = await text(cancelModal);
      const radioCount = await cancelModal.locator(".ant-radio-wrapper").count();
      const keepOption = radioCount >= 2;
      const clearOption = radioCount >= 2;
      await cancelModal.getByRole("button", { name: /戻る|キャンセル/ }).first().click();
      await cancelModal.waitFor({ state: "hidden", timeout: 10000 });
      await page.waitForTimeout(700);
      const cancelRelation = await relationState();
      const cancelProduct = await productState();

      const keepModal = await openReleaseModal();
      await keepModal.locator("label", { hasText: "基準月を保持" }).click();
      const keepRespPromise = page.waitForResponse((r) => r.url().includes("/relations/4/release") && r.request().method() === "POST", { timeout: 15000 });
      await keepModal.getByRole("button", { name: /解除を確定/ }).click();
      const keepResp = await keepRespPromise;
      const keepBody = await keepResp.json().catch(() => ({}));
      await page.waitForTimeout(1800);
      const keepRelation = await relationState();
      const keepProduct = await productState();
      const checksAfterKeep = await db.query<{ shipments: number; shipmentProducts: number }>(
        `SELECT (SELECT COUNT(*) FROM prop_shipment WHERE shipment_id=27 AND deleted_time IS NULL) shipments,
                (SELECT COUNT(*) FROM prop_shipment_product WHERE shipment_id=27) shipmentProducts`);
      const keepOk = keepResp.status() === 200 && keepRelation.endedTime !== null &&
        keepRelation.baseline_action === "keep" && keepProduct.firstShipmentDate === beforeProduct.firstShipmentDate &&
        keepProduct.lifecycle_base_month === beforeProduct.lifecycle_base_month &&
        Number(checksAfterKeep[0]?.shipments) === 1 && Number(checksAfterKeep[0]?.shipmentProducts) === BACKUP.shipmentProductCount;

      await restoreAll();
      await page.waitForTimeout(500);

      const clearModal = await openReleaseModal();
      await clearModal.locator("label", { hasText: "基準月をクリア" }).click();
      const clearRespPromise = page.waitForResponse((r) => r.url().includes("/relations/4/release") && r.request().method() === "POST", { timeout: 15000 });
      await clearModal.getByRole("button", { name: /解除を確定/ }).click();
      const clearResp = await clearRespPromise;
      const clearBody = await clearResp.json().catch(() => ({}));
      await page.waitForTimeout(1800);
      const clearRelation = await relationState();
      const clearProduct = await productState();
      const history = await apiCall(token, "GET", "/prop/production/products/35");
      const historyEvents = ((history.data as any)?.events ?? []) as Array<Record<string, unknown>>;
      const shipmentHistory = historyEvents.some((item) => String(item.eventType ?? "").includes("SHIPMENT"));
      const clearOk = clearResp.status() === 200 && clearRelation.endedTime !== null &&
        clearRelation.baseline_action === "clear" && clearProduct.firstShipmentDate === null &&
        clearProduct.lifecycle_base_month === null && clearProduct.baseline_shipment_id === null && shipmentHistory;

      await restoreAll();
      const restoredProduct = await productState();
      const restoredRelation = await relationState();
      const restoreOk = restoredProduct.firstShipmentDate === beforeProduct.firstShipmentDate &&
        restoredProduct.lifecycle_base_month === beforeProduct.lifecycle_base_month &&
        restoredRelation.endedTime === null && restoredRelation.baseline_action === null;

      const dialogOk = keepOption && clearOption;
      const ok = dialogOk && cancelRelation.endedTime === null &&
        cancelProduct.firstShipmentDate === beforeProduct.firstShipmentDate && keepOk && clearOk && restoreOk;
      const cancelOk = cancelRelation.endedTime === null && cancelProduct.firstShipmentDate === beforeProduct.firstShipmentDate;
      return {
        status: ok ? "通过" : "不通过",
        actual: `判定 dialog=${dialogOk}/cancel=${cancelOk}/keep=${keepOk}/clear=${clearOk}/restore=${restoreOk}；弹窗 keep/clear 选项数=${radioCount}（弹窗文本「${compact(modalText, 60)}」）；取消后关系结束=${cancelRelation.endedTime ?? "null"}、基准=「${cancelProduct.lifecycle_base_month}」；keep：HTTP ${keepResp.status()} code=${(keepBody as any)?.code}、baseline_action=${keepRelation.baseline_action}、结束时间=${keepRelation.endedTime}、首次出货/基准=「${keepProduct.firstShipmentDate}」/「${keepProduct.lifecycle_base_month}」（不变=${keepProduct.firstShipmentDate === beforeProduct.firstShipmentDate && keepProduct.lifecycle_base_month === beforeProduct.lifecycle_base_month}）、发货记录 ${checksAfterKeep[0]?.shipments} 条/${checksAfterKeep[0]?.shipmentProducts} 行；clear：HTTP ${clearResp.status()}、baseline_action=${clearRelation.baseline_action}、首次出货/基准/基线=${clearProduct.firstShipmentDate ?? "null"}/${clearProduct.lifecycle_base_month ?? "null"}/${clearProduct.baseline_shipment_id ?? "null"}、历史出货事件可追溯=${shipmentHistory}；恢复=${restoreOk}（首次=${restoredProduct.firstShipmentDate}、基准=${restoredProduct.lifecycle_base_month}、关系结束=${restoredRelation.endedTime ?? "null"}）`,
        evidence: "订单 17 详情解除弹窗（取消/keep/clear）+ POST /relations/4/release + 产品/关系/发货 DB 回查 + 产品详情历史事件",
      };
    });

    await book.run("产品详情展示-015", "首次寄送日期更正联动", REQ, async () => {
      await db.execute("UPDATE prop_shipment SET ship_date='2026-09-15 00:00:00' WHERE shipment_id=27");
      await db.execute(
        `UPDATE prop_product SET first_shipment_date='2026-09-15 00:00:00', lifecycle_base_month='2026-09',
                baseline_shipment_id=27 WHERE product_id=35`);
      await page.waitForTimeout(500);
      const beforeRelation = await relationState();
      const beforeShipmentRows = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_shipment_product WHERE shipment_id=27");

      const drawer = await openShipmentDrawer();
      const dateInput = drawer.locator('input[type="date"]').first();
      const beforeValue = await dateInput.inputValue();
      const savePromise = page.waitForResponse(
        (r) => r.url().includes("/prop/shipment/27") && r.request().method() === "PUT",
        { timeout: 20000 },
      );
      await dateInput.fill("2026-10-15");
      await dateInput.dispatchEvent("change");
      const saveResp = await savePromise;
      const saveBody = await saveResp.json().catch(() => ({}));
      await page.waitForTimeout(1800);
      const product = await productState();
      const afterRelation = await relationState();
      const afterShipmentRows = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_shipment_product WHERE shipment_id=27");
      const shipment = await db.query<Record<string, unknown>>("SELECT DATE_FORMAT(ship_date,'%Y-%m-%d') shipDate, status FROM prop_shipment WHERE shipment_id=27");

      await page.goto("/products/35", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
      const detailValues = await page.locator(".ant-descriptions-item-content").allInnerTexts();
      const detailText = compact(detailValues.join(" | "));

      const listOk = product.firstShipmentDate?.startsWith("2026-10-15") &&
        product.lifecycle_base_month === "2026-10" && (shipment[0]?.shipDate === "2026-10-15");
      const relationOk = JSON.stringify(beforeRelation) === JSON.stringify(afterRelation) &&
        Number(beforeShipmentRows[0]?.cnt) === Number(afterShipmentRows[0]?.cnt);
      const detailOk = detailText.includes("2026-10-15") && detailText.includes("2026-10");
      await restoreAll();
      const restored = await productState();
      const ok = saveResp.status() === 200 && (saveBody as any)?.code === 200 && beforeValue === "2026-09-15" &&
        listOk && relationOk && detailOk && restored.firstShipmentDate === BACKUP.product?.firstShipmentDate;
      return {
        status: ok ? "通过" : "不通过",
        actual: `抽屉初值=「${beforeValue}」；PUT /shipment/27 HTTP ${saveResp.status()} code=${(saveBody as any)?.code}；更正后发货日=${shipment[0]?.shipDate}、产品首次出货=${product.firstShipmentDate}、基准月=${product.lifecycle_base_month}；订单关系/履约数量不变=${relationOk}（发货明细 ${beforeShipmentRows[0]?.cnt}→${afterShipmentRows[0]?.cnt}）；详情显示 2026-10-15/2026-10=${detailOk}；恢复=${restored.firstShipmentDate}（原 ${BACKUP.product?.firstShipmentDate}）`,
        evidence: "前置 ship_date/first_shipment_date=2026-09-15 → 订单详情发货抽屉改 2026-10-15 → DB 联动 + 产品详情 + 关系/发货明细对照",
      };
    });
  } finally {
    await restoreAll();
    await finishSession(browser, session, "verify-product-mgmt-d3");
    await db.close();
  }
}

main().catch(async (error) => {
  console.error("[product-d3] FAILED:", error);
  await restoreAll().catch(() => undefined);
  await db.close().catch(() => undefined);
  process.exit(1);
});