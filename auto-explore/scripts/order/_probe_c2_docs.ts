import { DbClient, launchAdminSession, finishSession, apiLogin } from "./order-runtime-utils.js";
import { ensureProduct, createOrder, createShipment, addProduct, saveFields } from "./order-shipment-utils.js";
import { ensureOrderFixtures } from "./order-runtime-utils.js";
import { apiCall } from "../production/prod-runtime-utils.js";
(async()=>{
 const db=new DbClient(); await db.connect(); const f=await ensureOrderFixtures(db); const t=await apiLogin("admin","admin123");
 const no=`AUTO-ORD-C2PROBE-${Date.now()}`; await ensureProduct(db,no); const o=await createOrder(t,f.a,`${no}-O`,1); const s=await createShipment(t,o);
 const a=await addProduct(t,s.shipmentId,no); console.log("add",JSON.stringify(a));
 const sv=await saveFields(t,Number(s.shipmentId),{carrier:"yamato",shipDate:"2026-10-29",boxCount:1}); console.log("save",sv.code,sv.msg,JSON.stringify(sv.data));
 for(const type of ["waybill","deliveryNote","guarantee"]){
  const p=await apiCall(t,"GET",`/prop/shipment/${s.shipmentId}/documents/prepare?type=${type}`); console.log("PREP",type,p.code,p.msg,JSON.stringify(p.data).slice(0,2000));
 }
 const prep=await apiCall(t,"GET",`/prop/shipment/${s.shipmentId}/documents/prepare?type=waybill`);
 const cmd={requestId:crypto.randomUUID(),type:"waybill",revision:prep.data.revision,copies:2,sourceToken:prep.data.sourceToken,issueDate:"2026-10-29",overrides:prep.data.defaults};
 const cr=await apiCall(t,"POST",`/prop/shipment/${s.shipmentId}/documents`,cmd); console.log("CREATE",cr.code,cr.msg,JSON.stringify(cr.data).slice(0,4000));
 const c2=await apiCall(t,"POST",`/prop/shipment/${s.shipmentId}/documents`,cmd); console.log("REPLAY",c2.code,c2.msg,JSON.stringify(c2.data).slice(0,1000));
 await db.close();
})();