import { launchAdminSession, finishSession } from "./order-runtime-utils.js";
(async()=>{
 const {browser,session}=await launchAdminSession("probe-c-ui");
 const p=session.page;
 try{
  await p.goto("http://localhost:8090/orders/40"); await p.waitForTimeout(2000);
  console.log("cards", await p.locator(".ant-card").allInnerTexts());
  console.log("buttons", await p.locator("button").allInnerTexts());
  const shipCard=p.locator(".ant-card").filter({has:p.locator(".ant-card-head-title",{hasText:/出荷履歴/})}).last();
  console.log("shipCard", await shipCard.innerText().catch(()=>"none"));
  const rows=shipCard.locator("tr.ant-table-row"); console.log("rows",await rows.count());
  if(await rows.count()){ console.log("row0",await rows.first().innerText()); await rows.first().getByRole("button",{name:"表示"}).click(); await p.waitForTimeout(1500); }
  const drawer=p.locator(".prop-shipment-drawer"); console.log("drawer visible",await drawer.isVisible()); console.log("drawer", (await drawer.innerText()).slice(0,5000));
  console.log("drawer buttons", await drawer.locator("button").allInnerTexts());
  console.log("disabled", await drawer.locator("button").evaluateAll(es=>es.map(e=>({t:(e as HTMLElement).innerText,d:(e as HTMLButtonElement).disabled}))));
 } finally { await finishSession(browser,session,"probe-c-ui"); }
})();