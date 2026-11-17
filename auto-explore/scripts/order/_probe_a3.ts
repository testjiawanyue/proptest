import { DbClient } from "../customer/customer-runtime-utils.js";
import { apiLogin, apiCall } from "../production/prod-runtime-utils.js";
const db = new DbClient(); await db.connect();
const q = async (label: string, sql: string, params: unknown[] = []) => { try { console.log(label+"=",JSON.stringify(await db.query<Record<string,unknown>>(sql,params))); } catch(e){ console.log(label+"=ERR",(e as Error).message);} };
try {
  await q("ORDER_COLS", "SHOW COLUMNS FROM prop_order");
  await q("ORDER_CREATE_REQ_COLS", "SHOW COLUMNS FROM prop_order_create_request");
  const token = await apiLogin("admin", "admin123");
  for (const id of [1,62,63,74,75]) { const r = await apiCall(token,"GET",`/prop/customer/selector/${id}/preview`); console.log(`PREVIEW_${id}=`,JSON.stringify(r).slice(0,5000)); }
  const tree = await apiCall(token,"GET","/prop/customer/selector/tree?keyword=AUTO-ORD"); console.log("TREE=",JSON.stringify(tree).slice(0,5000));
} finally { await db.close(); }