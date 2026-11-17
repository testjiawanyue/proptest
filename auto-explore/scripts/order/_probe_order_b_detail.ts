import { launchAdminSession, finishSession } from "./order-runtime-utils.js";
const { browser, session } = await launchAdminSession("probe-order-b-detail");
const page=session.page; page.setDefaultTimeout(15000);
try {
  await page.goto("/orders/26");
  await page.locator(".order-detail-page").waitFor({state:"visible",timeout:15000});
  await page.waitForTimeout(1500);
  const cards=page.locator(".ant-card");
  console.log("cards",await cards.count());
  for(let i=0;i<await cards.count();i++){
    const c=cards.nth(i);
    const head=await c.locator(".ant-card-head").innerText().catch(()=>"<none>");
    const html=(await c.locator(".ant-card-head").innerHTML().catch(()=>"")).slice(0,500);
    console.log("CARD",i,"head=",JSON.stringify(head),"html=",html);
  }
  const rows=page.locator("tr.ant-table-row");
  console.log("rows",await rows.count());
  for(let i=0;i<await rows.count();i++){
    const t=(await rows.nth(i).innerText()).replace(/\s+/g," ");
    if(/P0[1-9]/.test(t)) console.log("ROW",i,JSON.stringify(t), "buttons=",JSON.stringify(await rows.nth(i).locator("button").allInnerTexts()));
  }
} finally { await finishSession(browser,session,"probe-order-b-detail"); }