import { DbProbe } from "../src/probes/dbProbe.js";
async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const cols = await db.snapshot("c", "SHOW COLUMNS FROM prop_part_profile_version");
  console.log("cols:", cols.rows.map((r) => r.Field).join(", "));
  const versions = await db.snapshot("v", "SELECT * FROM prop_part_profile_version WHERE profile_id = 10 ORDER BY version_no");
  console.log("versions:", JSON.stringify(versions.rows, null, 1).slice(0, 1200));
  const current = await db.snapshot("cur", "SELECT current_version_id FROM prop_part_profile WHERE profile_id = 10");
  console.log("current_version_id:", JSON.stringify(current.rows));
  await db.close();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
