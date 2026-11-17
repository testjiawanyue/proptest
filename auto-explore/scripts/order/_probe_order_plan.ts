import { DbClient } from "../customer/customer-runtime-utils.js";
const db = new DbClient();
await db.connect();
const q = async (label: string, sql: string, params: unknown[] = []) => {
  try { console.log(label + "=", JSON.stringify(await db.query<Record<string, unknown>>(sql, params))); }
  catch (e) { console.log(label + "=ERR", (e as Error).message); }
};
try {
  await q("TABLES_FILE", "SHOW TABLES LIKE '%file%'");
  await q("TABLES_PRINT", "SHOW TABLES LIKE '%print%'");
  await q("TABLES_MAIL", "SHOW TABLES LIKE '%mail%'");
  await q("TABLES_WAYBILL", "SHOW TABLES LIKE '%waybill%'");
  await q("ORDERS", `SELECT o.order_id,o.order_no,o.order_status,o.order_type,o.customer_type,o.revision,
      COALESCE(SUM(l.quantity),0) qty,
      (SELECT COUNT(*) FROM prop_shipment s WHERE s.order_id=o.order_id AND s.deleted_time IS NULL) ships,
      (SELECT COUNT(*) FROM prop_shipment s WHERE s.order_id=o.order_id AND s.status='preparing' AND s.deleted_time IS NULL) prep,
      (SELECT COUNT(*) FROM prop_shipment s WHERE s.order_id=o.order_id AND s.status='shipped' AND s.deleted_time IS NULL) shipped
    FROM prop_order o LEFT JOIN prop_order_line l ON l.order_id=o.order_id
    GROUP BY o.order_id ORDER BY o.order_id`);
  await q("SHIPS", `SELECT s.shipment_id,s.order_id,s.shipment_no,s.status,DATE_FORMAT(s.ship_date,'%Y-%m-%d') shipDate,s.carrier,s.box_count,s.revision,
      (SELECT COUNT(*) FROM prop_shipment_product sp WHERE sp.shipment_id=s.shipment_id) products
    FROM prop_shipment s WHERE s.deleted_time IS NULL ORDER BY s.order_id,s.shipment_id`);
  await q("RELS", `SELECT relation_id,order_id,shipment_id,product_id,active_product_id,delivery_valid,DATE_FORMAT(ended_time,'%Y-%m-%d %H:%i:%s') endedTime
    FROM prop_product_order_relation ORDER BY order_id,relation_id`);
  await q("P_STATUS", `SELECT COUNT(*) total, SUM(scrapped_time IS NOT NULL) scrapped,
      SUM(initial_production_inspection_passed=1) passed, SUM(initial_production_inspection_passed=0) notPassed,
      SUM(initial_production_inspection_passed IS NULL) nullFlag FROM prop_product`);
  await q("P_FREE", `SELECT p.product_id,p.manufacturing_no,p.storage_path,p.initial_production_inspection_passed,p.scrapped_time,
      (SELECT COUNT(*) FROM prop_product_order_relation r WHERE r.product_id=p.product_id AND r.ended_time IS NULL) activeRel
    FROM prop_product p WHERE p.scrapped_time IS NULL AND p.initial_production_inspection_passed=1
    ORDER BY p.product_id DESC LIMIT 30`);
} finally { await db.close(); }