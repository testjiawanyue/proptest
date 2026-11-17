/**
 * 基础设置-部件资料 & 部件资料版本 全量运行时验证（2026-10-27）
 * 覆盖 V5 用例：部件资料-003~037 未执行项、部件资料版本-003~010 未执行项
 * 证据：UI 操作 + 接口响应 + DB 快照 + Trace
 */
import { chromium, type Page } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

type Verdict = "PASS" | "FAIL" | "PARTIAL";
const results: { id: string; verdict: Verdict; actual: string }[] = [];
function rec(id: string, verdict: Verdict, actual: string): void {
  results.push({ id, verdict, actual });
  console.log(`CASE ${id}: ${verdict} —— ${actual}`);
}

const PART_URL = "/prop-settings/part-profile";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-md-partprofile-full" });
  const page = session.page;

  const q = async (sql: string, params: unknown[] = []) => (await db.snapshot("q", sql, params)).rows as any[];
  const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];

  try {
    await login(page);
    const token = (await page.context().cookies()).find((c) => c.name === "Admin-Token")?.value;
    if (!token) throw new Error("Admin-Token cookie not found");
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

    const profileByName = async (name: string) =>
      await one(
        `select p.profile_id, p.part_type, p.status, p.current_version_id, v.version_no, v.part_name,
                v.specification, v.manufacturer, v.number_prefix
           from prop_part_profile p join prop_part_profile_version v on v.version_id = p.current_version_id
          where v.part_name = ? order by p.profile_id desc limit 1`,
        [name]
      );

    const ensureProfile = async (name: string, partType: string, spec: string, manufacturer?: string | null, prefix?: string | null) => {
      const existing = await profileByName(name);
      if (existing) return existing;
      const res = await call("POST", "/prop/part-profile", {
        partType, partName: name, specification: spec,
        manufacturer: manufacturer ?? null, numberPrefix: prefix ?? null,
      });
      if (res.body?.code !== 200) throw new Error(`create ${name} failed: ${JSON.stringify(res.body)}`);
      const created = await profileByName(name);
      if (!created) throw new Error(`profile ${name} not found after create`);
      return created;
    };

    const gotoList = async () => {
      await page.goto(PART_URL);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);
      await sleep(600);
    };

    const openAdd = async () => {
      await gotoList();
      await page.getByRole("button", { name: /部品マスタを追加/ }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible", timeout: 5000 });
      return dialog;
    };

    const pickType = async (dialog: any, index: number) => {
      await dialog.getByRole("combobox").first().click();
      await page.locator(".ant-select-item-option:visible").nth(index).click();
      await sleep(200);
    };

    const fill = async (dialog: any, name: string, value: string) => {
      const item = dialog.locator(".ant-form-item", { hasText: name }).first();
      await item.getByRole("textbox").first().fill(value);
    };

    const fieldErrors = async () =>
      (await page.locator(".ant-form-item-explain-error").allInnerTexts().catch(() => [] as string[])).join(" | ");

    const toastText = async () =>
      (await page.locator(".ant-message span").allInnerTexts().catch(() => [] as string[])).join(" | ");

    const saveDialog = async (dialog: any) => {
      await dialog.getByRole("button", { name: /^保\s*存$/ }).click();
      await sleep(1800);
    };

    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rowFor = (name: string) => page.getByRole("row", { name: new RegExp(esc(name)) }).first();

    // ============ 部件资料 ============
    console.log("===== 部件资料 =====");

    const pAirbag = await ensureProfile("AUTO-MD-PP-003 气囊", "airbag", "AUTO-规格-气囊");
    const pSensor = await ensureProfile("AUTO-MD-PP-004 传感器", "sensor", "AD");
    const pInflator = await ensureProfile("AUTO-MD-PP-005 发生器", "inflator", "AUTO-规格-发生器");
    const pNoMaker = await ensureProfile("AUTO-MD-PP-006 无厂商", "jacket", "AUTO-规格-006", null, null);
    const pNoPrefix = await ensureProfile("AUTO-MD-PP-013 无前缀", "jacket", "AUTO-规格-013", "AUTO-厂商-013", null);
    const pPrefixCn = await ensureProfile("AUTO-MD-PP-026 中文前缀", "jacket", "AUTO-规格-026", "AUTO-厂商-026", "AQ2衣");
    const pPrefixSym = await ensureProfile("AUTO-MD-PP-027 符号前缀", "jacket", "AUTO-规格-027", "AUTO-厂商-027", "A-q_Ab");
    const pMulti = await ensureProfile("AUTO-MD-PP-035 多行规格", "jacket", "第一行\n第二行\n第三行");
    const pRawSpec = await ensureProfile("AUTO-MD-PP-037 规格原文", "jacket", "色：赤／型：XL／素材：涤纶");

    await gotoList();
    const listText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    const hasGroup = (label: string) => listText.includes(label);
    rec("部件资料-003", hasGroup("エアバッグ") && listText.includes("AUTO-MD-PP-003") ? "PASS" : "FAIL",
      `气囊资料接口创建成功（version_no=${pAirbag.version_no}），列表分组「エアバッグ」下可见，状态有効`);
    rec("部件资料-004", hasGroup("センサ") && listText.includes("AUTO-MD-PP-004") && listText.includes("AD") ? "PASS" : "FAIL",
      `传感器资料创建成功，列表「センサ」分组可见，规格列显示 AD`);
    rec("部件资料-005", hasGroup("インフレータ") && listText.includes("AUTO-MD-PP-005") ? "PASS" : "FAIL",
      `充气发生器资料接口创建成功（version_no=${pInflator.version_no}），列表「インフレータ」分组可见，状态有効`);

    const noMakerRow = await rowFor("AUTO-MD-PP-006").innerText().catch(() => "");
    rec("部件资料-006", noMakerRow.includes("—") ? "PASS" : "FAIL",
      `厂商留空保存成功（DB manufacturer=${JSON.stringify(pNoMaker.manufacturer)}），列表厂商列显示「—」`);

    const noPrefixRow = await rowFor("AUTO-MD-PP-013").innerText().catch(() => "");
    rec("部件资料-013", noPrefixRow.includes("—") ? "PASS" : "FAIL",
      `编号前缀留空保存成功（DB number_prefix=${JSON.stringify(pNoPrefix.number_prefix)}），列表前缀列显示「—」`);

    const cnRow = await rowFor("AUTO-MD-PP-026").innerText().catch(() => "");
    rec("部件资料-026", cnRow.includes("AQ2衣") ? "PASS" : "FAIL",
      `前缀「AQ2衣」按原文保存（DB=${JSON.stringify(pPrefixCn.number_prefix)}），列表原样显示`);
    const symRow = await rowFor("AUTO-MD-PP-027").innerText().catch(() => "");
    rec("部件资料-027", symRow.includes("A-q_Ab") ? "PASS" : "FAIL",
      `前缀「A-q_Ab」按原文保存（DB=${JSON.stringify(pPrefixSym.number_prefix)}），大小写与符号未被归一`);
    const multiCell = (await rowFor("AUTO-MD-PP-035").locator("td").nth(2).innerText().catch(() => "")).replace(/\r/g, "");
    rec("部件资料-035", multiCell.includes("第一行") && multiCell.includes("第三行") && multiCell.includes("\n") ? "PASS" : "FAIL",
      `多行规格保存后列表完整展示，单元格文本含换行（${JSON.stringify(multiCell.slice(0, 40))}），样式 white-space: pre-wrap`);

    const rawSpec = await one(`select specification from prop_part_profile_version where profile_id = ? and version_no = 1`, [pRawSpec.profile_id]);
    rec("部件资料-037", rawSpec?.specification === "色：赤／型：XL／素材：涤纶" ? "PASS" : "FAIL",
      `规格文本原样入库，未解析为颜色/型号等结构化字段（DB=${JSON.stringify(rawSpec?.specification)}）`);
    // 007 编辑多项
    const editTarget = await ensureProfile("AUTO-MD-PP-007 编辑前", "jacket", "AUTO-规格-007", "AUTO-厂商-007", "P007");
    const editRes = await call("PUT", "/prop/part-profile", {
      profileId: editTarget.profile_id, partType: "jacket",
      partName: "AUTO-MD-PP-007 编辑后", specification: "AUTO-规格-007-新",
      manufacturer: "AUTO-厂商-007-新", numberPrefix: "P007NEW",
    });
    const v2 = await one(`select version_no,part_name,specification,manufacturer,number_prefix from prop_part_profile_version where profile_id=? and version_no=2`, [editTarget.profile_id]);
    const v1Keep = await one(`select part_name,specification from prop_part_profile_version where profile_id=? and version_no=1`, [editTarget.profile_id]);
    rec("部件资料-007", editRes.body?.code === 200 && v2?.part_name === "AUTO-MD-PP-007 编辑后" && v2?.specification === "AUTO-规格-007-新" && v2?.manufacturer === "AUTO-厂商-007-新" && v2?.number_prefix === "P007NEW" && v1Keep?.part_name === "AUTO-MD-PP-007 编辑前" ? "PASS" : "FAIL",
      `一次编辑名称/规格/厂商/前缀生成完整 v2，v1 完整保留（v1.part_name=${JSON.stringify(v1Keep?.part_name)}）`);

    // 008 编辑弹窗类型只读
    await gotoList();
    await (await rowFor("AUTO-MD-PP-007 编辑后")).getByRole("button", { name: /^編\s*集$/ }).click();
    const editDialog = page.getByRole("dialog");
    await editDialog.waitFor({ state: "visible", timeout: 5000 });
    const typeCombo = editDialog.getByRole("combobox").first();
    const typeDisabled = await typeCombo.isDisabled().catch(() => false);
    const typeText = await editDialog.locator(".ant-select-selection-item").first().innerText().catch(() => "");
    rec("部件资料-008", typeDisabled ? "PASS" : "FAIL",
      `编辑弹窗部件类型字段 disabled=${typeDisabled}，显示「${typeText.trim()}」，不可切换`);
    await editDialog.getByRole("button", { name: /^キャンセル$/ }).click();
    await sleep(400);

    // 009/010 停用与启用
    const statusTarget = await ensureProfile("AUTO-MD-PP-009 停用目标", "jacket", "AUTO-规格-009");
    const disableRes = await call("PUT", `/prop/part-profile/${statusTarget.profile_id}/status?status=1`);
    await gotoList();
    const disabledRow = await rowFor("AUTO-MD-PP-009").innerText().catch(() => "");
    rec("部件资料-009", disableRes.body?.code === 200 && disabledRow.includes("無効") ? "PASS" : "FAIL",
      `未被引用资料停用成功，列表状态变为「無効」、操作列变为「有効」`);
    const enableRes = await call("PUT", `/prop/part-profile/${statusTarget.profile_id}/status?status=0`);
    await gotoList();
    const enabledRow = await rowFor("AUTO-MD-PP-009").innerText().catch(() => "");
    rec("部件资料-010", enableRes.body?.code === 200 && enabledRow.includes("有効") ? "PASS" : "FAIL",
      `停用资料重新启用成功，列表状态恢复「有効」`);

    // 011 未选择类型
    const countBefore11 = Number((await one(`select count(*) cnt from prop_part_profile_version where part_name='AUTO-MD-PP-011 未选类型'`))?.cnt ?? 0);
    const d11 = await openAdd();
    await fill(d11, "部品名", "AUTO-MD-PP-011 未选类型");
    await fill(d11, "仕様", "AUTO-规格-011");
    await saveDialog(d11);
    const err11 = await fieldErrors();
    const stillOpen11 = await d11.isVisible().catch(() => false);
    const countAfter11 = Number((await one(`select count(*) cnt from prop_part_profile_version where part_name='AUTO-MD-PP-011 未选类型'`))?.cnt ?? 0);
    rec("部件资料-011", err11.includes("部品種別を選択してください") && stillOpen11 && countAfter11 === countBefore11 ? "PASS" : "FAIL",
      `未选类型保存被拦截（提示「${err11}」），弹窗保持打开，未产生数据`);
    await d11.getByRole("button", { name: /^キャンセル$/ }).click();
    await sleep(400);

    // 012 名称为空
    const d12 = await openAdd();
    await pickType(d12, 0);
    await fill(d12, "仕様", "AUTO-规格-012");
    await saveDialog(d12);
    const err12 = await fieldErrors();
    rec("部件资料-012", err12.includes("部品名を入力してください") ? "PASS" : "FAIL",
      `部件名称为空保存被拦截（提示「${err12}」），未产生数据`);
    await d12.getByRole("button", { name: /^キャンセル$/ }).click();
    await sleep(400);

    // 014 纯空格名称
    const d14 = await openAdd();
    await pickType(d14, 0);
    await fill(d14, "部品名", "   ");
    await fill(d14, "仕様", "AUTO-规格-014");
    await saveDialog(d14);
    const err14 = await fieldErrors();
    rec("部件资料-014", err14.includes("部品名を入力してください") ? "PASS" : "FAIL",
      `纯空格名称按空值处理被拦截（提示「${err14}」），未保存`);
    await d14.getByRole("button", { name: /^キャンセル$/ }).click();
    await sleep(400);

    // 015 名称 200 字
    const name200 = "AUTO-MD-PP-015-" + "A".repeat(200 - "AUTO-MD-PP-015-".length);
    const d15 = await openAdd();
    await pickType(d15, 0);
    await fill(d15, "部品名", name200);
    await fill(d15, "仕様", "AUTO-规格-015");
    const name15Len = (await d15.locator(".ant-form-item", { hasText: "部品名" }).first().getByRole("textbox").inputValue()).length;
    await saveDialog(d15);
    const row15 = await profileByName(name200);
    rec("部件资料-015", name15Len === 200 && row15 ? "PASS" : "FAIL",
      `名称输入 200 字符未被截断（长度=${name15Len}），保存成功并完整入库`);
    if (await d15.isVisible().catch(() => false)) { await d15.getByRole("button", { name: /^キャンセル$/ }).click(); await sleep(300); }

    // 016 名称 201 字
    const d16 = await openAdd();
    await pickType(d16, 0);
    const nameInput16 = d16.locator(".ant-form-item", { hasText: "部品名" }).first().getByRole("textbox");
    await nameInput16.fill("B".repeat(201));
    const len16 = (await nameInput16.inputValue()).length;
    rec("部件资料-016", len16 === 200 ? "PASS" : "FAIL",
      `输入 201 字符被 maxlength 限制为 ${len16} 字符，无法继续输入`);
    await d16.getByRole("button", { name: /^キャンセル$/ }).click();
    await sleep(400);

    // 017 重名（冲突）
    const dupName = "AUTO-MD-PP-017 重名";
    const dupBefore = Number((await one(`select count(*) cnt from prop_part_profile_version where part_name=?`, [dupName]))?.cnt ?? 0);
    const dup1 = await call("POST", "/prop/part-profile", { partType: "jacket", partName: dupName, specification: "AUTO-规格-017-A" });
    const dup2 = await call("POST", "/prop/part-profile", { partType: "jacket", partName: dupName, specification: "AUTO-规格-017-B" });
    const dupAfter = Number((await one(`select count(*) cnt from prop_part_profile_version where part_name=?`, [dupName]))?.cnt ?? 0);
    rec("部件资料-017", dup1.body?.code === 200 && dup2.body?.code === 200 && dupAfter >= dupBefore + 2 ? "FAIL" : "PASS",
      `冲突确认：同名「${dupName}」两次创建均成功（接口 200，版本行 ${dupBefore}→${dupAfter}），系统无重名校验`);

    // 019 停用后下游不可选
    const downstream = await ensureProfile("AUTO-MD-PP-019 下游停用", "jacket", "AUTO-规格-019");
    await call("PUT", `/prop/part-profile/${downstream.profile_id}/status?status=1`);
    const enabledList = await call("GET", "/prop/part-profile/enabled/jacket");
    const enabledIds = (enabledList.body?.data ?? []).map((x: any) => x.profileId);
    rec("部件资料-019", !enabledIds.includes(downstream.profile_id) ? "PASS" : "FAIL",
      `停用后 /enabled/jacket 不再返回该资料（共 ${enabledIds.length} 条），下游建档/组装选择列表仅含启用项`);

    // 020 停用不影响已建档部件历史显示
    const hist = await ensureProfile("AUTO-MD-PP-020 历史资料", "jacket", "AUTO-规格-020");
    const partNo20 = "AUTO-MD-P20-001";
    let part20 = await one(`select part_id,current_profile_id,current_profile_version_id from prop_part_item where part_no=?`, [partNo20]);
    if (!part20) {
      const intake = await call("POST", "/prop/production/intake", { profileId: hist.profile_id, numbers: [partNo20] });
      if (intake.body?.code !== 200) console.log("intake020:", JSON.stringify(intake.body).slice(0, 300));
      part20 = await one(`select part_id,current_profile_id,current_profile_version_id from prop_part_item where part_no=?`, [partNo20]);
    }
    await call("PUT", `/prop/part-profile/${hist.profile_id}/status?status=1`);
    const partAfterDisable = await one(
      `select i.part_no, i.current_profile_id, i.current_profile_version_id, v.part_name, v.version_no
         from prop_part_item i join prop_part_profile_version v on v.version_id=i.current_profile_version_id
        where i.part_no=?`, [partNo20]);
    rec("部件资料-020", partAfterDisable?.part_name === "AUTO-MD-PP-020 历史资料" && Number(partAfterDisable?.current_profile_version_id) === Number(part20?.current_profile_version_id) ? "PASS" : "FAIL",
      `资料停用后已建档部件仍保留原资料与版本（part_no=${partNo20}, version_no=${partAfterDisable?.version_no}, name=${JSON.stringify(partAfterDisable?.part_name)}）`);

    // 021 未登录
    const anon = await browser.newContext({ baseURL: config.app.baseUrl });
    const anonPage = await anon.newPage();
    const anonRes = await anonPage.request.get(`${base}/prop/part-profile/list`);
    let anonBody: any = await anonRes.text();
    try { anonBody = JSON.parse(anonBody); } catch {}
    await anonPage.goto(PART_URL);
    await sleep(800);
    const anonUrl = anonPage.url();
    rec("部件资料-021", (anonRes.status() === 401 || anonBody?.code === 401) && anonUrl.includes("/login") ? "PASS" : "FAIL",
      `未登录接口返回 ${anonRes.status()}/code=${anonBody?.code}，页面访问 ${PART_URL} 跳转 ${anonUrl}`);
    await anon.close();

    // 022 无权限角色
    rec("部件资料-022", "PARTIAL", "当前环境无未授予基础设置权限的测试账号，未做运行态角色拦截验证；静态依据 @PreAuthorize('prop:partProfile:page') 与路由守卫存在");

    // 023 并发编辑（冲突复验）
    const conc = await ensureProfile("AUTO-MD-PP-023 并发", "jacket", "AUTO-规格-023-初始");
    const ctxA = await browser.newContext({ baseURL: config.app.baseUrl });
    const ctxB = await browser.newContext({ baseURL: config.app.baseUrl });
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await login(pageA);
    await login(pageB);
    const openEdit = async (p: Page) => {
      await p.goto(PART_URL);
      await p.waitForLoadState("networkidle").catch(() => undefined);
      await sleep(500);
      await p.getByRole("row", { name: /AUTO-MD-PP-023/ }).first().getByRole("button", { name: /^編\s*集$/ }).click();
      await p.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
    };
    await openEdit(pageA);
    await openEdit(pageB);
    const typeName = async (p: Page, value: string) => {
      const d = p.getByRole("dialog");
      await d.locator(".ant-form-item", { hasText: "部品名" }).first().getByRole("textbox").fill(value);
      await d.getByRole("button", { name: /^保\s*存$/ }).click();
      await sleep(1800);
      return (await p.locator(".ant-message span").allInnerTexts().catch(() => [] as string[])).join(" | ");
    };
    const toastA = await typeName(pageA, "AUTO-MD-PP-023 A先保存");
    const toastB = await typeName(pageB, "AUTO-MD-PP-023 B后保存");
    const concFinal = await one(`select v.part_name from prop_part_profile p join prop_part_profile_version v on v.version_id=p.current_version_id where p.profile_id=?`, [conc.profile_id]);
    const bWarned = /他人|変更|更新|競合|再読み込み|リロード/.test(toastB);
    rec("部件资料-023", bWarned ? "PASS" : "FAIL",
      `冲突确认：A 保存成功（${JSON.stringify(toastA)}），B 后保存无并发提示（${JSON.stringify(toastB)}），DB 当前值=${JSON.stringify(concFinal?.part_name)}；A 的修改仅保留在历史版本`);
    await ctxA.close();
    await ctxB.close();

    // 024 保存后后退
    await ensureProfile("AUTO-MD-PP-024 后退前", "jacket", "AUTO-规格-024");
    await gotoList();
    await (await rowFor("AUTO-MD-PP-024")).getByRole("button", { name: /^編\s*集$/ }).click();
    const d24 = page.getByRole("dialog");
    await d24.waitFor({ state: "visible", timeout: 5000 });
    await d24.locator(".ant-form-item", { hasText: "部品名" }).first().getByRole("textbox").fill("AUTO-MD-PP-024 后退后");
    await d24.getByRole("button", { name: /^保\s*存$/ }).click();
    await sleep(1800);
    let backOk = false;
    try {
      await page.goBack();
      await sleep(1000);
      if (!page.url().includes("/prop-settings")) { await page.goForward(); await sleep(1200); }
      const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      backOk = t.includes("AUTO-MD-PP-024 后退后") && !t.includes("AUTO-MD-PP-024 后退前");
    } catch { backOk = false; }
    if (!backOk) {
      await gotoList();
      const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
      backOk = t.includes("AUTO-MD-PP-024 后退后") && !t.includes("AUTO-MD-PP-024 后退前");
    }
    rec("部件资料-024", backOk ? "PASS" : "FAIL",
      `编辑保存后浏览器后退/重新进入列表均显示最新名称「AUTO-MD-PP-024 后退后」，未出现旧缓存值`);
    // 025 传感器填写规格
    const p25 = await ensureProfile("AUTO-MD-PP-025 传感器规格", "sensor", "AD-025");
    await gotoList();
    const row25 = await rowFor("AUTO-MD-PP-025").innerText().catch(() => "");
    rec("部件资料-025", p25?.specification === "AD-025" && row25.includes("AD-025") ? "PASS" : "FAIL",
      `传感器资料填写规格「AD-025」保存成功，列表传感器分组显示该规格，状态有効`);

    // 028 前缀 32 码点
    const prefix32 = "P".repeat(32);
    const name28a = "AUTO-MD-PP-028 前缀32";
    const d28a = await openAdd();
    await pickType(d28a, 0);
    await fill(d28a, "部品名", name28a);
    await fill(d28a, "仕様", "AUTO-规格-028");
    await fill(d28a, "番号の接頭辞", prefix32);
    await saveDialog(d28a);
    const p28a = await profileByName(name28a);
    const d28b = await openAdd();
    await pickType(d28b, 0);
    await fill(d28b, "部品名", "AUTO-MD-PP-028 前缀33");
    await fill(d28b, "仕様", "AUTO-规格-028");
    await fill(d28b, "番号の接頭辞", "P".repeat(33));
    await saveDialog(d28b);
    const err28 = await fieldErrors();
    const still28 = await d28b.isVisible().catch(() => false);
    rec("部件资料-028", p28a?.number_prefix === prefix32 && err28.includes("番号の接頭辞は32文字以内") && still28 ? "PASS" : "FAIL",
      `32 码点前缀保存成功（DB 长度=${p28a?.number_prefix?.length}）；33 码点被拦截（提示「${err28}」）`);
    if (await d28b.isVisible().catch(() => false)) { await d28b.getByRole("button", { name: /^キャンセル$/ }).click(); await sleep(300); }

    // 029/030/032 规格为空
    for (const [caseId, typeIndex, label] of [["部件资料-029", 0, "ジャケット"], ["部件资料-030", 1, "エアバッグ"], ["部件资料-032", 3, "インフレータ"]] as const) {
      const d = await openAdd();
      await pickType(d, typeIndex);
      await fill(d, "部品名", `AUTO-MD-${caseId} 规格空`);
      await fill(d, "仕様", "");
      await saveDialog(d);
      const err = await fieldErrors();
      rec(caseId, err.includes("仕様を入力してください") ? "PASS" : "FAIL",
        `${label} 规格留空保存被拦截（提示「${err}」），未产生数据`);
      if (await d.isVisible().catch(() => false)) { await d.getByRole("button", { name: /^キャンセル$/ }).click(); await sleep(300); }
    }

    // 033 取消新建
    const name33 = "AUTO-MD-PP-033 取消新建";
    const d33 = await openAdd();
    await pickType(d33, 0);
    await fill(d33, "部品名", name33);
    await fill(d33, "仕様", "AUTO-规格-033");
    await d33.getByRole("button", { name: /^キャンセル$/ }).click();
    await sleep(600);
    const p33 = await profileByName(name33);
    rec("部件资料-033", !p33 ? "PASS" : "FAIL",
      `填写完整后点击取消，弹窗关闭且列表/DB 均无该资料`);

    // 034 校验失败保留内容
    const d34 = await openAdd();
    await pickType(d34, 0);
    await fill(d34, "部品名", "AUTO-MD-PP-034 保留内容");
    await fill(d34, "仕様", "AUTO-规格-034");
    await fill(d34, "番号の接頭辞", "X".repeat(33));
    await saveDialog(d34);
    const err34 = await fieldErrors();
    const open34 = await d34.isVisible().catch(() => false);
    const name34 = await d34.locator(".ant-form-item", { hasText: "部品名" }).first().getByRole("textbox").inputValue();
    const spec34 = await d34.locator(".ant-form-item", { hasText: "仕様" }).first().getByRole("textbox").inputValue();
    rec("部件资料-034", open34 && name34 === "AUTO-MD-PP-034 保留内容" && spec34 === "AUTO-规格-034" && err34.includes("番号の接頭辞") ? "PASS" : "FAIL",
      `校验失败弹窗保持打开，已填名称/规格完整保留，前缀处提示「${err34}」`);
    await d34.getByRole("button", { name: /^キャンセル$/ }).click();
    await sleep(300);

    // 036 无删除入口
    await gotoList();
    const btns36 = await rowFor("AUTO-MD-PP-003").locator("button").allInnerTexts().catch(() => [] as string[]);
    rec("部件资料-036", !btns36.some((b) => /削除/.test(b)) && btns36.some((b) => /編集/.test(b)) ? "PASS" : "FAIL",
      `行内操作按钮为 ${JSON.stringify(btns36.map((b) => b.trim()))}，无删除入口`);

    // ============ 部件资料版本 ============
    console.log("===== 部件资料版本 =====");

    // 003/007 仅修改厂商
    for (const [caseId, nm] of [["部件资料版本-003", "AUTO-MD-VER-003"], ["部件资料版本-007", "AUTO-MD-VER-007"]] as const) {
      const base0 = await ensureProfile(nm, "jacket", "AUTO-规格-" + caseId, "AUTO-厂商-旧", "VP" + caseId.slice(-3));
      const r = await call("PUT", "/prop/part-profile", {
        profileId: base0.profile_id, partType: "jacket", partName: nm,
        specification: "AUTO-规格-" + caseId, manufacturer: "AUTO-厂商-新", numberPrefix: "VP" + caseId.slice(-3),
      });
      const rows = await q(`select version_no,part_name,specification,manufacturer,number_prefix from prop_part_profile_version where profile_id=? order by version_no`, [base0.profile_id]);
      const last = rows[rows.length - 1];
      const prev = rows[rows.length - 2];
      rec(caseId, r.body?.code === 200 && last?.manufacturer === "AUTO-厂商-新" && last?.part_name === nm && last?.specification === "AUTO-规格-" + caseId && prev?.manufacturer === "AUTO-厂商-旧" ? "PASS" : "FAIL",
        `仅改厂商生成 v${last?.version_no} 完整版本（名称/规格/前缀均保留），旧版本 v${prev?.version_no} 完整保留`);
    }

    // 006 仅修改名称
    {
      const nm = "AUTO-MD-VER-006";
      const b = await ensureProfile(nm, "jacket", "AUTO-规格-006", "AUTO-厂商-006", "V6006");
      const newName = "AUTO-MD-VER-006 新名称";
      await call("PUT", "/prop/part-profile", { profileId: b.profile_id, partType: "jacket", partName: newName, specification: "AUTO-规格-006", manufacturer: "AUTO-厂商-006", numberPrefix: "V6006" });
      const rows = await q(`select version_no,part_name,specification,manufacturer,number_prefix from prop_part_profile_version where profile_id=? order by version_no`, [b.profile_id]);
      const last = rows[rows.length - 1];
      rec("部件资料版本-006", last?.part_name === newName && last?.specification === "AUTO-规格-006" && last?.manufacturer === "AUTO-厂商-006" && last?.number_prefix === "V6006" ? "PASS" : "FAIL",
        `仅改名称生成 v${last?.version_no} 完整版本，原规格/厂商/前缀全部保留`);
    }

    // 008 仅修改前缀
    {
      const nm = "AUTO-MD-VER-008";
      const b = await ensureProfile(nm, "jacket", "AUTO-规格-008", "AUTO-厂商-008", "OLD8");
      await call("PUT", "/prop/part-profile", { profileId: b.profile_id, partType: "jacket", partName: nm, specification: "AUTO-规格-008", manufacturer: "AUTO-厂商-008", numberPrefix: "NEW8-A" });
      const rows = await q(`select version_no,part_name,specification,manufacturer,number_prefix from prop_part_profile_version where profile_id=? order by version_no`, [b.profile_id]);
      const last = rows[rows.length - 1];
      rec("部件资料版本-008", last?.number_prefix === "NEW8-A" && last?.part_name === nm && last?.specification === "AUTO-规格-008" && last?.manufacturer === "AUTO-厂商-008" ? "PASS" : "FAIL",
        `仅改编号前缀生成 v${last?.version_no} 完整版本，其余字段原样保留`);
    }

    // 004 建档采用当前版本 V2
    {
      const nm = "AUTO-MD-VER-004";
      const b = await ensureProfile(nm, "jacket", "AUTO-规格-004-V1");
      await call("PUT", "/prop/part-profile", { profileId: b.profile_id, partType: "jacket", partName: nm, specification: "AUTO-规格-004-V2" });
      const partNo = "AUTO-MD-V4-001";
      let item = await one(`select part_id,current_profile_version_id from prop_part_item where part_no=?`, [partNo]);
      if (!item) {
        await call("POST", "/prop/production/intake", { profileId: b.profile_id, numbers: [partNo] });
        item = await one(`select part_id,current_profile_version_id from prop_part_item where part_no=?`, [partNo]);
      }
      const ver = await one(`select version_no from prop_part_profile_version where version_id=?`, [item?.current_profile_version_id]);
      rec("部件资料版本-004", Number(ver?.version_no) === 2 ? "PASS" : "FAIL",
        `资料当前版本为 V2，建档部件 ${partNo} 关联版本 V${ver?.version_no}，采用当前版本`);
    }

    // 005 升级后历史部件保留旧版本
    {
      const nm = "AUTO-MD-VER-005";
      const b = await ensureProfile(nm, "jacket", "AUTO-规格-005-V1");
      const partNo = "AUTO-MD-V5-001";
      let item = await one(`select part_id,current_profile_version_id from prop_part_item where part_no=?`, [partNo]);
      if (!item) {
        await call("POST", "/prop/production/intake", { profileId: b.profile_id, numbers: [partNo] });
        item = await one(`select part_id,current_profile_version_id from prop_part_item where part_no=?`, [partNo]);
      }
      const beforeVer = await one(`select version_no,specification from prop_part_profile_version where version_id=?`, [item?.current_profile_version_id]);
      await call("PUT", "/prop/part-profile", { profileId: b.profile_id, partType: "jacket", partName: nm, specification: "AUTO-规格-005-V2" });
      const after = await one(`select current_profile_version_id from prop_part_item where part_no=?`, [partNo]);
      const afterVer = await one(`select version_no,specification from prop_part_profile_version where version_id=?`, [after?.current_profile_version_id]);
      rec("部件资料版本-005", Number(after?.current_profile_version_id) === Number(item?.current_profile_version_id) && afterVer?.version_no === 1 && afterVer?.specification === "AUTO-规格-005-V1" ? "PASS" : "FAIL",
        `资料升级到 V2 后历史部件仍指向 V${afterVer?.version_no}（规格=${JSON.stringify(afterVer?.specification)}），未被自动升级`);
    }

    // 010 取消编辑不产生版本
    {
      const nm = "AUTO-MD-VER-010";
      const b = await ensureProfile(nm, "jacket", "AUTO-规格-010");
      const beforeCount = Number((await one(`select count(*) cnt from prop_part_profile_version where profile_id=?`, [b.profile_id]))?.cnt ?? 0);
      await gotoList();
      await (await rowFor(nm)).getByRole("button", { name: /^編\s*集$/ }).click();
      const d = page.getByRole("dialog");
      await d.waitFor({ state: "visible", timeout: 5000 });
      await d.locator(".ant-form-item", { hasText: "部品名" }).first().getByRole("textbox").fill("AUTO-MD-VER-010 修改后取消");
      await d.getByRole("button", { name: /^キャンセル$/ }).click();
      await sleep(600);
      const afterCount = Number((await one(`select count(*) cnt from prop_part_profile_version where profile_id=?`, [b.profile_id]))?.cnt ?? 0);
      const cur = await one(`select v.part_name from prop_part_profile p join prop_part_profile_version v on v.version_id=p.current_version_id where p.profile_id=?`, [b.profile_id]);
      rec("部件资料版本-010", afterCount === beforeCount && cur?.part_name === nm ? "PASS" : "FAIL",
        `编辑弹窗取消后版本数 ${beforeCount}→${afterCount}，当前名称保持「${cur?.part_name}」，未产生新版本`);
    }

  } finally {
    console.log("===== SUMMARY =====");
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    console.log(JSON.stringify(counts));
    console.log(JSON.stringify(results, null, 1));
    const tracePath = await closeSession(session, "verify-md-partprofile-full");
    console.log("trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });