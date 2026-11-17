import { DbProbe } from "../../src/probes/dbProbe.js";
async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const insp = await db.snapshot("i", "SELECT * FROM prop_inspection ORDER BY inspection_id DESC LIMIT 1");
  console.log("LATEST INSPECTION:", JSON.stringify(insp.rows));
  const candidates = await db.snapshot("c", `SELECT p.product_id, p.manufacturing_no FROM prop_product p
    JOIN prop_product_binding b ON b.product_id = p.product_id AND b.ended_time IS NULL
    LEFT JOIN prop_inspection i ON i.product_id = p.product_id
    WHERE p.deleted_time IS NULL AND i.inspection_id IS NULL
    GROUP BY p.product_id HAVING COUNT(DISTINCT b.slot_type) >= 4 ORDER BY p.product_id`);
  console.log("READY CANDIDATES (DB):", JSON.stringify(candidates.rows));
  await db.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
