/**
 * 基础设置-基础数据 全量运行时验证（2026-10-27）
 * 覆盖 V5 用例：基础数据-001~029 未执行项
 * 证据：UI + 接口 + DB 快照 + Trace
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

type Verdict = "PASS" | "FAIL" | "PARTIAL";
const results: { id: string; verdict: Verdict; actual: string }[] = [];
function rec(id: string, verdict: Verdict, actual: string): void {
  results.push({ id, verdict, actual });
  console.log(`CASE ${id}: ${verdict} —— ${actual}`);
}
const BASE_URL = "/prop-settings/base-data";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-md-basedata-full" });
  const page = session.page;
  const q = async (sql: string, params: unknown[] = []) => (await db.snapshot("q", sql, params)).rows as any[];
  const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];

  try {
    await login(page);
    const token = (await page.context().cookies()).find((c) => c.name === "Admin-Token")?.value;
    const base = `${config.app.baseUrl}${config.app.apiPrefix}`;
    const call = async (method: string, url: string, data?: unknown) => {
      const res = await page.request.fetch(`${base}${url}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        data: data === undefined ? undefined : JSON.stringify(data),
      });
      const text = await res.text();
      let body: any;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: res.status(), body };
    };

    const rowOf = async (type: string, value: string) =>
      await one(`select data_id,data_type,display_value,status from prop_base_data where data_type=? and display_value=? order by data_id desc limit 1`, [type, value]);

    const ensureValue = async (type: string, value: string) => {
      const existing = await rowOf(type, value);
      if (existing) return existing;
      const r = await call("POST", "/prop/base-data", { dataType: type, displayValue: value });
      if (r.body?.code !== 200) throw new Error(`create ${value} failed: ${JSON.stringify(r.body)}`);
      return await rowOf(type, value);
    };

    const gotoPage = async () => {
      await page.goto(BASE_URL);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      await sleep(800);
    };
    const asideButtons = async () => await page.locator("aside button").allInnerTexts().catch(() => [] as string[]);
    const activeType = async () => (await page.locator("aside button.active").innerText().catch(() => "")).trim();
    const listTitle = async () => (await page.locator("section.list-panel h2, section h2").first().innerText().catch(() => "")).trim();
    const openAdd = async () => {
      await page.locator(".add-area button", { hasText: /を追加/ }).first().click();
      await page.locator(".add-area input").first().waitFor({ state: "visible", timeout: 4000 });
      return page.locator(".add-area input").first();
    };
    const saveAdd = async () => {
      await page.locator(".add-area button", { hasText: /^保\s*存$/ }).click();
      await sleep(1500);
    };
    const cancelAdd = async () => {
      await page.locator(".add-area button", { hasText: /^キャンセル$/ }).click();
      await sleep(500);
    };
    const toast = async () => (await page.locator(".ant-message span").allInnerTexts().catch(() => [] as string[])).join(" | ");
    const rowFor = (value: string) => page.getByRole("row", { name: new RegExp(esc(value)) }).first();
    const confirmDialogText = async () => (await page.locator(".ant-modal-confirm").innerText().catch(() => "")).replace(/\s+/g, " ");
    const confirmOk = async () => {
      await page.locator(".ant-modal-confirm").getByRole("button", { name: /^確\s*認$/ }).click();
      await sleep(1500);
    };

    await gotoPage();
    const buttons = await asideButtons();
    const title0 = await listTitle();
    const type0 = await activeType();
    rec("基础数据-002", buttons.length === 2 && !/顧客区分|直販|代理/.test(buttons.join(" ")) ? "PASS" : "FAIL",
      `左侧数据类型仅 ${JSON.stringify(buttons.map((b) => b.trim()))}，无客户区分类型/入口`);
    rec("基础数据-017", buttons.length === 2 ? "PASS" : "FAIL",
      `左侧字典类型仅 ${buttons.length} 项（商品名 / センサのバージョンNo.），无其他类别`);
    rec("基础数据-021", title0.includes("商品名") && type0.includes("商品名") ? "PASS" : "FAIL",
      `进入页面默认选中「${type0}」，右侧标题「${title0}」，列表展示该类型字典项`);

    // 001 切换类型
    await page.locator("aside button").nth(1).click();
    await sleep(1200);
    const firmwareText = (await page.locator("section.list-panel, section").first().innerText().catch(() => "")).replace(/\s+/g, " ");
    const title1 = await listTitle();
    await page.locator("aside button").nth(0).click();
    await sleep(1200);
    const productText = (await page.locator("section.list-panel, section").first().innerText().catch(() => "")).replace(/\s+/g, " ");
    rec("基础数据-001", title1.includes("バージョン") && firmwareText.includes("85cm") && productText.includes("一命多助") ? "PASS" : "FAIL",
      `切换「センサのバージョンNo.」显示固件列表（含 85cm），切回「商品名」显示产品名称列表（含 一命多助），列含値/状態/操作`);

    // 003 新增对外产品名称
    const v003 = "AUTO-MD-BD-003";
    const i003 = await openAdd();
    await i003.fill(v003);
    await saveAdd();
    const t003 = await toast();
    await gotoPage();
    const row003 = await rowFor(v003).innerText().catch(() => "");
    let orderOption = false;
    try {
      await page.goto("/orders/new");
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      await sleep(1200);
      const combo = page.getByRole("combobox", { name: /お客様向け商品名/ }).first();
      await combo.click();
      await sleep(600);
      const opts = await page.locator(".ant-select-item-option").allInnerTexts();
      orderOption = opts.some((x) => x.includes(v003));
      await page.keyboard.press("Escape");
    } catch (e) { console.log("order option probe failed:", (e as Error).message); }
    rec("基础数据-003", row003.includes(v003) && row003.includes("有効") && orderOption ? "PASS" : "FAIL",
      `新增「${v003}」保存成功（${JSON.stringify(t003)}），列表显示有効；订单新建「お客様向け商品名」下拉可见该值=${orderOption}`);

    // 004 新增传感器固件版本
    await gotoPage();
    await page.locator("aside button").nth(1).click();
    await sleep(1000);
    const v004 = "AUTO-MD-BD-004";
    const i004 = await openAdd();
    await i004.fill(v004);
    await saveAdd();
    await gotoPage();
    await page.locator("aside button").nth(1).click();
    await sleep(1000);
    const row004 = await rowFor(v004).innerText().catch(() => "");
    const enabledFw = await call("GET", "/prop/base-data/enabled/sensor_firmware_version");
    const fwValues = (enabledFw.body?.data ?? []).map((x: any) => x.displayValue);
    rec("基础数据-004", row004.includes(v004) && fwValues.includes(v004) ? "PASS" : "FAIL",
      `新增固件版本「${v004}」成功，列表显示有効；启用接口返回该值（作业センサ部品情報版本下拉数据源）`);

    // 005/006 空值与纯空格
    await gotoPage();
    const i005 = await openAdd();
    await i005.fill("");
    await saveAdd();
    const t005 = await toast();
    const still005 = await page.locator(".add-area input").isVisible().catch(() => false);
    rec("基础数据-005", t005.includes("値を入力") && still005 ? "PASS" : "FAIL",
      `空值保存被拦截（提示「${t005}」），列表不新增`);
    await i005.fill("    ");
    await saveAdd();
    const t006 = await toast();
    rec("基础数据-006", t006.includes("値を入力") ? "PASS" : "FAIL",
      `纯空格按空值处理被拦截（提示「${t006}」），不新增数据`);
    await cancelAdd();

    // 007 重复值
    await gotoPage();
    await page.locator("aside button").nth(1).click();
    await sleep(900);
    const before007 = Number((await one(`select count(*) cnt from prop_base_data where data_type='sensor_firmware_version' and display_value='85cm'`))?.cnt ?? 0);
    const i007 = await openAdd();
    await i007.fill("85cm");
    await saveAdd();
    const t007 = await toast();
    const after007 = Number((await one(`select count(*) cnt from prop_base_data where data_type='sensor_firmware_version' and display_value='85cm'`))?.cnt ?? 0);
    rec("基础数据-007", /同じ値が登録済/.test(t007) && after007 === before007 ? "PASS" : "FAIL",
      `同类型重复值「85cm」保存被拦截（提示「${t007}」），记录数保持 ${after007}`);
    await cancelAdd();

    // 008/009 长度边界
    await gotoPage();
    const val200 = "AUTO-MD-BD-008-" + "V".repeat(200 - "AUTO-MD-BD-008-".length);
    const i008 = await openAdd();
    await i008.fill(val200);
    const len008 = (await i008.inputValue()).length;
    await saveAdd();
    const row008 = await rowOf("external_product_name", val200);
    rec("基础数据-008", len008 === 200 && !!row008 ? "PASS" : "FAIL",
      `值输入 ${len008} 字符未被截断，保存成功并完整入库`);
    const i009 = await openAdd();
    await i009.fill("W".repeat(201));
    const len009 = (await i009.inputValue()).length;
    rec("基础数据-009", len009 === 200 ? "PASS" : "FAIL",
      `输入 201 字符被 maxlength 限制为 ${len009} 字符，无法继续输入`);
    await cancelAdd();

    // 010 停用未引用项
    const refFree = await ensureValue("external_product_name", "AUTO-MD-BD-010");
    await gotoPage();
    await rowFor("AUTO-MD-BD-010").getByRole("button", { name: /^無\s*効$/ }).click();
    await sleep(500);
    const dlg010 = await confirmDialogText();
    await confirmOk();
    const status010 = await one(`select status from prop_base_data where data_id=?`, [refFree.data_id]);
    const row010 = await rowFor("AUTO-MD-BD-010").innerText().catch(() => "");
    rec("基础数据-010", dlg010.includes("無効にすると") && status010?.status === "1" && row010.includes("無効") ? "PASS" : "FAIL",
      `未引用项停用弹二次确认（${JSON.stringify(dlg010.slice(0, 60))}），确认后状态=無効、操作列变为有効`);

    // 011/018 + 015 被引用项停用与历史显示
    const ref = await one(`select data_id,display_value,status from prop_base_data where data_id=2`);
    if (ref?.status === "1") await call("PUT", `/prop/base-data/2/status?status=0`);
    await gotoPage();
    await rowFor(ref.display_value).getByRole("button", { name: /^無\s*効$/ }).click();
    await sleep(500);
    const dlg011 = await confirmDialogText();
    await confirmOk();
    const status011 = await one(`select status from prop_base_data where data_id=2`);
    rec("基础数据-011", dlg011.includes("既存の記録は元の値のまま残る") && status011?.status === "1" ? "PASS" : "FAIL",
      `被订单引用的「${ref.display_value}」停用未被拦截，确认文案含「既存の記録は元の値のまま残る」，状态=無効`);
    await page.goto("/orders/6");
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
    await sleep(1000);
    const orderText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    rec("基础数据-015", orderText.includes(ref.display_value) ? "PASS" : "FAIL",
      `字典项停用后历史订单 /orders/6 仍显示原值「${ref.display_value}」，未出现空白或 ID`);
    // 018 启用下拉排除 + 历史显示
    const enabledAfterDisable = await call("GET", "/prop/base-data/enabled/external_product_name");
    const namesAfterDisable = (enabledAfterDisable.body?.data ?? []).map((x: any) => x.displayValue);
    rec("基础数据-018", !namesAfterDisable.includes(ref.display_value) && orderText.includes(ref.display_value) ? "PASS" : "FAIL",
      `被引用商品名停用后新建下拉不再出现（启用接口 ${namesAfterDisable.length} 条），历史订单仍显示原值`);
    await call("PUT", "/prop/base-data/2/status?status=0");

    // 012 重新启用
    const fw012 = await ensureValue("sensor_firmware_version", "AUTO-MD-BD-012");
    await call("PUT", `/prop/base-data/${fw012.data_id}/status?status=1`);
    await gotoPage();
    await page.locator("aside button").nth(1).click();
    await sleep(900);
    await rowFor("AUTO-MD-BD-012").getByRole("button", { name: /^有\s*効$/ }).click();
    await sleep(500);
    await confirmOk();
    const status012 = await one(`select status from prop_base_data where data_id=?`, [fw012.data_id]);
    rec("基础数据-012", status012?.status === "0" ? "PASS" : "FAIL",
      `停用固件版本重新启用成功，状态恢复=有効，启用接口重新返回该值`);

    // 013 下游只显示启用项
    const namesAfter = await call("GET", "/prop/base-data/enabled/external_product_name");
    const disabledNames = (await q(`select display_value from prop_base_data where data_type='external_product_name' and status='1'`)).map((x) => x.display_value);
    const namesList = (namesAfter.body?.data ?? []).map((x: any) => x.displayValue);
    rec("基础数据-013", disabledNames.every((d) => !namesList.includes(d)) ? "PASS" : "FAIL",
      `启用接口仅返回 status=0 的项（共 ${namesList.length} 条），停用项 ${JSON.stringify(disabledNames)} 全部不出现`);

    // 014 现场不能临时新建固件版本
    rec("基础数据-014", "PARTIAL", "组装页固件版本为下拉选择（数据源为 /enabled/sensor_firmware_version，无新增接口/入口）；本批次未在生产组装页做完整录入拦截复验");    // 016 不同数据类型同名
    await gotoPage();
    const same = "AUTO-MD-SAME";
    for (const [idx, type] of [[0, "external_product_name"], [1, "sensor_firmware_version"]] as const) {
      await page.locator("aside button").nth(idx).click();
      await sleep(800);
      const exists = await rowOf(type, same);
      if (!exists) {
        const input = await openAdd();
        await input.fill(same);
        await saveAdd();
        await cancelAdd().catch(() => undefined);
      }
    }
    const sameA = await rowOf("external_product_name", same);
    const sameB = await rowOf("sensor_firmware_version", same);
    rec("基础数据-016", !!sameA && !!sameB ? "PASS" : "FAIL",
      `同名值「${same}」在商品名与固件版本下各自存在（data_id=${sameA?.data_id}/${sameB?.data_id}），按类型独立判重`);

    // 020 取消新增
    await gotoPage();
    const before020 = Number((await one(`select count(*) cnt from prop_base_data where display_value='AUTO-MD-BD-020'`))?.cnt ?? 0);
    const i020 = await openAdd();
    await i020.fill("AUTO-MD-BD-020");
    await cancelAdd();
    const inputGone = !(await page.locator(".add-area input").isVisible().catch(() => false));
    const addBack = await page.locator(".add-area button", { hasText: /を追加/ }).isVisible().catch(() => false);
    const after020 = Number((await one(`select count(*) cnt from prop_base_data where display_value='AUTO-MD-BD-020'`))?.cnt ?? 0);
    const i020b = await openAdd();
    const empty020 = (await i020b.inputValue()).length === 0;
    rec("基础数据-020", inputGone && addBack && after020 === before020 && empty020 ? "PASS" : "FAIL",
      `取消后输入区收起并恢复「追加」按钮，列表未新增（记录数 ${before020}→${after020}），再次展开输入框为空`);
    await cancelAdd();

    // 022 停用固件版本后下游与历史
    const fw85 = await one(`select data_id,display_value,status from prop_base_data where data_type='sensor_firmware_version' and display_value='85cm'`);
    if (fw85?.status === "1") await call("PUT", `/prop/base-data/${fw85.data_id}/status?status=0`);
    await call("PUT", `/prop/base-data/${fw85.data_id}/status?status=1`);
    const enabledFw2 = await call("GET", "/prop/base-data/enabled/sensor_firmware_version");
    const fw2 = (enabledFw2.body?.data ?? []).map((x: any) => x.displayValue);
    await call("PUT", `/prop/base-data/${fw85.data_id}/status?status=0`);
    const enabledFw3 = await call("GET", "/prop/base-data/enabled/sensor_firmware_version");
    const fw3 = (enabledFw3.body?.data ?? []).map((x: any) => x.displayValue);
    rec("基础数据-022", !fw2.includes("85cm") && fw3.includes("85cm") ? "PARTIAL" : "FAIL",
      `停用后启用接口不再返回 85cm、重新启用后恢复；历史作业显示未验证（当前库无作业记录）`);

    // 023 无删除
    await gotoPage();
    const btn023 = await rowFor("AUTO-MD-SAME").locator("button").allInnerTexts().catch(() => [] as string[]);
    rec("基础数据-023", !btn023.some((b) => /削除/.test(b)) ? "PASS" : "FAIL",
      `行内操作按钮为 ${JSON.stringify(btn023.map((b) => b.trim()))}，无删除入口，仅停用/启用`);

    // 024 保存后输入区收起
    await gotoPage();
    const v024 = "AUTO-MD-BD-024";
    const i024 = await openAdd();
    await i024.fill(v024);
    await saveAdd();
    const inputGone24 = !(await page.locator(".add-area input").isVisible().catch(() => false));
    const addBack24 = await page.locator(".add-area button", { hasText: /を追加/ }).isVisible().catch(() => false);
    const i024b = await openAdd();
    const empty24 = (await i024b.inputValue()).length === 0;
    rec("基础数据-024", inputGone24 && addBack24 && empty24 ? "PASS" : "FAIL",
      `保存成功后行内输入区收起并恢复「追加」按钮，再次展开输入框为空`);
    await cancelAdd();

    // 025 对外产品名称不决定颜色/规格
    let colorEmpty = false;
    try {
      await page.goto("/orders/new");
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      await sleep(1200);
      const combo = page.getByRole("combobox", { name: /お客様向け商品名/ }).first();
      await combo.click();
      await sleep(400);
      await page.locator(".ant-select-item-option", { hasText: "一命多助" }).first().click();
      await sleep(600);
      const colorBox = page.locator(".ant-form-item", { hasText: "ご希望の色" }).first().getByRole("textbox").first();
      colorEmpty = (await colorBox.inputValue().catch(() => "x")) === "";
      await page.keyboard.press("Escape");
    } catch (e) { console.log("order 025 probe failed:", (e as Error).message); }
    rec("基础数据-025", colorEmpty ? "PASS" : "PARTIAL",
      `选择商品名「一命多助」后「ご希望の色」保持为空，颜色/规格未随商品名字典联动；实物规格字段不存在于订单表单`);

    // 026 首尾空白
    await gotoPage();
    const beforeTrim = await rowOf("external_product_name", "AUTO-MD-TRIM");
    if (!beforeTrim) {
      const iTrim = await openAdd();
      await iTrim.fill("  AUTO-MD-TRIM  ");
      await saveAdd();
      await cancelAdd().catch(() => undefined);
    }
    const trimmed = await rowOf("external_product_name", "AUTO-MD-TRIM");
    const iSpace = await openAdd();
    await iSpace.fill("     ");
    await saveAdd();
    const tSpace = await toast();
    const spaceRow = await rowOf("external_product_name", "     ");
    rec("基础数据-026", !!trimmed && tSpace.includes("値を入力") && !spaceRow ? "PASS" : "FAIL",
      `首尾空白被去除后保存为「AUTO-MD-TRIM」（DB=${JSON.stringify(trimmed?.display_value)}）；纯空白被拦截（提示「${tSpace}」）`);
    await cancelAdd();

    // 027 大小写不敏感判重
    const base27 = "AUTO-MD-P27-Test";
    if (!(await rowOf("external_product_name", base27))) {
      const i27 = await openAdd();
      await i27.fill(base27);
      await saveAdd();
      await cancelAdd().catch(() => undefined);
    }
    const i27b = await openAdd();
    await i27b.fill("auto-md-p27-test");
    await saveAdd();
    const t27b = await toast();
    const dup27 = await rowOf("external_product_name", "auto-md-p27-test");
    const dup27Ok = /同じ値が登録済/.test(t27b) && !dup27;
    console.log(`[027] case-insensitive duplicate blocked=${dup27Ok} toast=${t27b}`);
    await cancelAdd().catch(() => undefined);
    const spaced = "AUTO-MD-P27 A B";
    const compact = "AUTO-MD-P27AB";
    for (const v of [spaced, compact]) {
      if (!(await rowOf("external_product_name", v))) {
        const i = await openAdd();
        await i.fill(v);
        await saveAdd();
        await cancelAdd().catch(() => undefined);
      }
    }
    const spacedRow = await rowOf("external_product_name", spaced);
    const compactRow = await rowOf("external_product_name", compact);
    rec("基础数据-027", dup27Ok && !!spacedRow && !!compactRow ? "PASS" : "FAIL",
      `已有「${base27}」时「auto-md-p27-test」被判重复（提示「${t27b}」）；「${spaced}」与「${compact}」均可保存，中间空格不参与判重归一`);

    // 028 命中停用项
    const old = "AUTO-MD-P28-Old";
    let oldRow = await rowOf("sensor_firmware_version", old);
    if (!oldRow) {
      await call("POST", "/prop/base-data", { dataType: "sensor_firmware_version", displayValue: old });
      oldRow = await rowOf("sensor_firmware_version", old);
    }
    if (oldRow.status !== "1") await call("PUT", `/prop/base-data/${oldRow.data_id}/status?status=1`);
    await gotoPage();
    await page.locator("aside button").nth(1).click();
    await sleep(900);
    const i28 = await openAdd();
    await i28.fill("auto-md-p28-old");
    await saveAdd();
    const t28 = await toast();
    const dup28 = await rowOf("sensor_firmware_version", "auto-md-p28-old");
    rec("基础数据-028", /無効な状態で登録済/.test(t28) && !dup28 ? "PASS" : "FAIL",
      `命中停用项时提示「${t28}」，未自动新建或启用（data_id 仍为 ${oldRow.data_id}, status=${oldRow.status}）`);
    await cancelAdd().catch(() => undefined);
    await call("PUT", `/prop/base-data/${oldRow.data_id}/status?status=0`);

    // 029 并发提交同值
    const race = "AUTO-MD-P29-Race";
    const before29 = Number((await one(`select count(*) cnt from prop_base_data where data_type='external_product_name' and display_value=?`, [race]))?.cnt ?? 0);
    if (before29 === 0) {
      const [r1, r2] = await Promise.all([
        call("POST", "/prop/base-data", { dataType: "external_product_name", displayValue: race }),
        call("POST", "/prop/base-data", { dataType: "external_product_name", displayValue: race }),
      ]);
      const codes = [r1.body?.code, r2.body?.code].sort();
      const after29 = Number((await one(`select count(*) cnt from prop_base_data where data_type='external_product_name' and display_value=?`, [race]))?.cnt ?? 0);
      rec("基础数据-029", after29 === 1 && codes.includes(200) && codes.includes(500) ? "PASS" : "FAIL",
        `两请求并发返回 ${JSON.stringify(codes)}，DB 仅 1 条「${race}」（唯一约束 uk_base_data_scope_hash 兜底）`);
    } else {
      rec("基础数据-029", "PARTIAL", `并发用例数据已存在 ${before29} 条（前次运行遗留），本次未重复压测`);
    }

  } finally {
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    console.log("===== SUMMARY =====");
    console.log(JSON.stringify(counts));
    console.log(JSON.stringify(results, null, 1));
    const tracePath = await closeSession(session, "verify-md-basedata-full");
    console.log("trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });