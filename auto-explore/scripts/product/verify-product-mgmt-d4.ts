/**
 * 产品管理 D4 批：权限-007（并发解除与重建订单关系）。
 * 预建空发货单后并发执行 release 与 add-product；验证最终有效关系 <= 1、无状态错乱，并清理全部夹具。
 */
import { chromium } from "playwright";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, apiLogin, apiCall, finishSession, compact,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook("reports/product-mgmt-runtime-results-d4.json");
const db = new DbClient();
const REQ = "FEAT-08 产品管理（并发关系）";
let token = "";
let newShipmentId = 0;
let maxEventId = 0;
let backup: Record<string, unknown> | null = null;
let backupRelation: Record<string, unknown> | null = null;

async function restore(): Promise<void> {
  try {
    if (newShipmentId) {
      await db.execute("DELETE FROM prop_product_order_relation WHERE shipment_id=? AND relation_id<>4", [newShipmentId]);
      await db.execute("DELETE FROM prop_shipment_product WHERE shipment_id=?", [newShipmentId]);
      await db.execute("DELETE FROM prop_shipment WHERE shipment_id=?", [newShipmentId]);
    }
    if (backupRelation) {
      await db.execute(
        `UPDATE prop_product_order_relation SET active_product_id=?, delivery_valid=?, ended_by=NULL,
                ended_time=NULL, ended_reason=NULL, baseline_action=NULL WHERE relation_id=4`,
        [backupRelation.active_product_id, backupRelation.delivery_valid]);
    }
    if (backup) {
      await db.execute(
        `UPDATE prop_product SET first_shipment_date=?, lifecycle_base_month=?, baseline_shipment_id=?
          WHERE product_id=35`,
        [backup.firstShipmentDate, backup.lifecycle_base_month, backup.baseline_shipment_id]);
    }
    if (maxEventId > 0) {
      await db.execute("DELETE FROM prop_production_event WHERE product_id=35 AND event_id>?", [maxEventId]);
    }
    console.log("[restore] 并发夹具已清理");
  } catch (error) {
    console.error("[restore] 失败：", error);
  }
}

async function main(): Promise<void> {
  await db.connect();
  token = await apiLogin(config.app.loginUser, config.app.loginPassword);
  const products = await db.query<Record<string, unknown>>(
    `SELECT DATE_FORMAT(first_shipment_date,'%Y-%m-%d %H:%i:%s') firstShipmentDate, lifecycle_base_month, baseline_shipment_id
       FROM prop_product WHERE product_id=35`);
  const relations = await db.query<Record<string, unknown>>(
    "SELECT active_product_id, delivery_valid FROM prop_product_order_relation WHERE relation_id=4");
  const maxEvent = await db.query<{ maxId: number | null }>("SELECT MAX(event_id) maxId FROM prop_production_event");
  backup = products[0] ?? null;
  backupRelation = relations[0] ?? null;
  maxEventId = Number(maxEvent[0]?.maxId ?? 0);
  await db.execute(
    "UPDATE prop_product_order_relation SET active_product_id=35, delivery_valid=1, ended_by=NULL, ended_time=NULL, ended_reason=NULL, baseline_action=NULL WHERE relation_id=4");

  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-mgmt-d4" });
  const page = session.page;
  page.setDefaultTimeout(15000);
  await login(page);
  try {
    await book.run("产品管理权限-007", "并发解除与重建订单关系不出现状态错乱", REQ, async () => {
      const order = await apiCall(token, "GET", "/prop/order/17");
      const orderRevision = Number((order.data as any)?.revision ?? 0);
      const created = await apiCall(token, "POST", "/prop/order/17/shipments", {
        requestId: randomUUID(),
        orderRevision,
        shipDate: "2026-10-28",
        adoptedProductName: "一命多助",
      });
      if (created.code !== 200) {
        return {
          status: "阻塞",
          actual: `无法创建空发货单夹具：code=${created.code}「${compact(created.msg, 60)}」`,
          evidence: "POST /prop/order/17/shipments",
        };
      }
      const createdData = created.data as any;
      newShipmentId = Number(createdData?.shipmentId ?? createdData?.id ?? 0);
      if (!newShipmentId) throw new Error(`创建发货单未返回 ID：${JSON.stringify(createdData).slice(0, 200)}`);
      const addRevision = Number(createdData?.revision ?? 1);

      const [releaseRes, addRes] = await Promise.all([
        apiCall(token, "POST", "/prop/order/17/relations/4/release", { baselineAction: "keep" }),
        apiCall(token, "POST", `/prop/shipment/${newShipmentId}/products`, {
          revision: addRevision, manufacturingNo: "20261028",
        }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const rels = await db.query<Record<string, unknown>>(
        `SELECT relation_id, shipment_id, active_product_id, delivery_valid,
                DATE_FORMAT(ended_time,'%Y-%m-%d %H:%i:%s') endedTime, baseline_action
           FROM prop_product_order_relation WHERE product_id=35 ORDER BY relation_id`);
      const active = rels.filter((row) => row.endedTime === null);
      const relation4 = rels.find((row) => Number(row.relation_id) === 4);
      const newRelation = rels.find((row) => Number(row.shipment_id) === newShipmentId);
      const noSysError = !/SQLException|NullPointerException|at com\.|at java\./.test(`${releaseRes.msg}${addRes.msg}`);
      const consistent = active.length <= 1 &&
        (newRelation && newRelation.endedTime === null ? relation4?.endedTime !== null : true) &&
        !(relation4?.endedTime === null && newRelation && newRelation.endedTime === null);
      const stateText = rels.map((row) => `#${row.relation_id}/ship${row.shipment_id}/${row.endedTime === null ? "有效" : "结束"}${row.baseline_action ? `(${row.baseline_action})` : ""}`).join("；");
      const ok = noSysError && consistent && active.length <= 1;
      return {
        status: ok ? "通过" : "不通过",
        actual: `预建发货单=${newShipmentId}（revision ${addRevision}）；release→code ${releaseRes.code}「${compact(releaseRes.msg, 40)}」；add-product→code ${addRes.code}「${compact(addRes.msg, 40)}」；最终关系=${stateText}；有效关系数=${active.length}（≤1=${active.length <= 1}）；无系统异常=${noSysError}；状态一致=${consistent}`,
        evidence: "POST /order/17/shipments 预建空单 → Promise.all(release relation4 + add product 20261028) → 关系表有效数与状态回查",
      };
    });
  } finally {
    await restore();
    await finishSession(browser, session, "verify-product-mgmt-d4");
    await db.close();
  }
}

main().catch(async (error) => {
  console.error("[product-d4] FAILED:", error);
  await restore().catch(() => undefined);
  await db.close().catch(() => undefined);
  process.exit(1);
});