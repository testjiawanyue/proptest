import { apiLogin, apiCall } from "../production/prod-runtime-utils.js";
(async()=>{
 const t=await apiLogin("admin","admin123");
 for(const id of [33,34,35,36,37,38,39,40]){
  const o=await apiCall(t,"GET",`/prop/order/${id}`);
  console.log("ORDER",id,JSON.stringify(o.data));
 }
 for(const id of [50,53,51,52,54,55,56]){
  const s=await apiCall(t,"GET",`/prop/shipment/${id}`);
  console.log("SHIP",id,JSON.stringify(s.data));
 }
})();