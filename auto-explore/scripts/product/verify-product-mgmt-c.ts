/**
 * 产品管理 C 批（详情路径 / 更换衣体 / 部件追溯筛选）运行时验证：3 条。
 * 覆盖：产品详情展示-012、产品部件操作-013、部件追溯-004。
 * 夹具：产品 35（资料路径，测后恢复 AUTO-PM-PATH-35）、AUTO-PM-C-BODY（更换衣体，测后清理）。
 */
import { chromium, type Page } from "playwright";
import { writeFileSync } from "node:fs";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, apiLogin, apiCall, apiBase, finishSession, compact,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook("reports/product-mgmt-runtime-results-c.json");
const db = new DbClient();
const REQ = "FEAT-08/09 产品管理（路径/衣体/追溯）";
const PATH_NO = "AUTO-PM-PATH-35";
const C_NO = "AUTO-PM-C-BODY";
const FIXTURE_PATH = "reports/product-mgmt-c-fixtures.json";
let token = "";
let page: Page;
const FIX: { productId: number; partId: number; bindingId: number; eventId: number } = {
  productId: 0, partId: 0, bindingId: 0, eventId: 0,
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const text = async (locator: import("playwright").Locator) => compact(await locator.innerText().catch(() => ""));

async function cleanupCBody(): Promise<void> {
  const rows = await db.query<{ product_id: number; part_id: number | null }>(
    `SELECT p.product_id, (SELECT b.part_id FROM prop_product_binding b WHERE b.product_id=p.product_id LIMIT 1) part_id
       FROM prop_product p WHERE p.manufacturing_no=?`, [C_NO]);
  for (const row of rows) {
    await db.execute("DELETE FROM prop_production_event WHERE product_id=?", [row.product_id]);
    await db.execute("DELETE FROM prop_product_binding WHERE product_id=?", [row.product_id]);
    if (row.part_id) await db.execute("DELETE FROM prop_part_item WHERE part_id=?", [row.part_id]);
    await db.execute("DELETE FROM prop_product WHERE product_id=?", [row.product_id]);
  }
}

async function seedCBody(): Promise<void> {
  await cleanupCBody();
  const product = await db.execute(
    `INSERT INTO prop_product (manufacturing_no, active_manufacturing_no, m_no, create_by, create_time, initial_production_inspection_passed)
     VALUES (?, ?, 'MCBODY1', 'AI自动探索', NOW(), 0)`, [C_NO, C_NO]);
  FIX.productId = Number(product.insertId);
  const part = await db.execute(
    `INSERT INTO prop_part_item (part_no, active_part_no, part_type, source_type, current_profile_id, current_profile_version_id, create_by, create_time)
     VALUES (?, ?, 'jacket', 'intake', 1, 12, 'AI自动探索', NOW())`, [C_NO, C_NO]);
  FIX.partId = Number(part.insertId);
  const binding = await db.execute(
    `INSERT INTO prop_product_binding (product_id, part_id, slot_type, active_slot_key, active_part_key, started_by, started_time)
     VALUES (?, ?, 'body', ?, ?, 'AI自动探索', NOW())`,
    [FIX.productId, FIX.partId, `${FIX.productId}:body`, String(FIX.partId)]);
  FIX.bindingId = Number(binding.insertId);
  const event = await db.execute(
    `INSERT INTO prop_production_event (event_type, product_id, part_id, binding_id, after_profile_version_id, event_content, create_by, create_time)
     VALUES ('PRODUCT_CREATED', ?, ?, ?, 12, 'ジャケット入庫・製品登録', 'AI自动探索', NOW())`,
    [FIX.productId, FIX.partId, FIX.bindingId]);
  FIX.eventId = Number(event.insertId);
  writeFileSync(FIXTURE_PATH, JSON.stringify(FIX, null, 2), "utf-8");
}

async function restorePath(value: string | null): Promise<void> {
  await apiCall(token, "PUT", "/prop/production/products/35/storage-path", { storagePath: value });
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
  await seedCBody();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-mgmt-c" });
  page = session.page;
  page.setDefaultTimeout(15000);
  await login(page);
  try {
    await book.run("产品详情展示-012", "资料存放路径录入后保存", REQ, async () => {
      await page.goto("/products/35", { waitUntil: "domcontentloaded" });
      await page.locator(".storage-path").waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(1200);
      const currentPath = await text(page.locator(".storage-path"));
      if (currentPath !== PATH_NO) {
        await restorePath(PATH_NO);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.locator(".storage-path").waitFor({ state: "visible", timeout: 20000 });
        await page.waitForTimeout(1000);
      }
      const initial = await text(page.locator(".storage-path"));

      const modal = await openPathEditor();
      const input = modal.locator("input").first();
      const openedValue = await input.inputValue();
      await input.fill("AUTO-PM-PATH-ENTER");
      await input.press("Enter");
      await page.waitForTimeout(700);
      const enterStillOpen = await modal.isVisible().catch(() => false);
      const enterApi = await apiCall(token, "GET", "/prop/production/products/35");
      const enterSaved = String((enterApi.data as any)?.storagePath ?? "");

      await input.fill("AUTO-PM-PATH-BLUR");
      await modal.locator(".ant-modal-title").click();
      await page.waitForTimeout(700);
      const blurStillOpen = await modal.isVisible().catch(() => false);
      const blurApi = await apiCall(token, "GET", "/prop/production/products/35");
      const blurSaved = String((blurApi.data as any)?.storagePath ?? "");

      await modal.getByRole("button", { name: /キャンセル/ }).click();
      await modal.waitFor({ state: "hidden", timeout: 10000 });
      const reopened = await openPathEditor();
      const reopenedValue = await reopened.locator("input").first().inputValue();
      await reopened.getByRole("button", { name: /キャンセル/ }).click();
      await reopened.waitFor({ state: "hidden", timeout: 10000 });

      const saveModal = await openPathEditor();
      const saveInput = saveModal.locator("input").first();
      await saveInput.fill("AUTO-PM-PATH-C-SAVED");
      await page.route("**/storage-path", async (route) => {
        await sleep(1600);
        await route.continue().catch(() => undefined);
      });
      const saveButton = saveModal.getByRole("button", { name: /保\s*存/ });
      await saveButton.click();
      await page.waitForTimeout(350);
      const during = {
        input: await saveInput.isDisabled().catch(() => false),
        cancel: await saveModal.getByRole("button", { name: /キャンセル/ }).isDisabled().catch(() => false),
        save: await saveButton.isDisabled().catch(() => false),
        loading: (await saveButton.locator(".ant-btn-loading-icon").count().catch(() => 0)) > 0,
      };
      await page.waitForTimeout(1800);
      await page.unroute("**/storage-path").catch(() => undefined);
      await page.waitForTimeout(800);
      const savedText = await text(page.locator(".storage-path"));
      const savedApi = await apiCall(token, "GET", "/prop/production/products/35");
      const savedApiValue = String((savedApi.data as any)?.storagePath ?? "");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".storage-path").waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(1000);
      const refreshedText = await text(page.locator(".storage-path"));

      const clearModal = await openPathEditor();
      await clearModal.locator("input").first().fill("");
      await clearModal.getByRole("button", { name: /保\s*存/ }).click();
      await page.waitForTimeout(1800);
      const clearedText = await text(page.locator(".storage-path"));
      const clearedApi = await apiCall(token, "GET", "/prop/production/products/35");
      const clearedApiValue = (clearedApi.data as any)?.storagePath ?? null;

      await restorePath(PATH_NO);
      const restoreApi = await apiCall(token, "GET", "/prop/production/products/35");

      const editingDisabled = during.input && during.cancel && (during.save || during.loading);
      const ok = initial === PATH_NO && openedValue === PATH_NO && enterStillOpen && blurStillOpen &&
        enterSaved === PATH_NO && blurSaved === PATH_NO && reopenedValue === PATH_NO &&
        savedText === "AUTO-PM-PATH-C-SAVED" && savedApiValue === "AUTO-PM-PATH-C-SAVED" &&
        refreshedText === "AUTO-PM-PATH-C-SAVED" && clearedText === "—" && clearedApiValue === null &&
        editingDisabled && (restoreApi.data as any)?.storagePath === PATH_NO;
      return {
        status: ok ? "通过" : "不通过",
        actual: `已保存值=「${initial}」、弹窗初值=「${openedValue}」；Enter 后弹窗=${enterStillOpen}、API=「${enterSaved}」；失焦后弹窗=${blurStillOpen}、API=「${blurSaved}」；取消后重开=「${reopenedValue}」；保存后详情=「${savedText}」/API=「${savedApiValue}」/刷新=「${refreshedText}」；保存中输入禁用=${during.input}、取消禁用=${during.cancel}、保存禁用=${during.save}、loading=${during.loading}；清空后=「${clearedText}」/API=${clearedApiValue === null ? "null" : `「${clearedApiValue}」`}；恢复 A 批夹具=${(restoreApi.data as any)?.storagePath}`,
        evidence: "详情页资料路径编辑弹窗 + Enter/失焦/取消/保存/清空全链路 + GET /products/35 回查 + 刷新 + 延迟 PUT 检查 loading 禁用",
      };
    });

    await book.run("产品部件操作-013", "更换衣体确认后即完成事件登记", REQ, async () => {
      await page.goto(`/products/${FIX.productId}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "ジャケット交換" }).waitFor({ state: "visible", timeout: 20000 });
      await page.waitForTimeout(800);
      const before = await apiCall(token, "GET", `/prop/production/products/${FIX.productId}`);
      const beforeData = before.data as any;
      const beforeBindings = JSON.stringify((beforeData?.bindings ?? []).map((item: any) => ({ bindingId: item.bindingId, partId: item.partId, slotType: item.slotType })));
      const beforeEvents = (beforeData?.events ?? []).length;

      await page.getByRole("button", { name: "ジャケット交換" }).click();
      const confirm = page.locator(".ant-modal-confirm:visible").last();
      await confirm.waitFor({ state: "visible", timeout: 10000 });
      const confirmText = await text(confirm);
      await confirm.getByRole("button", { name: /キャンセル/ }).click();
      await page.waitForTimeout(900);
      const afterCancel = await apiCall(token, "GET", `/prop/production/products/${FIX.productId}`);
      const cancelEvents = ((afterCancel.data as any)?.events ?? []).length;

      await page.getByRole("button", { name: "ジャケット交換" }).click();
      const confirm2 = page.locator(".ant-modal-confirm:visible").last();
      await confirm2.getByRole("button", { name: /交換を登録/ }).click();
      await page.waitForTimeout(2200);
      const after = await apiCall(token, "GET", `/prop/production/products/${FIX.productId}`);
      const afterData = after.data as any;
      const afterBindings = JSON.stringify((afterData?.bindings ?? []).map((item: any) => ({ bindingId: item.bindingId, partId: item.partId, slotType: item.slotType })));
      const events = (afterData?.events ?? []) as Array<Record<string, unknown>>;
      const replaced = events.filter((item) => item.eventType === "BODY_PHYSICAL_REPLACED");
      const bindingSame = beforeBindings === afterBindings;
      const oneEvent = events.length === beforeEvents + 1 && replaced.length === 1;
      const wording = confirmText.includes("実物の交換が完了したことを確認する") && confirmText.includes("変わらない");

      await page.waitForTimeout(500);
      const productionTab = page.locator(".ant-tabs-tab", { hasText: /生産と部品|生产与部件|生産/ }).first();
      if (await productionTab.isVisible().catch(() => false)) await productionTab.click();
      await page.waitForTimeout(800);
      const historyText = await text(page.locator(".ant-timeline").first());
      const historyVisible = historyText.includes("ジャケット交換");

      const ok = confirmText.includes("ジャケット交換を登録する") && wording && cancelEvents === beforeEvents &&
        bindingSame && oneEvent && historyVisible;
      return {
        status: ok ? "通过" : "不通过",
        actual: `弹窗=「${compact(confirmText, 160)}」；取消后事件数 ${beforeEvents}→${cancelEvents}；确认后事件数=${events.length}（BODY_PHYSICAL_REPLACED=${replaced.length}）；绑定/部件不变=${bindingSame}（${beforeBindings}）；历史页签显示「ジャケット交換」=${historyVisible}`,
        evidence: "详情页ジャケット交換确认弹窗 + 取消/确认两次调用 + GET /products 回查 bindings/events + 生产与部件页签",
      };
    });

    await book.run("部件追溯-004", "部件资料筛选关联正确", REQ, async () => {
      await page.goto("/products/parts", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      await page.locator("tbody tr.ant-table-row").first().waitFor({ state: "visible", timeout: 20000 });
      const beforeTotal = await text(page.locator(".toolbar span").last());
      const select = page.locator(".ant-select", { has: page.locator("#part-profileId") }).first();
      await select.click();
      await page.waitForTimeout(600);
      const dropdown = page.locator(".ant-select-dropdown:visible").last();
      const option = dropdown.locator(".ant-select-item-option", { hasText: "衣体 オレンジ 标准型123" }).first();
      const holder = dropdown.locator(".rc-virtual-list-holder").first();
      for (let i = 0; i < 60; i++) {
        if ((await option.count()) > 0 && (await option.isVisible().catch(() => false))) break;
        if (await holder.count()) {
          await holder.evaluate((el) => { el.scrollTop = Math.min(el.scrollTop + el.clientHeight * 0.5, el.scrollHeight); });
        } else {
          await page.mouse.wheel(0, 120);
        }
        await page.waitForTimeout(180);
      }
      if (!(await option.isVisible().catch(() => false))) {
        const visibleOptions = await dropdown.locator(".ant-select-item-option").allInnerTexts().catch(() => []);
        throw new Error(`资料选项未找到，当前可见：${visibleOptions.slice(0, 12).join(" | ")}`);
      }
      const optionText = await text(option);
      const filteredPromise = page.waitForResponse(
        (r) => r.url().includes("/prop/production/parts?") && r.url().includes("profileId=1"),
        { timeout: 15000 },
      );
      await option.click();
      await filteredPromise;
      await page.waitForTimeout(1200);
      const totalText = await text(page.locator(".toolbar span").last());
      const rows = page.locator("tbody tr.ant-table-row");
      const rowCount = await rows.count();
      const partNos: string[] = [];
      const profiles: string[] = [];
      for (let i = 0; i < rowCount; i++) {
        partNos.push(compact(await rows.nth(i).locator("td").nth(0).innerText().catch(() => "")));
        profiles.push(compact(await rows.nth(i).locator("td").nth(2).innerText().catch(() => "")));
      }
      const resp = await fetch(`${apiBase}/prop/production/parts?profileId=1&pageNum=1&pageSize=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const raw = (await resp.json()) as any;
      const apiRows = (raw.rows ?? []) as Array<Record<string, unknown>>;
      const apiTotal = Number(raw.total ?? apiRows.length);
      const apiPartNos = apiRows.map((row) => String(row.partNo ?? ""));
      const allProfileOne = apiRows.length > 0 && apiRows.every((row) => Number(row.profileId) === 1);
      const sameSet = apiPartNos.length === partNos.length && apiPartNos.every((no) => partNos.includes(no));
      const countMatch = rowCount === apiTotal && totalText.includes(String(apiTotal));
      const names = Array.from(new Set(profiles));
      return {
        status: allProfileOne && sameSet && countMatch ? "通过" : "不通过",
        actual: `筛选前总数=${beforeTotal}；选项=「${optionText}」；选择后（未点查询）总数=「${totalText}」、列表 ${rowCount} 行；API profileId=1 total=${apiTotal}、全部归属资料 1=${allProfileOne}；partNo 集合一致=${sameSet}；行数一致=${countMatch}；当前资料列显示名=${JSON.stringify(names)}（其中「衣体 オレンジ 标准型」为同资料旧版本名）`,
        evidence: "部件追溯页资料下拉（@change 即时查询）+ 筛选响应监听 + partNo 集合比对 + GET /parts?profileId=1 原始 rows/profileId 校验",
      };
    });
  } finally {
    await restorePath(PATH_NO).catch(() => undefined);
    await finishSession(browser, session, "verify-product-mgmt-c");
    await cleanupCBody();
    writeFileSync(FIXTURE_PATH, JSON.stringify({ ...FIX, removedAt: new Date().toISOString() }, null, 2), "utf-8");
    await db.close();
  }
}

main().catch(async (error) => {
  console.error("[product-c] FAILED:", error);
  await restorePath(PATH_NO).catch(() => undefined);
  await cleanupCBody().catch(() => undefined);
  await db.close().catch(() => undefined);
  process.exit(1);
});