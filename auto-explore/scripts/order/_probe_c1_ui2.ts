import { launchAdminSession, finishSession } from "./order-runtime-utils.js";
(async()=>{const {browser,session}=await launchAdminSession("probe-c1-ui2");const p=session.page;try{
 await p.goto("http://localhost:8090/orders/41"); await p.waitForTimeout(1500);
 const ship=p.locator(".ant-card").filter({has:p.locator(".ant-card-head-title",{hasText:/出荷履歴/})}).last();
 await ship.locator("tr.ant-table-row").first().getByRole("button",{name:"表示"}).click(); await p.waitForTimeout(1200);
 const d=p.locator(".prop-shipment-drawer");
 console.log("card titles",await d.locator(".ant-card-head-title").allInnerTexts());
 console.log("all rows",await d.locator("tr.ant-table-row").allInnerTexts());
 const c=d.locator(".ant-card").filter({hasText:"今回発送する製品"}).last(); console.log("c text",await c.innerText().catch(e=>String(e)));
 console.log("c rows",await c.locator("tr.ant-table-row").allInnerTexts().catch(e=>[String(e)]));
 }finally{await finishSession(browser,session,"probe-c1-ui2")}})();