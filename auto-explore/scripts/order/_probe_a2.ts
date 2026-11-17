import { DbClient } from "../customer/customer-runtime-utils.js";
import { apiLogin, apiCall } from "../production/prod-runtime-utils.js";
const db = new DbClient(); await db.connect();
const q = async (label: string, sql: string, params: unknown[] = []) => {
  try { console.log(label + "=", JSON.stringify(await db.query<Record<string, unknown>>(sql, params))); } catch(e){ console.log(label+"=ERR",(e as Error).message); }
};
try {
  await q("CUSTOMERS", "SELECT subject_id,subject_type,company_id,customer_no,subject_name,default_customer_type FROM prop_customer_subject ORDER BY subject_id DESC LIMIT 50");
  await q("ORDER_PRODUCT_NAME_COLS", "SHOW COLUMNS FROM prop_order_line");
  const token = await apiLogin("admin", "admin123");
  for (const id of [1,2,3,62,63,74,75]) {
    const r = await apiCall(token, "GET", `/prop/customer/${id}/preview`);
    console.log(`PREVIEW_${id}=`, JSON.stringify(r).slice(0,4000));
  }
} finally { await db.close(); }