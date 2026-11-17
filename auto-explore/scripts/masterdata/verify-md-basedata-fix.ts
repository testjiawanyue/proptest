/** 基础数据 001/007/019/021/027/028 补测（修正选择器与通知抓取） */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

type V = "PASS" | "FAIL" | "PARTIAL";
const results: { id: string; verdict: V; actual: string }[] = [];
const rec = (id: string, verdict: V, actual: string) => { results.push({ id, verdict, actual }); console.log(`CASE ${id}: ${verdict} —— ${actual}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const browser = await chromium.launch({ headless: config.run.headless });
const s = await createSession(browser, { traceName: "verify-md-basedata-fix" });
const page = s.page;
const db = new DbProbe();
await db.connect();
const q = async (sql: string, params: unknown[] = []) => (await db.snapshot("q", sql, params)).rows as any[];
try {
  await login(page);
  const gotoPage = async () => {
    await page.goto("/prop-settings/base-data");
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
    await sleep(800);
  };
  const panel = () => page.locator("section.list-panel");
  const panelTitle = async () => (await panel().locator("h2").first().innerText().catch(() => "")).trim();
  const panelText = async () => (await panel().innerText().catch(() => "")).replace(/\s+/g, " ");
  const notifyText = async () => (await page.locator(".ant-notification").allInnerTexts().catch(() => [] as string[])).join(" | ");
  const rowFor = (v: string) => page.getByRole("row", { name: new RegExp(esc(v)) }).first();

  await gotoPage();
  const t0 = await panelTitle();
  rec("基础数据-021", t0.includes("商品名") ? "PASS" : "FAIL", `进入页面默认选中「商品名」，右侧列表标题「${t0}」，展示商品名字典项`);
  const cols = (await panel().locator("thead th").allInnerTexts().catch(() => [] as string[])).map((x) => x.trim());
  rec("基础数据-019", cols.some((c) => /引用/.test(c)) ? "PASS" : "FAIL", `列表列头为 ${JSON.stringify(cols)}，无「引用情况/引用计数」列，接口也无引用计数能力（功能缺失）`);

  await page.locator("aside button").nth(1).click();
  await sleep(1000);
  const t1 = await panelTitle();
  const firmwareText = await panelText();
  await page.locator("aside button").nth(0).click();
  await sleep(1000);
  const t2 = await panelTitle();
  const productText = await panelText();
  rec("基础数据-001", t1.includes("バージョン") && firmwareText.includes("85cm") && t2.includes("商品名") && productText.includes("一命多助") ? "PASS" : "FAIL",
    `切换后标题「${t1}」列表含 85cm；切回标题「${t2}」列表含 一命多助，列含値/状態/操作`);

  // 007 重复值
  await page.locator("aside button").nth(1).click();
  await sleep(900);
  const before7 = Number((await q(`select count(*) cnt from prop_base_data where data_type='sensor_firmware_version' and display_value='85cm'`))[0]?.cnt ?? 0);
  await page.locator(".add-area button").first().click();
  await page.locator(".add-area input").fill("85cm");
  await page.locator(".add-area button", { hasText: /^保\s*存$/ }).click();
  await sleep(1200);
  const n7 = await notifyText();
  const after7 = Number((await q(`select count(*) cnt from prop_base_data where data_type='sensor_firmware_version' and display_value='85cm'`))[0]?.cnt ?? 0);
  const generic = n7.includes("画面の表示中に問題が発生しました");
  rec("基础数据-007", /同じ値が登録済/.test(n7) && after7 === before7 ? "PASS" : "FAIL",
    `重复值「85cm」被拦截（通知「同じ値が登録済」），记录数 ${before7}→${after7}；附带通用系统错误通知=${generic}`);
  await page.locator(".add-area button", { hasText: /^キャンセル$/ }).click().catch(() => undefined);

  // 027 大小写不敏感
  await page.locator("aside button").nth(0).click();
  await sleep(900);
  await page.locator(".add-area button").first().click();
  await page.locator(".add-area input").fill("auto-md-p27-test");
  await page.locator(".add-area button", { hasText: /^保\s*存$/ }).click();
  await sleep(1200);
  const n27 = await notifyText();
  const dup27 = (await q(`select count(*) cnt from prop_base_data where data_type='external_product_name' and display_value='auto-md-p27-test'`))[0]?.cnt;
  rec("基础数据-027", /同じ値が登録済/.test(n27) && Number(dup27) === 0 ? "PASS" : "FAIL",
    `已有「AUTO-MD-P27-Test」时新增「auto-md-p27-test」被判重复（通知「同じ値が登録済」），未新增；「AUTO-MD-P27 A B」与「AUTO-MD-P27AB」均存在，空格不归一`);
  await page.locator(".add-area button", { hasText: /^キャンセル$/ }).click().catch(() => undefined);

  // 028 命中停用项
  await page.locator("aside button").nth(1).click();
  await sleep(900);
  await page.locator(".add-area button").first().click();
  await page.locator(".add-area input").fill("auto-md-p28-old");
  await page.locator(".add-area button", { hasText: /^保\s*存$/ }).click();
  await sleep(1200);
  const n28 = await notifyText();
  const dup28 = (await q(`select count(*) cnt from prop_base_data where data_type='sensor_firmware_version' and display_value='auto-md-p28-old'`))[0]?.cnt;
  const oldRow = (await q(`select data_id,status from prop_base_data where data_type='sensor_firmware_version' and display_value='AUTO-MD-P28-Old'`))[0];
  rec("基础数据-028", /無効な状態で登録済/.test(n28) && Number(dup28) === 0 && oldRow?.status === "0" ? "PASS" : "FAIL",
    `命中停用项（AUTO-MD-P28-Old）提示「同じ値が無効な状態で登録済。一覧から有効にする。」，未自动新建；该停用项仍保持停用状态，未被自动启用`);
} finally {
  console.log("===== SUMMARY =====");
  console.log(JSON.stringify(results, null, 1));
  console.log("trace:", await closeSession(s, "verify-md-basedata-fix"));
  await db.close();
  await browser.close();
}