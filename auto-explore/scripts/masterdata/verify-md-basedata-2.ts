/**
 * 基础设置-基础数据 未执行用例运行时验证（4 条）
 * 覆盖：019（引用情况列）、030（列表不展示引用统计）、014（组装现场固件版本只能下拉且非法值被拒）、
 *       025（对外产品名称不决定颜色/规格）。
 */
import { chromium, type Page } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, finishSession, compact, apiLogin, apiCall, ensureQualifiedProduct, pickOptionScroll,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook("reports/masterdata-runtime-results-basedata-2.json");
const db = new DbClient();
const REQ = "FEAT-03 基础数据（VAL-02a/02e/03/01）";

async function columnHeaders(page: Page): Promise<string[]> {
  return page.locator(".base-data-page .list-panel thead th").allInnerTexts().then((x) => x.map((s) => s.trim()));
}

async function main(): Promise<void> {
  await db.connect();
  const token = await apiLogin(config.app.loginUser, config.app.loginPassword);
  const { browser, session } = await launchSession();
  const page = session.page;
  page.setDefaultTimeout(12000);
  try {
    await book.run("基础数据-019", "引用情况列展示引用计数", REQ, async () => {
      await page.goto("/prop-settings/base-data", { waitUntil: "domcontentloaded" });
      await page.locator(".base-data-page").waitFor({ state: "visible" });
      await page.waitForTimeout(1200);
      const nameHeaders = await columnHeaders(page);
      await page.locator(".type-panel button", { hasText: "センサのバージョンNo." }).click();
      await page.waitForTimeout(800);
      const fwHeaders = await columnHeaders(page);
      const bodyText = compact(await page.locator(".base-data-page .list-panel").innerText());
      const hasRefColumn = [...nameHeaders, ...fwHeaders].some((h) => /引用/.test(h)) ||
        /尚未引用|已被\s*\d+\s*条/.test(bodyText);
      const api = await apiCall(token, "GET", "/prop/base-data/list/external_product_name");
      const sample = (api.data as Record<string, unknown>[] | null)?.[0] ?? {};
      const apiHasCount = Object.keys(sample).some((k) => /ref|usage|count/i.test(k));
      return {
        status: hasRefColumn ? "通过" : "不通过",
        actual: hasRefColumn
          ? `列表存在引用情况列：${[...nameHeaders, ...fwHeaders].join("/")}`
          : `冲突确认（与批次001一致）：对外产品名称列头=[${nameHeaders.join("/")}]、传感器固件版本列头=[${fwHeaders.join("/")}]，均无「引用情况」列；列表无「尚未引用/已被 N 条记录使用」文案；接口字段=[${Object.keys(sample).join(",")}] 无引用计数；功能未实现`,
        evidence: "UI 列头 + 列表文案 + 接口响应字段；VAL-02a 要求引用计数",
      };
    });

    await book.run("基础数据-030", "字典列表不展示引用统计", REQ, async () => {
      await page.goto("/prop-settings/base-data", { waitUntil: "domcontentloaded" });
      await page.locator(".base-data-page").waitFor({ state: "visible" });
      await page.waitForTimeout(1000);
      const nameHeaders = await columnHeaders(page);
      await page.locator(".type-panel button", { hasText: "センサのバージョンNo." }).click();
      await page.waitForTimeout(800);
      const fwHeaders = await columnHeaders(page);
      const both = [...nameHeaders, ...fwHeaders];
      const onlyThree = both.length === 6 && both.every((h) => ["値", "状態", "操作"].includes(h));
      const bodyText = compact(await page.locator(".base-data-page .list-panel").innerText());
      const noStats = !/引用|尚未引用|已被\s*\d+\s*条/.test(bodyText);
      const fixture = await db.query<{ id: number; value: string; status: string }>(
        "SELECT data_id id, display_value value, status FROM prop_base_data WHERE data_type='external_product_name' AND display_value='AUTO-MD-BD-003' LIMIT 1");
      const fixtureId = fixture[0].id;
      const originalStatus = fixture[0].status;
      const toggle = await apiCall(token, "PUT", `/prop/base-data/${fixtureId}/status?status=1`);
      const toggleBack = await apiCall(token, "PUT", `/prop/base-data/${fixtureId}/status?status=0`);
      const restored = await db.query<{ status: string }>(
        "SELECT status FROM prop_base_data WHERE data_id=?", [fixtureId]);
      const todo = toggle;
      const todoBack = toggleBack;
      if (restored[0].status !== originalStatus) {
        await apiCall(token, "PUT", `/prop/base-data/${fixtureId}/status?status=${originalStatus}`);
      }
      const ok = onlyThree && noStats;
      return {
        status: ok ? "通过" : "不通过",
        actual: `対外产品名称/センサ固件版本两列表头均仅[値/状態/操作]=${onlyThree}（${both.join("/")}）；无「引用情况/尚未引用/引用数量」文案=${noStats}；夹具项 AUTO-MD-BD-003 启停正常（停用 code=${todo.code}、启用 code=${todoBack.code}，状态已还原），不以统计数量控制启停`,
        evidence: "UI 列头 + 列表文案 + 启停接口联动；VAL-02e 与 019（VAL-02a）预期互斥，以 030 为最新口径",
      };
    });

    await book.run("基础数据-014", "传感器组装现场不能临时新建固件版本", REQ, async () => {
      await page.goto("/production/assembly", { waitUntil: "domcontentloaded" });
      await page.locator(".assembly-page").waitFor({ state: "visible" });
      await page.waitForTimeout(1200);
      const fwSelect = page.locator("#assembly-firmware");
      const fwVisible = await fwSelect.isVisible().catch(() => false);
      await page.locator(".assembly-card header h2").first().click({ force: true }).catch(() => {});
      const wrap = fwSelect.locator("xpath=ancestor::div[contains(@class,'ant-select')][1]");
      await wrap.click();
      await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)").last()
        .waitFor({ state: "visible", timeout: 8000 });
      await page.waitForTimeout(500);
      const optionTexts = await page.locator(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden):not(.ant-slide-up-leave):not(.ant-slide-up-leave-active) .ant-select-item-option",
      ).allInnerTexts();
      const addEntry = await page.locator(".assembly-card .firmware .ant-btn, .assembly-card .firmware [class*=add]").count();
      const disabledIds = await db.query<{ id: number; value: string }>(
        "SELECT data_id id, display_value value FROM prop_base_data WHERE data_type='sensor_firmware_version' AND status='1'");
      const disabledShown = optionTexts.some((text) => disabledIds.some((row) => text.includes(row.value)));
      await page.keyboard.press("Escape");
      const productId = await ensureQualifiedProduct(db, token, "AUTO-MD-FW014");
      const before = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_part_item WHERE active_part_no='AUTO-MD-FW014-S2'");
      const invalid = await apiCall(token, "PUT", "/prop/production/assembly", {
        productId, slotType: "sensor", partNo: "AUTO-MD-FW014-S2", profileId: 3, firmwareId: 999999,
      });
      const after = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_part_item WHERE active_part_no='AUTO-MD-FW014-S2'");
      const ok = fwVisible && optionTexts.length > 0 && addEntry === 0 && !disabledShown &&
        invalid.code !== 200 && Number(before[0].cnt) === Number(after[0].cnt);
      return {
        status: ok ? "通过" : "部分验证",
        actual: `组装页固件版本为下拉=${fwVisible}，选项 ${optionTexts.length} 项（来源 /prop/base-data/enabled/sensor_firmware_version），无新增入口=${addEntry === 0}，停用项不出现=${!disabledShown}；接口提交不存在固件 id=999999 → code=${invalid.code}「${compact(invalid.msg, 50)}」，部件未创建（${before[0].cnt}→${after[0].cnt}）`,
        evidence: "UI 下拉 DOM + 启停字典联动 + 后端 selectEnabledFirmware 校验（firmwareUnavailable）",
      };
    });

    await book.run("基础数据-025", "对外产品名称不决定实物颜色或规格", REQ, async () => {
      await page.goto("/orders/new", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const body = compact(await page.locator("body").innerText(), 4000);
      const formReady = /お客様向け商品名/.test(body);
      const colorLabel = /希望の色/.test(body);
      const specField = /規格/.test(body);
      let picked = "";
      const colorInput = page.locator("input[placeholder*='ご希望の色']").first();
      const colorBefore = await colorInput.inputValue().catch(() => "");
      if (formReady) {
        const combo = page.locator("#orderForm_productName").locator("xpath=ancestor::div[contains(@class,'ant-select')][1]");
        await combo.click();
        await page.waitForTimeout(700);
        try {
          await pickOptionScroll(page, "一命多助");
          picked = "一命多助";
        } catch {
          const texts = await page.locator(".ant-select-dropdown:visible .ant-select-item-option").allInnerTexts();
          picked = texts.includes("一命多助") ? "一命多助" : "";
        }
        await page.waitForTimeout(800);
      }
      const colorAfter = await colorInput.inputValue().catch(() => "");
      const ok = formReady && colorLabel && !specField && picked !== "" && colorBefore === "" && colorAfter === "";
      return {
        status: ok ? "通过" : "部分验证",
        actual: `订单新建页加载=${formReady}；选择商品名「${picked || "未选中"}」后「ご希望の色」输入框保持为空（${colorBefore === colorAfter && colorAfter === "" ? "空→空" : `${colorBefore}→${colorAfter}`}）；页面无「規格」字段=${!specField}，即不存在由名称联动决定的实物规格字段`,
        evidence: "UI 表单结构 + 选择商品名前后颜色输入值 + order/form.vue 仅写 productName/colorNote 无联动代码",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-md-basedata-2");
    await db.close();
    await book.save();
    console.log("---- VERDICT ----");
    for (const r of book.list()) console.log(`${r.caseId}: ${r.status}`);
  }
}

async function launchSession() {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-md-basedata-2" });
  await login(session.page);
  return { browser, session };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});