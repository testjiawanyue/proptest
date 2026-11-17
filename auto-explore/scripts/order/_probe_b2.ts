import { DbClient } from "../customer/customer-runtime-utils.js";
const db = new DbClient(); await db.connect();
const show = async (label: string, table: string) => {
  const rows = await db.query<Record<string,unknown>>(`SHOW COLUMNS FROM ${table}`);
  console.log(`\n### ${label} ${table}\n` + rows.map(r => `${r.Field}:${r.Type}${r.Key ? " "+r.Key : ""}`).join(", "));
};
try {
  for (const t of ["prop_order","prop_order_line","prop_order_operation","prop_shipment_file","prop_shipment_reservation","prop_product_order_relation","prop_shipment","prop_shipment_product"]) await show("", t);
  const products = await db.query<Record<string,unknown>>(`
    SELECT p.product_id,p.active_manufacturing_no,p.external_product_name,p.first_shipment_date,p.lifecycle_base_month,p.baseline_shipment_id,
      (SELECT COUNT(*) FROM prop_product_order_relation r WHERE r.product_id=p.product_id AND r.delivery_valid=1) current_relations,
      (SELECT COUNT(*) FROM prop_shipment_reservation sr WHERE sr.product_id=p.product_id) reservations,
      (SELECT COUNT(*) FROM prop_shipment_product sp JOIN prop_shipment s ON s.shipment_id=sp.shipment_id WHERE sp.product_id=p.product_id AND s.deleted_time IS NULL) shipment_items
    FROM prop_product p WHERE p.deleted_time IS NULL ORDER BY p.product_id`);
  console.log("\n### PRODUCTS\n", JSON.stringify(products,null,2));
  const recentOrders = await db.query<Record<string,unknown>>(`
    SELECT o.order_id,o.order_no,o.customer_order_no,o.order_status,o.customer_type,o.revision,
      (SELECT COALESCE(SUM(l.quantity),0) FROM prop_order_line l WHERE l.order_id=o.order_id) total_qty,
      (SELECT COUNT(*) FROM prop_product_order_relation r WHERE r.order_id=o.order_id AND r.delivery_valid=1) fulfilled_qty,
      (SELECT COUNT(*) FROM prop_shipment s WHERE s.order_id=o.order_id AND s.deleted_time IS NULL) shipment_count
    FROM prop_order o ORDER BY o.order_id DESC LIMIT 30`);
  console.log("\n### ORDERS\n", JSON.stringify(recentOrders,null,2));
  const prep = await db.query<Record<string,unknown>>(`
    SELECT s.shipment_id,s.order_id,s.status,s.revision,s.ship_date,s.carrier,
      (SELECT COUNT(*) FROM prop_shipment_product sp WHERE sp.shipment_id=s.shipment_id) product_count,
      (SELECT COUNT(*) FROM prop_shipment_file f WHERE f.shipment_id=s.shipment_id) file_count
    FROM prop_shipment s WHERE s.deleted_time IS NULL ORDER BY s.shipment_id DESC LIMIT 20`);
  console.log("\n### SHIPMENTS\n", JSON.stringify(prep,null,2));
} finally { await db.close(); }