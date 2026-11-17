import { launchAdminSession, finishSession } from "./order-runtime-utils.js";
const { browser, session } = await launchAdminSession("probe-order-list-search");
const page = session.page;
try {
  const responses: string[] = [];
  page.on("response", async (r) => {
    if (r.url().includes("/prop/order/list")) {
      const body = await r.text().catch(() => "");
      responses.push(r.url() + " => " + body.slice(0, 300));
    }
  });
  await page.goto("/orders/index");
  await page.waitForTimeout(2200);
  console.log("URL1=", page.url());
  console.log("PLACEHOLDERS=", JSON.stringify(await page.locator("input").evaluateAll((els) => els.map((e) => e.getAttribute("placeholder")))));
  console.log("BUTTONS=", JSON.stringify(await page.locator("button").allInnerTexts()));
  console.log("SEARCH_ACTIONS=", (await page.locator(".search-actions").innerText().catch(() => "NONE")).replace(/\s+/g, " "));
  const kw = page.getByPlaceholder("注文管理番号／お客様注文番号／注文先／納品先");
  await kw.fill("ZZZ-NO-MATCH-ORDER-A");
  const button = page.locator(".search-actions button", { hasText: "検索" }).first();
  console.log("BUTTON_COUNT=", await page.locator(".search-actions button", { hasText: "検索" }).count(), "VISIBLE=", await button.isVisible().catch(() => false));
  await button.click();
  await page.waitForTimeout(2500);
  console.log("URL2=", page.url());
  console.log("RESPONSES=", JSON.stringify(responses));
  console.log("BODY_HEAD=", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1600));
  await page.screenshot({ path: "reports/order-A-list-search-probe.png", fullPage: true });
} finally {
  await finishSession(browser, session, "probe-order-list-search");
}
