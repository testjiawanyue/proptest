import { launchAdminSession, finishSession } from "./order-runtime-utils.js";
(async()=>{
 const {browser,session}=await launchAdminSession("probe-c-doc-ui"); const p=session.page;
 try{ await p.goto("http://localhost:8090/orders/33"); await p.waitForTimeout(1500);
  const card=p.locator(".ant-card").filter({has:p.locator(".ant-card-head-title",{hasText:/出荷履歴/})}).last();
  await card.locator("tr.ant-table-row").first().getByRole("button",{name:"表示"}).click(); await p.waitForTimeout(1200);
  const d=p.locator(".prop-shipment-drawer"); console.log("drawer", (await d.innerText()).slice(0,2500));
  await d.getByRole("button",{name:/送り状を生成/}).click(); await p.waitForTimeout(1500);
  const m=p.locator(".ant-modal:visible").last(); console.log("modal", await m.innerText()); console.log("modal buttons", await m.locator("button").allInnerTexts());
 }finally{await finishSession(browser,session,"probe-c-doc-ui")}
})();