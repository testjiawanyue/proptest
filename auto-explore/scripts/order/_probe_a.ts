import { DbClient } from "../customer/customer-runtime-utils.js";
import { apiLogin, apiCall } from "../production/prod-runtime-utils.js";
const db = new DbClient();
await db.connect();
const q = async (label: string, sql: string, params: unknown[] = []) => {
  try { console.log(label + "=", JSON.stringify(await db.query<Record<string, unknown>>(sql, params))); }
  catch (e) { console.log(label + "=ERR", (e as Error).message); }
};
try {
  await q("TABLES_ORDER", "SHOW TABLES LIKE '%order%'");
  await q("SUBJECT_COLS", "SHOW COLUMNS FROM prop_customer_subject");
  await q("ADDR_COLS", "SHOW COLUMNS FROM prop_customer_address");
  await q("CONTACT_COLS", "SHOW COLUMNS FROM prop_customer_contact");
  await q("CUSTOMERS", "SELECT subject_id,subject_type,company_id,customer_no,subject_name,default_customer_type,deleted_time FROM prop_customer_subject ORDER BY subject_id DESC LIMIT 30");
  await q("ADDRESSES", "SELECT address_id,subject_id,postal_code,address_line1,address_line2 FROM prop_customer_address ORDER BY address_id DESC LIMIT 30");
  await q("CONTACTS", "SELECT contact_id,address_id,contact_name,job_title,phone,email FROM prop_customer_contact ORDER BY contact_id DESC LIMIT 30");
  const token = await apiLogin("admin", "admin123");
  const names = await apiCall(token, "GET", "/prop/order/product-names");
  console.log("PRODUCT_NAMES=", JSON.stringify(names).slice(0, 8000));
  const preview = await apiCall(token, "GET", "/prop/customer/1/preview");
  console.log("PREVIEW1=", JSON.stringify(preview).slice(0, 8000));
} finally { await db.close(); }