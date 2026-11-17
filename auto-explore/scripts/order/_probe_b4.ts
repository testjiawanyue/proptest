import { DbClient } from "../customer/customer-runtime-utils.js";
const db = new DbClient(); await db.connect();
try {
  console.log(JSON.stringify(await db.query("SELECT * FROM prop_part_profile WHERE profile_id=17"),null,2));
  console.log(JSON.stringify(await db.query("SHOW COLUMNS FROM prop_inspection"),null,2));
  console.log(JSON.stringify(await db.query("SELECT product_id,active_manufacturing_no,initial_production_inspection_passed,storage_path FROM prop_product WHERE product_id IN (3,7,8,9)"),null,2));
} finally { await db.close(); }