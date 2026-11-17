import { DbClient, apiLogin, apiCall } from "./order-runtime-utils.js";
import { randomUUID } from "node:crypto";
const db = new DbClient(); await db.connect();
const token = await apiLogin("admin","admin123");
try {
  const od=await apiCall(token,"GET","/prop/order/24"); const rev=Number((od.data as any).revision); console.log("order rev",rev,"fulfilled",(od.data as any).fulfilledQuantity,"total",(od.data as any).totalQuantity);
  const sh=await apiCall(token,"POST","/prop/order/24/shipments",{requestId:randomUUID(),orderRevision:rev,shipDate:"2026-10-29",adoptedProductName:"AUTO-MD-SAME"}); console.log("SHIP",sh.code,sh.msg); const sid=Number((sh.data as any)?.shipmentId); console.log("sid",sid);
  const add=await apiCall(token,"POST",`/prop/shipment/${sid}/products`,{revision:1,manufacturingNo:"AUTO-ORD-B-PROBEWB"}); console.log("ADD",add.code,JSON.stringify((add.data as any)?.added),(add.data as any)?.failures);
  const rev2=Number((add.data as any).shipment.revision);
  const save=await apiCall(token,"PUT",`/prop/shipment/${sid}`,{revision:rev2,fields:["carrier"],carrier:"yamato",saveMode:"auto"}); console.log("SAVE",save.code);
  const prep=await apiCall(token,"GET",`/prop/shipment/${sid}/documents/prepare?type=waybill`); console.log("PREP",prep.code,JSON.stringify(prep.data));
  const p:any=prep.data;
  const cmd={requestId:randomUUID(),type:"waybill",revision:p.revision,copies:1,sourceToken:p.sourceToken,issueDate:"2026-10-29",overrides:p.defaults};
  const doc=await apiCall(token,"POST",`/prop/shipment/${sid}/documents`,cmd); console.log("DOC",doc.code,doc.msg,JSON.stringify(doc.data));
  console.log("files",JSON.stringify(await db.query("SELECT file_id,shipment_id,file_type,version FROM prop_shipment_file WHERE shipment_id=?",[sid])));
} finally { await db.close(); }