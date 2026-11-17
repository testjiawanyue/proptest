/**
 * 产品管理 D1 批运行时验证：详情-013（生产与部件去重）、列表查询-012（分页 + NAS 保存保护）。
 * 夹具：产品 35（资料路径，测后恢复 AUTO-PM-PATH-35）、产品 24（空路径，用于不串产品）。
 */
import { chromium, type Page } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, apiLogin, apiCall, apiBase, finishSession, compact,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook("reports/product-mgmt-runtime-results-d1.json");
const db = new DbClient();
const REQ = "FEAT-08 产品管理（事件 / 分页 / NAS 保护）";
const PATH_NO = "AUTO-PM-PATH-35";
let token = "";
let page: Page;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = async (locator: import("playwright").Locator) => compact(await locator.innerText().catch(() => ""));

const PRODUCTION_TYPES = new Set([
  "PRODUCT_CREATED", "PRODUCT_NAME_CHANGED", "INSPECTION_PASSED", "PART_INSTALLED", "PART_REMOVED",
  "PART_REPLACED", "PROFILE_CORRECTED", "FIRMWARE_SET", "FIRMWARE_UPDATED", "FIRMWARE_ADOPTED",
  "BODY_PHYSICAL_REPLACED",
]);
function category(event: any): string | null {
  const type = String(event?.eventType ?? "");
  if (PRODUCTION_TYPES.has(type)) return "production";
  if (/^(SHIPMENT_|ORDER_)/.test(type)) return "shipment";
  if (/^(SERVICE_|INSPECTION_SERVICE_)/.test(type)) return "service";
  if (/^(RETURN_|RECOVERED|SCRAPPED)/.test(type)) return "return";
  return null;
}

async function restorePath(value: string | null): Promise<void> {
  await apiCall(token, "PUT", "/prop/production/products/35/storage-path", { storagePath: value });
}

async function openFullList(): Promise<void> {
  await page.goto("/products/list", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.locator("thead th").first().waitFor({ state: "visible", timeout: 20000 });
  const stage = page.locator(".ant-select", { has: page.locator("#product-stage") }).first();
  await stage.hover();
  await page.waitForTimeout(300);
  if (await stage.locator(".ant-select-clear").isVisible().catch(() => false)) {
    await stage.locator(".ant-select-clear").click();
    await page.waitForTimeout(2500);
  }
  await page.locator("tbody tr.ant-table-row").first().waitFor({ state: "visible", timeout: 20000 });
}

async function switchPageSize(size: string): Promise<void> {
  await page.locator(".ant-pagination-options").first().waitFor({ state: "visible" });
  await page.locator(".ant-pagination-options .ant-select-selector").first().click();
  await page.waitForTimeout(300);
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: size }).first().click();
  await page.waitForTimeout(1600);
}

async function pageState(): Promise<{ total: string; active: string; rows: number; size: string }> {
  const total = await text(page.locator(".ant-pagination-total-text"));
  const active = await text(page.locator(".ant-pagination-item-active"));
  const rows = await page.locator("tbody tr.ant-table-row").count();
  const size = await text(page.locator(".ant-pagination-options .ant-select-selection-item"));
  return { total, active, rows, size };
}

async function openPathEditor(): Promise<import("playwright").Locator> {
  const cell = page.locator(".ant-descriptions-item-content", { has: page.locator(".storage-path") }).first();
  await cell.getByRole("button", { name: /編集/ }).click();
  const modal = page.locator(".ant-modal:visible").filter({ has: page.locator('input[aria-label="資料の保存先"]') }).last();
  await modal.waitFor({ state: "visible", timeout: 10000 });
  await modal.locator("input").first().waitFor({ state: "visible" });
  return modal;
}

async function main(): Promise<void> {
  await db.connect();
  token = await apiLogin(config.app.loginUser, config.app.loginPassword);
  await restorePath(PATH_NO);
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-mgmt-d1" });
  page = session.page;
  page.setDefaultTimeout(15000);
  await login(page);
  try {
    await book.run("产品详情展示-013", "生产与部件合并展示及去重", REQ, async () => {
      await page.goto("/products/35", { waitUntil: "domcontentloaded" });
      await page.locator(".ant-tabs").first().waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(1500);
      const api = await apiCall(token, "GET", "/prop/production/products/35");
      const events = ((api.data as any)?.events ?? []) as Array<Record<string, unknown>>;
      const expectedAll = events.filter((item) => category(item) !== null).length;
      const expectedProduction = events.filter((item) => category(item) === "production").length;

      const allItems = page.locator(".ant-timeline-item");
      const allCount = await allItems.count();
      const allTexts = (await allItems.allInnerTexts()).map((item) => compact(item));
      const typeCounts = events.reduce((acc, item) => {
        const type = String(item.eventType ?? "");
        acc[type] = (acc[type] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      await page.locator(".ant-tabs-tab", { hasText: "生産・部品" }).first().click();
      await page.waitForTimeout(1000);
      const prodCount = await allItems.count();
      const prodTexts = (await allItems.allInnerTexts()).map((item) => compact(item));
      const unique = new Set(prodTexts).size;
      const allSuperset = prodTexts.every((item) => allTexts.includes(item));
      const badWording = prodTexts.some((item) => /判定でき|不明|无法判定|判定不能/.test(item));
      const actors = Array.from(new Set(events.filter((item) => category(item) === "production").map((item) => String(item.createBy ?? "system"))));
      const actorsShown = actors.every((actor) => allTexts.some((item) => item.includes(actor)));

      const categories = new Set(events.map((item) => category(item)));
      const covered = {
        installed: (typeCounts.PART_INSTALLED ?? 0) > 0,
        removed: (typeCounts.PART_REMOVED ?? 0) > 0,
        profileCorrected: (typeCounts.PROFILE_CORRECTED ?? 0) > 0,
        firmwareChanged: (typeCounts.FIRMWARE_UPDATED ?? 0) > 0 || (typeCounts.FIRMWARE_SET ?? 0) > 0,
      };
      const coreOk = allCount === expectedAll && prodCount === expectedProduction && unique === prodCount && allSuperset && !badWording && actorsShown;
      const full = coreOk && covered.removed && covered.profileCorrected && covered.firmwareChanged;
      return {
        status: full ? "通过" : coreOk ? "部分验证" : "不通过",
        actual: `全部页签 ${allCount} 条（期望 ${expectedAll}）、生产与部件 ${prodCount} 条（期望 ${expectedProduction}）；事件类型分布=${JSON.stringify(typeCounts)}；生产与部件去重后 ${unique} 条；全部页签为超集=${allSuperset}；文案无“无法判定”=${!badWording}；操作人显示=${actors.join("/")}（全部出现=${actorsShown}）；分类集合=${JSON.stringify(Array.from(categories))}；覆盖安装=${covered.installed}/拆除=${covered.removed}/资料更正=${covered.profileCorrected}/固件变化=${covered.firmwareChanged}`,
        evidence: "GET /products/35 events + 全部/生产与部件页签时间线 DOM 条数与文本比对 + 类型分类映射",
      };
    });

    await book.run("产品列表查询-012", "分页条数与NAS请求保护", REQ, async () => {
      await openFullList();
      const base = await pageState();
      await switchPageSize("10");
      const at10 = await pageState();
      const second = page.locator(".ant-pagination-item-2").first();
      if (await second.isVisible().catch(() => false)) {
        await second.click();
        await page.waitForTimeout(1200);
      }
      const afterPage2 = await pageState();
      await switchPageSize("20");
      const at20 = await pageState();
      await switchPageSize("50");
      const at50 = await pageState();
      await switchPageSize("100");
      const at100 = await pageState();

      await page.locator('input[aria-label="接頭辞"]').fill("AUTO-PM-PAGE-0");
      await page.locator('input[aria-label="開始番号"]').fill("01");
      await page.locator('input[aria-label="終了番号"]').fill("04");
      await page.getByRole("button", { name: /検\s*索|查\s*询/ }).click();
      await page.waitForTimeout(1800);
      const filtered = await pageState();
      await switchPageSize("10");
      const filtered10 = await pageState();
      const sizeSwitchOk = at10.active === "1" && at20.active === "1" && at50.active === "1" && at100.active === "1" &&
        at20.rows === Number(base.total.match(/\d+/)?.[0] ?? 0) || (at20.rows === 20);
      const keepFilter = filtered.total.includes("4") && filtered10.total.includes("4") && filtered10.rows === 4;
      const capResp = await fetch(`${apiBase}/prop/production/product-list?pageNum=1&pageSize=500`, { headers: { Authorization: `Bearer ${token}` } });
      const capRaw = (await capResp.json()) as any;
      const capCount = Array.isArray(capRaw.rows) ? capRaw.rows.length : 0;
      const capOk = capCount <= 100;

      await page.goto("/products/35", { waitUntil: "domcontentloaded" });
      await page.locator(".storage-path").waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(1000);
      const savedValue = await text(page.locator(".storage-path"));

      await page.route("**/storage-path", async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 500, msg: "AUTO模拟保存失败" }) });
      });
      const failModal = await openPathEditor();
      const failInput = failModal.locator("input").first();
      await failInput.fill("AUTO-PM-NAS-DRAFT");
      await failModal.getByRole("button", { name: /保\s*存/ }).click();
      await page.waitForTimeout(1200);
      const failOpen = await failModal.isVisible().catch(() => false);
      const failValue = await failInput.inputValue().catch(() => "");
      const failEditable = !(await failInput.isDisabled().catch(() => true));
      const failError = await text(failModal.locator(".ant-alert").first());
      const failApi = await apiCall(token, "GET", "/prop/production/products/35");
      const failApiValue = String((failApi.data as any)?.storagePath ?? "");
      await page.unroute("**/storage-path");
      await failModal.getByRole("button", { name: /キャンセル/ }).click();
      await failModal.waitFor({ state: "hidden", timeout: 10000 });
      const reopened = await openPathEditor();
      const reopenedValue = await reopened.locator("input").first().inputValue();
      await reopened.getByRole("button", { name: /キャンセル/ }).click();
      await reopened.waitFor({ state: "hidden", timeout: 10000 });

      await page.route("**/storage-path", async (route) => { await sleep(1600); await route.continue().catch(() => undefined); });
      const okModal = await openPathEditor();
      const okInput = okModal.locator("input").first();
      await okInput.fill("AUTO-PM-NAS-OK");
      const okButton = okModal.getByRole("button", { name: /保\s*存/ });
      await okButton.click();
      await page.waitForTimeout(350);
      const during = {
        input: await okInput.isDisabled().catch(() => false),
        cancel: await okModal.getByRole("button", { name: /キャンセル/ }).isDisabled().catch(() => false),
        save: await okButton.isDisabled().catch(() => false),
        loading: (await okButton.locator(".ant-btn-loading-icon").count().catch(() => 0)) > 0,
      };
      await page.keyboard.press("Escape");
      await page.locator(".ant-modal-mask").first().click({ force: true, position: { x: 5, y: 5 } }).catch(() => undefined);
      await page.waitForTimeout(250);
      const blockedClose = await okModal.isVisible().catch(() => false);
      await page.waitForTimeout(1800);
      await page.unroute("**/storage-path").catch(() => undefined);
      await page.waitForTimeout(700);
      const okClosed = !(await okModal.isVisible().catch(() => false));
      const okDetail = await text(page.locator(".storage-path"));
      const okApi = await apiCall(token, "GET", "/prop/production/products/35");
      const okApiValue = String((okApi.data as any)?.storagePath ?? "");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".storage-path").waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(900);
      const okRefresh = await text(page.locator(".storage-path"));

      await page.goto("/products/24", { waitUntil: "domcontentloaded" });
      await page.locator(".storage-path").waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(900);
      const p24 = await openPathEditor();
      const p24Value = await p24.locator("input").first().inputValue();
      await p24.getByRole("button", { name: /キャンセル/ }).click();
      await p24.waitFor({ state: "hidden", timeout: 10000 });

      await restorePath(PATH_NO);
      const restored = await apiCall(token, "GET", "/prop/production/products/35");

      const totalCount = Number(base.total.match(/\d+/)?.[0] ?? 0);
      const paginationOk = totalCount > 0 && base.rows === Math.min(20, totalCount) && at10.rows === Math.min(10, totalCount) &&
        at20.active === "1" && at20.rows === Math.min(20, totalCount) &&
        at50.active === "1" && at50.rows === Math.min(50, totalCount) &&
        at100.active === "1" && at100.rows === Math.min(100, totalCount) &&
        filtered10.active === "1" && keepFilter && capOk && afterPage2.active === "2";
      const nasOk = savedValue === PATH_NO && failOpen && failValue === "AUTO-PM-NAS-DRAFT" && failEditable &&
        failError.includes("AUTO模拟保存失败") && failApiValue === PATH_NO && reopenedValue === PATH_NO &&
        okClosed && okDetail === "AUTO-PM-NAS-OK" && okApiValue === "AUTO-PM-NAS-OK" && okRefresh === "AUTO-PM-NAS-OK" &&
        during.input && during.cancel && (during.save || during.loading) && blockedClose &&
        (p24Value === "" || p24Value === "—") && String((restored.data as any)?.storagePath ?? "") === PATH_NO;
      return {
        status: paginationOk && nasOk ? "部分验证" : "不通过",
        actual: `分页：总数=${base.total}、默认 ${base.size}/${base.rows} 行；10 条=${at10.rows} 行；翻第 2 页 active=${afterPage2.active}；切 20/50/100 后 active=${at20.active}/${at50.active}/${at100.active}、行数=${at20.rows}/${at50.rows}/${at100.rows}；筛选后 total=${filtered.total}、切 10 后 active=${filtered10.active}、行数=${filtered10.rows}；pageSize=500 返回 ${capCount} 行（≤100=${capOk}）。NAS：失败弹窗保持=${failOpen}、草稿=「${failValue}」、可编辑=${failEditable}、错误=「${compact(failError, 40)}」、API=「${failApiValue}」；取消后重开=「${reopenedValue}」；保存中输入/取消/保存禁用=${during.input}/${during.cancel}/${during.save}、loading=${during.loading}；Esc/遮罩后仍打开=${blockedClose}；成功关闭=${okClosed}、详情/API/刷新=「${okDetail}」/「${okApiValue}」/「${okRefresh}」；产品 24 弹窗值=「${p24Value}」；恢复夹具=${(restored.data as any)?.storagePath}。未覆盖：换衣体/部件保存/拆除/固件更新四类刷新来源及一般详情刷新不覆盖草稿`,
        evidence: "列表 10/20/50/100 + 筛选切换 + product-list pageSize=500；详情路径弹窗失败/成功/取消/重开/Esc/遮罩/跨产品 + API 与刷新回查",
      };
    });
  } finally {
    await page.unroute("**/storage-path").catch(() => undefined);
    await restorePath(PATH_NO).catch(() => undefined);
    await finishSession(browser, session, "verify-product-mgmt-d1");
    await db.close();
  }
}

main().catch(async (error) => {
  console.error("[product-d1] FAILED:", error);
  await restorePath(PATH_NO).catch(() => undefined);
  await db.close().catch(() => undefined);
  process.exit(1);
});