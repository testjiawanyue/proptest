import { DbClient } from "../customer/customer-runtime-utils.js";
const db = new DbClient(); await db.connect();
const q = async (l:string,s:string,p:unknown[]=[])=>{try{console.log(l+"=",JSON.stringify(await db.query<Record<string,unknown>>(s,p)));}catch(e){console.log(l+"=ERR",(e as Error).message);}};
try {
  await q("PRODUCT_COLS", "SHOW COLUMNS FROM prop_product");
  await q("PRODUCT_ROW", "SELECT * FROM prop_product WHERE product_id IN (1,7)");
  await q("SHIP_COLS", "SHOW COLUMNS FROM prop_shipment");
  await q("SHIP_PROD_COLS", "SHOW COLUMNS FROM prop_shipment_product");
  await q("REL_COLS", "SHOW COLUMNS FROM prop_product_order_relation");
  await q("REL_ROW", "SELECT * FROM prop_product_order_relation WHERE relation_id IN (3,4)");
  await q("ORDER5", "SELECT * FROM prop_order WHERE order_id=17");
} finally { await db.close(); }