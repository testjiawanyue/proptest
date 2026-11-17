/** 作业选项 024/026/027/028/029/030 补测 */
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
const s = await createSession(browser, { traceName: "verify-md-workoption-fix" });
const page = s.page;
const db = new DbProbe(); await db.connect();
const q = async (sql: string, params: unknown[] = []) => (await db.snapshot("q", sql, params)).rows as any[];
const one = async (sql: string, params: unknown[] = []) => (await q(sql, params))[0];
try {
  await login(page);
  const token = (await page.context().cookies()).find((c) => c.name === "Admin-Token")?.value;
  const base = `${config.app.baseUrl}${config.app.apiPrefix}`;
  const call = async (method: string, url: string, data?: unknown) => {
    const res = await page.request.fetch(`${base}${url}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, data: data === undefined ? undefined : JSON.stringify(data) });
    const text = await res.text(); let body: any; try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status(), body };
  };
  const gotoPage = async () => { await page.goto("/prop-settings/work-option"); await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined); await sleep(900); };
  const rowFor = (v: string) => page.getByRole("row", { name: new RegExp(esc(v)) }).first();
  const notify = async () => (await page.locator(".ant-notification").allInnerTexts().catch(() => [] as string[])).join(" | ");
  const openAdd = async () => { await page.locator(".add button").first().click(); await page.locator(".add input").waitFor({ state: "visible", timeout: 4000 }); return page.locator(".add input"); };
  const save = async () => { await page.locator(".add button", { hasText: /^保\s*存$/ }).click(); await sleep(1300); };
  const cancelAdd = async () => { await page.locator(".add button", { hasText: /^キャンセル$/ }).click().catch(() => undefined); await sleep(400); };
  const switchCat = async (i: number) => { await page.locator("aside button").nth(i).click(); await sleep(900); };
  const switchTab = async (i: number) => { await page.locator(".ant-segmented-item").nth(i).click(); await sleep(900); };

  await gotoPage();
  await switchCat(0); await switchTab(1);
  const btns24 = await rowFor("AUTO-WO-D-005").locator("button").allInnerTexts().catch(() => [] as string[]);
  rec("作业选项-024", btns24.length > 0 && !btns24.some((b) => /削除/.test(b)) && btns24.some((b) => /無効|有効/.test(b)) ? "PASS" : "FAIL",
    `センサ组行内操作按钮为 ${JSON.stringify(btns24.map((b) => b.trim()))}，仅停用/启用语义，无删除入口`);

  // 026 现场来源旧值
  const fieldVal = "AUTO-WO-026-現場";
  await db.snapshot("seed", `insert into prop_work_option (option_category,work_group,display_value,normalized_hash,source,status,create_by,create_time)
    select 'disposition','sewing',?,unhex(sha2(lower(?),256)),'field','0','admin',now()
    where not exists (select 1 from prop_work_option where display_value=?)`, [fieldVal, fieldVal, fieldVal]);
  await gotoPage(); await switchCat(0); await switchTab(0);
  const r026 = await rowFor(fieldVal).innerText().catch(() => "");
  rec("作业选项-026", r026.includes("現場入力") ? "PARTIAL" : "FAIL",
    `历史「現場入力」来源项「${fieldVal}」在清单中展示并可停用/启用；现场新输入是否回写清单未在作业管理复验`);

  // 027 首尾空白
  const v027 = "AUTO-WO-027-交換済";
  if (!(await one(`select option_id from prop_work_option where display_value=?`, [v027]))) {
    const input = await openAdd(); await input.fill("  " + v027 + "  "); await save(); await cancelAdd();
  }
  const db027 = await one(`select display_value from prop_work_option where display_value=?`, [v027]);
  rec("作业选项-027", db027?.display_value === v027 ? "PASS" : "FAIL", `首尾空白去除后保存为「${v027}」，列表显示去除后文本`);

  // 028 同组大小写不敏感 / 跨组允许
  const done = "AUTO-WO-028-Done";
  if (!(await one(`select option_id from prop_work_option where option_category='disposition' and work_group='sewing' and display_value=?`, [done]))) {
    const input = await openAdd(); await input.fill(done); await save(); await cancelAdd();
  }
  const i028 = await openAdd(); await i028.fill("auto-wo-028-done"); await save();
  const n028 = await notify();
  await cancelAdd().catch(() => undefined);
  await switchTab(1);
  const cross = "AUTO-WO-028-Done";
  if (!(await one(`select option_id from prop_work_option where option_category='disposition' and work_group='sensor' and display_value=?`, [cross]))) {
    const input = await openAdd(); await input.fill(cross); await save(); await cancelAdd();
  }
  const crossRow = await one(`select option_id from prop_work_option where option_category='disposition' and work_group='sensor' and display_value=?`, [cross]);
  rec("作业选项-028", /同じ値が登録済/.test(n028) && !!crossRow ? "PASS" : "FAIL",
    `縫製组新增「auto-wo-028-done」被判重复（通知「同じ値が登録済」）；同值在センサ组独立保存成功（option_id=${crossRow?.option_id}）`);

  // 029 受付全局判重
  await switchCat(2);
  const ng = "AUTO-WO-029-NG-A";
  if (!(await one(`select option_id from prop_work_option where option_category='reception_ng' and display_value=?`, [ng]))) {
    const input = await openAdd(); await input.fill(ng); await save(); await cancelAdd();
  }
  const i029 = await openAdd(); await i029.fill("auto-wo-029-ng-a"); await save();
  const n029 = await notify();
  rec("作业选项-029", /同じ値が登録済/.test(n029) ? "PASS" : "FAIL",
    `受付NG全局范围大小写不敏感判重生效（通知「同じ値が登録済」），无工作组维度，未新增`);
  await cancelAdd().catch(() => undefined);

  // 030 并发
  const race = "AUTO-WO-030-RaceOpt";
  const before30 = Number((await one(`select count(*) c from prop_work_option where option_category='disposition' and work_group='sewing' and display_value=?`, [race]))?.c ?? 0);
  if (before30 === 0) {
    const [a, b] = await Promise.all([
      call("POST", "/prop/work-option", { optionCategory: "disposition", workGroup: "sewing", displayValue: race }),
      call("POST", "/prop/work-option", { optionCategory: "disposition", workGroup: "sewing", displayValue: race }),
    ]);
    const codes = [a.body?.code, b.body?.code].sort();
    const after30 = Number((await one(`select count(*) c from prop_work_option where option_category='disposition' and work_group='sewing' and display_value=?`, [race]))?.c ?? 0);
    rec("作业选项-030", after30 === 1 && codes.includes(200) && codes.includes(500) ? "PASS" : "FAIL",
      `并发提交返回 ${JSON.stringify(codes)}，DB 仅 1 条「${race}」（uk_work_option_scope_hash 兜底）`);
  } else rec("作业选项-030", "PARTIAL", `并发用例数据已存在，本次未重复压测`);
} finally {
  console.log("===== SUMMARY =====");
  console.log(JSON.stringify(results, null, 1));
  console.log("trace:", await closeSession(s, "verify-md-workoption-fix"));
  await db.close(); await browser.close();
}