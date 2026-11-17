import { launchAdminSession, finishSession } from "./order-runtime-utils.js";
import { openBatchPage, batchRow } from "./order-batch-utils.js";
const { browser, session } = await launchAdminSession("probe-order-batch-ui");
try {
  const page = session.page;
  await page.goto("http://localhost:8090/home/workbench");
  await page.waitForTimeout(1500);
  const orderMenu = page.locator(".top-menu .ant-menu-submenu-title", { hasText: "订单管理" }).first();
  await orderMenu.hover();
  await page.waitForTimeout(700);
  const submenu = page.locator(".ant-menu-submenu-popup:visible");
  console.log("ORDER_SUBMENU", JSON.stringify((await submenu.innerText()).replace(/\s+/g," ").trim()));
  const links = await submenu.locator("a").evaluateAll((els)=>els.map(e=>({text:(e.textContent||"").replace(/\s+/g," ").trim(),href:e.getAttribute("href")})));
  console.log("LINKS", JSON.stringify(links));
  await openBatchPage(page);
  const row = batchRow(page, { shipmentNo: "SH260221" } as any);
  console.log("CARRIER_HTML", (await page.locator(".carrier-select").evaluate(el => el.outerHTML)).slice(0,3000));
  const input = row.locator(".ant-input-number").first();
  console.log("INPUT_HTML", (await input.evaluate(el => el.outerHTML)).slice(0,4000));
} finally { await finishSession(browser, session, "probe-order-batch-ui"); }