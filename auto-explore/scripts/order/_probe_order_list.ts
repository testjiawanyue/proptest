import { launchAdminSession, finishSession } from "./order-runtime-utils.js";
const { browser, session } = await launchAdminSession("probe-order-list");
const page = session.page;
try {
  await page.goto("/orders");
  await page.waitForTimeout(2500);
  console.log("URL=", page.url());
  console.log("TITLE=", await page.title());
  console.log("PLACEHOLDERS=", JSON.stringify(await page.locator("input").evaluateAll((els) => els.map((e) => ({ placeholder: e.getAttribute("placeholder"), value: (e as HTMLInputElement).value, type: e.getAttribute("type") })))));
  console.log("BODY=", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 2500));
  console.log("BUTTONS=", JSON.stringify(await page.locator("button").allInnerTexts()));
  await page.screenshot({ path: "reports/order-A-list-probe.png", fullPage: true });
} finally {
  await finishSession(browser, session, "probe-order-list");
}
