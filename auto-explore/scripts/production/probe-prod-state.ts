import { DbProbe } from "../../src/probes/dbProbe.js";
async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const cols = await db.snapshot("c", "SHOW COLUMNS FROM prop_part_profile_version");
  console.log("VERSION COLS:", cols.rows.map((r) => r.Field).join(", "));
  const pcols = await db.snapshot("pc", "SHOW COLUMNS FROM prop_part_profile");
  console.log("PROFILE COLS:", pcols.rows.map((r) => r.Field).join(", "));
  const bcols = await db.snapshot("bc", "SHOW COLUMNS FROM prop_base_data");
  console.log("BASEDATA COLS:", bcols.rows.map((r) => r.Field).join(", "));
  const profiles = await db.snapshot("p", `SELECT p.profile_id, p.part_type, p.status, v.* FROM prop_part_profile p JOIN prop_part_profile_version v ON p.current_version_id = v.version_id ORDER BY p.profile_id`);
  console.log("PROFILES:", JSON.stringify(profiles.rows, null, 1).slice(0, 4000));
  const seq = await db.snapshot("s", `SELECT * FROM prop_product_sequence`);
  console.log("SEQ:", JSON.stringify(seq.rows));
  const counts = await db.snapshot("c2", `SELECT (SELECT COUNT(*) FROM prop_product) products, (SELECT COUNT(*) FROM prop_part_item) parts, (SELECT COUNT(*) FROM prop_product_binding) bindings, (SELECT COUNT(*) FROM prop_inspection) inspections, (SELECT COUNT(*) FROM prop_intake_batch) batches`);
  console.log("COUNTS:", JSON.stringify(counts.rows));
  await db.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
