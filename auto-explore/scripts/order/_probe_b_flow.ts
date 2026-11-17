import { DbClient, apiLogin, apiCall, runTag } from "./order-runtime-utils.js";
import { randomUUID } from "node:crypto";
const db = new DbClient(); await db.connect();
const token = await apiLogin("admin","admin123");
const tag = runTag();
try {
  const fx = await db.query<Record<string,any>>("SELECT subject_id,subject_name FROM prop_customer_subject WHERE customer_no='AUTO-ORD-A-01'");
  const addr = await db.query<Record<string,any>>("SELECT address_id,address_line1 FROM prop_customer_address WHERE subject_id=? ORDER BY address_id LIMIT 1",[fx[0].subject_id]);
  const con = await db.query<Record<string,any>>("SELECT contact_id FROM prop_customer_contact WHERE address_id=? LIMIT 1",[addr[0].address_id]);
  const payload = {
    requestId: randomUUID(), orderDate: "2026-10-29", expectedShipDate: "2026-10-30", orderType: "sale", customerType: "direct",
    orderingParty:{mode:"select",id:Number(fx[0].subject_id)}, recipient:{mode:"select",id:Number(fx[0].subject_id)}, billingParty:{mode:"select",id:Number(fx[0].subject_id)},
    deliveryAddress:{mode:"select",id:Number(addr[0].address_id)}, deliveryContact:{mode:"select",id:Number(con[0].contact_id)},
    lines:[{productNameId:10,productName:"AUTO-MD-SAME",colorNote:"AUTO-PROBE",quantity:2}], remark:"AUTO-B flow probe"
  };
  const created = await apiCall(token,"POST","/prop/order",payload); console.log("CREATE",JSON.stringify(created));
  const oid=Number((created.data as any)?.orderId); if(!oid) throw new Error("no order id");
  const sh = await apiCall(token,"POST",`/prop/order/${oid}/shipments`,{requestId:randomUUID(),orderRevision:1,shipDate:"2026-10-29",adoptedProductName:"AUTO-MD-SAME"}); console.log("SHIP",JSON.stringify(sh));
  const sid=Number((sh.data as any)?.shipmentId ?? (sh.data as any)?.shipment?.shipmentId); console.log("sid",sid);
  const add=await apiCall(token,"POST",`/prop/shipment/${sid}/products`,{revision:1,manufacturingNo:"AUTO-ORD-B-PROBE1"}); console.log("ADD",JSON.stringify(add));
  const addRev=Number((add.data as any)?.shipment?.revision ?? 2);
  const save=await apiCall(token,"PUT",`/prop/shipment/${sid}`,{revision:addRev,fields:["carrier"],carrier:"yamato",saveMode:"auto"}); console.log("SAVE",JSON.stringify(save));
  const saveRev=Number((save.data as any)?.revision ?? addRev+1);
  const conf=await apiCall(token,"POST",`/prop/shipment/${sid}/confirm`,{revision:saveRev,trackingNumbers:[`AUTO-TRK-${tag}`]}); console.log("CONF",JSON.stringify(conf));
  const detail=await apiCall(token,"GET",`/prop/order/${oid}`); console.log("DETAIL fulfilled",(detail.data as any)?.fulfilledQuantity,"relations",(detail.data as any)?.relations?.length,"shipments",(detail.data as any)?.shipments?.length);
  console.log("DB",JSON.stringify(await db.query("SELECT * FROM prop_shipment_reservation WHERE product_id=36")));
} finally { await db.close(); }