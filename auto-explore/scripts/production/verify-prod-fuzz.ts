/**
 * 衣体入库边界值拦截 + 并发入库同一编号（双会话）
 * 边界：非数字 / 位数不一致 / 开始>结束 / 超500件
 * 并发：两个登录会话同时确认入库 AUTO-J101，验证唯一键兜底与友好提示
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login, saveStorageState } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function readNotices(page: Page): Promise<string> {
  const msg = await page.locator(".ant-message span").allInnerTexts().catch(() => [] as string[]);
  const notify = await page.locator(".ant-notification-notice-description").allInnerTexts().catch(() => [] as string[]);
  return [...msg, ...notify].filter(Boolean).join(" | ");
}

async function selectProfile(page: Page): Promise<void> {
  await page.locator(".profile-area .ant-select").first().click();
  await page.locator(".ant-select-item-option", { hasText: "AUTO-并发验证部件" }).first().click();
  await page.waitForTimeout(400);
}

async function tryRange(page: Page, start: string, end: string): Promise<string> {
  await page.getByPlaceholder("001").fill(start);
  await page.getByPlaceholder("005").fill(end);
  await page.getByRole("button", { name: /加\s*入/ }).click();
  await page.waitForTimeout(1200);
  return readNotices(page);
}

async function prepareIntake(browser: Browser, number: string, traceName: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: config.app.baseUrl,
    storageState: config.run.storageStatePath,
    recordVideo: { dir: `${config.run.traceDir}/${traceName}` },
  });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage();
  await page.goto("/production/intake");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await selectProfile(page);
  const single = page.getByPlaceholder("例：PTG26004");
  await single.fill(number);
  await single.press("Enter");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "确认全部入库" }).click();
  await page.locator(".ant-modal-confirm").waitFor({ state: "visible", timeout: 5000 });
  return { context, page };
}

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-prod-fuzz" });
  const page = session.page;
  try {
    // 一、边界值
    await login(page);
    await saveStorageState(session);
    await page.goto("/production/intake");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    await selectProfile(page);
    await page.locator(".ant-tabs-tab", { hasText: "连续范围" }).click();
    await page.getByPlaceholder("可留空").fill("AUTO-T");

    console.log("[fuzz] non-numeric:", await tryRange(page, "ABC", "010"));
    console.log("[fuzz] digit-mismatch:", await tryRange(page, "1", "010"));
    console.log("[fuzz] start>end:", await tryRange(page, "010", "001"));
    console.log("[fuzz] over-500:", await tryRange(page, "001", "501"));
    const header = await page.locator(".candidate-panel h2").innerText();
    console.log("[fuzz] candidate header after 4 invalid attempts:", header);
    await closeSession(session, "verify-prod-fuzz");

    // 二、并发入库 AUTO-J101
    const a = await prepareIntake(browser, "AUTO-J101", "concurrent-intake-A");
    const b = await prepareIntake(browser, "AUTO-J101", "concurrent-intake-B");
    const clickA = a.page.locator(".ant-modal-confirm").getByRole("button", { name: "确认入库" }).click();
    const clickB = b.page.locator(".ant-modal-confirm").getByRole("button", { name: "确认入库" }).click();
    await Promise.all([clickA, clickB]);
    await a.page.waitForTimeout(2500);
    await b.page.waitForTimeout(1000);
    const toastA = await readNotices(a.page);
    const toastB = await readNotices(b.page);
    console.log("[fuzz] concurrent toast A:", toastA);
    console.log("[fuzz] concurrent toast B:", toastB);
    await a.context.tracing.stop({ path: `${config.run.traceDir}/concurrent-intake-A.zip` }).catch(() => undefined);
    await b.context.tracing.stop({ path: `${config.run.traceDir}/concurrent-intake-B.zip` }).catch(() => undefined);
    await a.context.close();
    await b.context.close();

    const parts = await db.snapshot("p", "SELECT part_id, part_no, active_part_no FROM prop_part_item WHERE part_no='AUTO-J101'");
    const products = await db.snapshot("pr", "SELECT product_id, manufacturing_no, active_manufacturing_no, m_no FROM prop_product WHERE manufacturing_no='AUTO-J101'");
    console.log("[fuzz] db parts AUTO-J101:", JSON.stringify(parts.rows));
    console.log("[fuzz] db products AUTO-J101:", JSON.stringify(products.rows));

    console.log("---- VERDICT ----");
    const activeParts = parts.rows.filter((r) => r.active_part_no !== null);
    const activeProducts = products.rows.filter((r) => r.active_manufacturing_no !== null);
    const friendly = !/Duplicate|SQL|syntax|constraint/i.test(toastA + toastB);
    console.log(activeParts.length === 1 && activeProducts.length === 1
      ? `PASS: 并发入库同一编号仅落一条有效档案（parts=${parts.rows.length} products=${products.rows.length}），唯一键兜底生效。`
      : `FAIL: 并发后有效档案数异常 parts=${activeParts.length} products=${activeProducts.length}`);
    console.log(friendly
      ? "PASS: 并发失败/跳过提示友好，无 SQL 原始错误外泄。"
      : "FAIL: 提示中包含 SQL/约束原始信息，需人工复核。");
    console.log("边界值四类拦截提示见上方输出（非数字/位数/大小/500上限）。");
  } finally {
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[fuzz] FAILED:", e.message); process.exit(1); });
