import { launchAdminSession, finishSession } from "./order-runtime-utils.js";
import { openBatchPage, batchRow } from "./order-batch-utils.js";
const { browser, session } = await launchAdminSession("probe-order-batch-drawer");
try {
  const page=session.page;
  await openBatchPage(page);
  const row=batchRow(page,{shipmentNo:"SH260224"} as any);
  await row.getByRole("button",{name:"作業票を変更"}).click();
  const drawer=page.locator(".prop-shipment-drawer");
  await drawer.waitFor({state:"visible"});
  await page.waitForTimeout(1200);
  console.log("DRAWER", JSON.stringify((await drawer.innerText()).replace(/\s+/g," ").trim().slice(0,2500)));
  const prodRow=drawer.locator("tr.ant-table-row").filter({hasText:"SHIPMENT"});
  console.log("PROD_ROWS", await drawer.locator("tr.ant-table-row").count());
  console.log("PROD_FIRST", JSON.stringify((await drawer.locator("tr.ant-table-row").first().innerText()).replace(/\s+/g," ").trim()));
  const remove=drawer.getByRole("button",{name:"リストから外す"}).first();
  console.log("REMOVE_COUNT", await remove.count());
  await remove.click();
  await page.waitForTimeout(500);
  const pop=page.locator(".ant-popover:visible").last();
  console.log("POP", JSON.stringify((await pop.innerText()).replace(/\s+/g," ").trim()));
  console.log("POP_BUTTONS", JSON.stringify(await pop.locator("button").allInnerTexts()));
  console.log("FOOTER_BUTTONS", JSON.stringify(await drawer.locator(".footer button").allInnerTexts()));
} finally { await finishSession(browser,session,"probe-order-batch-drawer"); }