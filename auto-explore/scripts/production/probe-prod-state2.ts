import { DbProbe } from "../../src/probes/dbProbe.js";
async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const bd = await db.snapshot("bd", "SELECT data_id, data_type, display_value, status FROM prop_base_data ORDER BY data_type, data_id");
  console.log("BASE_DATA:", JSON.stringify(bd.rows, null, 1).slice(0, 3000));
  const prods = await db.snapshot("p", `SELECT p.product_id, p.manufacturing_no, p.m_no, p.deleted_time,
    (SELECT COUNT(*) FROM prop_product_binding b WHERE b.product_id=p.product_id AND b.ended_time IS NULL) active_bindings,
    (SELECT inspection_id FROM prop_inspection i WHERE i.product_id=p.product_id) insp
    FROM prop_product p ORDER BY p.product_id`);
  console.log("PRODUCTS:", JSON.stringify(prods.rows, null, 1));
  await db.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
