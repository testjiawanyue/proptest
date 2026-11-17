import { DbClient } from "../customer/customer-runtime-utils.js";
const db = new DbClient(); await db.connect();
try {
  const rows = await db.query<Record<string,unknown>>(`
    SELECT p.product_id,p.active_manufacturing_no,p.external_product_name,p.first_shipment_date,p.lifecycle_base_month,p.baseline_shipment_id,
      (SELECT GROUP_CONCAT(CONCAT(sr.shipment_id,':',sr.order_id)) FROM prop_shipment_reservation sr WHERE sr.product_id=p.product_id) reservations,
      (SELECT GROUP_CONCAT(CONCAT(r.order_id,':',r.relation_id)) FROM prop_product_order_relation r WHERE r.product_id=p.product_id AND r.delivery_valid=1) current_rel
    FROM prop_product p WHERE p.deleted_time IS NULL AND p.initial_production_inspection_passed=1 ORDER BY p.product_id`);
  console.log(JSON.stringify(rows,null,2));
  const orders = await db.query<Record<string,unknown>>(`SELECT o.order_id,o.customer_order_no,o.order_status,o.customer_type,o.revision,
    COALESCE((SELECT SUM(l.quantity) FROM prop_order_line l WHERE l.order_id=o.order_id),0) total_qty,
    (SELECT COUNT(*) FROM prop_product_order_relation r WHERE r.order_id=o.order_id AND r.delivery_valid=1) fulfilled_qty
    FROM prop_order o WHERE o.order_id>=18 ORDER BY o.order_id`);
  console.log("ORDERS>=18",JSON.stringify(orders,null,2));
} finally { await db.close(); }