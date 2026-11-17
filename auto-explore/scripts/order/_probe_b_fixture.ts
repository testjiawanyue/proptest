import { DbClient } from "../customer/customer-runtime-utils.js";
import { ensureQualifiedProduct, apiCall, apiLogin } from "../production/prod-runtime-utils.js";
const db = new DbClient(); await db.connect();
try {
  const token = await apiLogin("admin","admin123");
  const no = "AUTO-ORD-B-PROBE1";
  const id = await ensureQualifiedProduct(db, token, no);
  console.log("id",id);
  console.log("before",JSON.stringify(await db.query("SELECT product_id,active_manufacturing_no,initial_production_inspection_passed FROM prop_product WHERE product_id=?",[id])));
  const inspected = await apiCall(token,"POST","/prop/production/inspection",{productIds:[id]});
  console.log("inspection",JSON.stringify(inspected));
  console.log("after",JSON.stringify(await db.query("SELECT product_id,active_manufacturing_no,initial_production_inspection_passed FROM prop_product WHERE product_id=?",[id])));
} finally { await db.close(); }