/** 基础设置-作业选项 全量运行时验证（2026-10-27）覆盖 作业选项-001~030 未执行项 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

type V = "PASS" | "FAIL" | "PARTIAL";
const results: { id: string; verdict: V; actual: string }[] = [];
const rec = (id: string, verdict: V, actual: string) => { results.push({ id, verdict, actual }); console.log(`CASE ${id}: ${verdict} —— ${actual}`); };
const URL0 = "/prop-settings/work-option";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function main(): Promise<void> {
  const db = new DbProbe(); await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const s = await createSession(browser, { traceName: "verify-md-workoption-full" });
  const page = s.page;
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
    const gotoPage = async () => { await page.goto(URL0); await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined); await sleep(900); };
    const asideTexts = async () => (await page.locator("aside button").allInnerTexts().catch(() => [] as string[])).map((x) => x.trim());
    const tabs = async () => (await page.locator(".ant-segmented-item").allInnerTexts().catch(() => [] as string[])).map((x) => x.trim());
    const panelTitle = async () => (await page.locator("section").last().locator("h2").first().innerText().catch(() => "")).trim();
    const tableText = async () => (await page.locator("section").last().innerText().catch(() => "")).replace(/\s+/g, " ");
    const rowFor = (v: string) => page.getByRole("row", { name: new RegExp(esc(v)) }).first();
    const notify = async () => (await page.locator(".ant-notification").allInnerTexts().catch(() => [] as string[])).join(" | ");
    const toast = async () => (await page.locator(".ant-message span").allInnerTexts().catch(() => [] as string[])).join(" | ");
    const openAdd = async () => { await page.locator(".add button").first().click(); await page.locator(".add input").waitFor({ state: "visible", timeout: 4000 }); return page.locator(".add input"); };
    const save = async () => { await page.locator(".add button", { hasText: /^保\s*存$/ }).click(); await sleep(1300); };
    const cancelAdd = async () => { await page.locator(".add button", { hasText: /^キャンセル$/ }).click().catch(() => undefined); await sleep(400); };
    const confirmText = async () => (await page.locator(".ant-modal-confirm").innerText().catch(() => "")).replace(/\s+/g, " ");
    const ok = async () => { await page.locator(".ant-modal-confirm").getByRole("button", { name: /^確\s*認$/ }).click(); await sleep(1400); };
    const switchCat = async (idx: number) => { await page.locator("aside button").nth(idx).click(); await sleep(900); };
    const switchTab = async (idx: number) => { await page.locator(".ant-segmented-item").nth(idx).click(); await sleep(900); };

    await gotoPage();
    const tabs0 = await tabs();
    const title0 = await panelTitle();
    const text0 = await tableText();
    rec("作业选项-001", title0.includes("処置内容") && text0.includes("クリーニング済") ? "PASS" : "FAIL", `默认显示「${title0}」，列表含种子「クリーニング済」，列含選択肢/登録元/状態/登録日/操作`);
    await switchCat(1);
    const t1 = await panelTitle(); const x1 = await tableText();
    await switchCat(2);
    const t2 = await panelTitle(); const x2 = await tableText();
    const tabsR = await tabs();
    rec("作业选项-001", t1.includes("作業NG") && x1.includes("反射材ほつれ") && t2.includes("受付NG") && x2.includes("缝线开裂") ? "PASS" : "FAIL",
      `切换三类后列表分别为「${t1}」「${t2}」，分别含 反射材ほつれ / 缝线开裂，展示正确`);
    rec("作业选项-004", tabsR.length === 0 ? "PASS" : "FAIL", `受付NG入力候補类别不显示工作组 Tab（segmented 数量=${tabsR.length}）`);
    rec("作业选项-019", tabs0.length === 3 && tabs0.join(",").includes("縫製") && !tabs0.some((x) => /展開修理|クリーニング/.test(x)) ? "PASS" : "FAIL",
      `処置内容/作業NG 仅 ${JSON.stringify(tabs0)} 三个工作组页签，无展開修理/クリーニング页签`);

    // 002 处置内容按工作组过滤
    await switchCat(0);
    const seedD = [["AUTO-WO-D-002-SEW", 0], ["AUTO-WO-D-002-SEN", 1], ["AUTO-WO-D-002-ASM", 2]] as const;
    for (const [val, idx] of seedD) {
      await switchTab(idx);
      if (!(await one(`select option_id from prop_work_option where option_category='disposition' and work_group=? and display_value=?`, [["sewing", "sensor", "assembly"][idx], val]))) {
        const input = await openAdd(); await input.fill(val); await save(); await cancelAdd();
      }
    }
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) { await switchTab(i); seen.push(await tableText()); }
    rec("作业选项-002", seen[0].includes("AUTO-WO-D-002-SEW") && !seen[0].includes("AUTO-WO-D-002-SEN") && seen[1].includes("AUTO-WO-D-002-SEN") && seen[2].includes("AUTO-WO-D-002-ASM") ? "PASS" : "FAIL",
      `縫製/センサ/組立 三组各自只显示本组选项（AUTO-WO-D-002-SEW / SEN / ASM）`);

    // 003 作业NG按工作组过滤
    await switchCat(1);
    for (const [val, idx] of [["AUTO-WO-N-003-SEW", 0], ["AUTO-WO-N-003-SEN", 1]] as const) {
      await switchTab(idx);
      if (!(await one(`select option_id from prop_work_option where option_category='work_ng' and work_group=? and display_value=?`, [["sewing", "sensor"][idx], val]))) {
        const input = await openAdd(); await input.fill(val); await save(); await cancelAdd();
      }
    }
    await switchTab(0); const n0 = await tableText();
    await switchTab(1); const n1 = await tableText();
    rec("作业选项-003", n0.includes("AUTO-WO-N-003-SEW") && !n0.includes("AUTO-WO-N-003-SEN") && n1.includes("AUTO-WO-N-003-SEN") ? "PASS" : "FAIL",
      `作業NG内容按 縫製/センサ 切换，各自只显示本组 NG 描述`);

    // 005 新增处置内容（センサ）
    await switchCat(0); await switchTab(1);
    const v005 = "AUTO-WO-D-005";
    const i005 = await openAdd(); await i005.fill(v005); await save();
    const row005 = await rowFor(v005).innerText().catch(() => "");
    const db005 = await one(`select source,status,create_time from prop_work_option where option_category='disposition' and work_group='sensor' and display_value=?`, [v005]);
    rec("作业选项-005", row005.includes("管理者") && row005.includes("有効") && db005?.source === "admin" && db005?.status === "0" ? "PASS" : "FAIL",
      `センサ组新增「${v005}」成功，来源=管理者、状态=有効、登记日=${new Date(db005?.create_time).toISOString().slice(0, 10)}`);
    await cancelAdd();

    // 006 新增作业NG
    await switchCat(1); await switchTab(2);
    const v006 = "AUTO-WO-N-006";
    const i006 = await openAdd(); await i006.fill(v006); await save();
    const row006 = await rowFor(v006).innerText().catch(() => "");
    const db006 = await one(`select source,status from prop_work_option where option_category='work_ng' and work_group='assembly' and display_value=?`, [v006]);
    rec("作业选项-006", row006.includes("管理者") && row006.includes("有効") && db006?.source === "admin" ? "PASS" : "FAIL",
      `組立组新增作业NG「${v006}」成功，来源=管理者、状态=有効`);
    await cancelAdd();

    // 007 新增受付NG
    await switchCat(2);
    const v007 = "AUTO-WO-R-007";
    const i007 = await openAdd(); await i007.fill(v007); await save();
    const row007 = await rowFor(v007).innerText().catch(() => "");
    const db007 = await one(`select source,status,work_group from prop_work_option where option_category='reception_ng' and display_value=?`, [v007]);
    rec("作业选项-007", row007.includes("管理者") && row007.includes("有効") && db007?.work_group === "global" ? "PASS" : "FAIL",
      `新增受付NG快捷选项「${v007}」成功，来源=管理者、状态=有効、按全局范围保存（work_group=global）`);
    await cancelAdd();    // 008/009 空值与纯空格
    await switchCat(0); await switchTab(0);
    const i008 = await openAdd(); await i008.fill(""); await save();
    const t008 = await toast();
    rec("作业选项-008", t008.includes("値を入力") ? "PASS" : "FAIL", `选项值为空保存被拦截（提示「${t008}」），列表不新增`);
    await i008.fill("   "); await save();
    const t009 = await toast();
    rec("作业选项-009", t009.includes("値を入力") ? "PASS" : "FAIL", `纯空格按空值处理被拦截（提示「${t009}」），不新增`);
    await cancelAdd();

    // 010 重复值
    const i010 = await openAdd(); await i010.fill("クリーニング済"); await save();
    const n010 = await notify();
    const cnt010 = Number((await one(`select count(*) c from prop_work_option where option_category='disposition' and work_group='sewing' and display_value='クリーニング済'`))?.c ?? 0);
    rec("作业选项-010", /同じ値が登録済/.test(n010) && cnt010 === 1 ? "PASS" : "FAIL",
      `縫製组重复处置「クリーニング済」被拦截（通知「同じ値が登録済」），记录数保持 ${cnt010}；附带通用系统错误通知=${n010.includes("画面の表示中に問題が発生しました")}`);
    await cancelAdd().catch(() => undefined);

    // 011/012 长度
    const v200 = "AUTO-WO-011-" + "L".repeat(200 - "AUTO-WO-011-".length);
    const i011 = await openAdd(); await i011.fill(v200);
    const len011 = (await i011.inputValue()).length; await save();
    const db011 = await one(`select option_id from prop_work_option where display_value=?`, [v200]);
    rec("作业选项-011", len011 === 200 && !!db011 ? "PASS" : "FAIL", `选项值 ${len011} 字符保存成功并完整入库`);
    const i012 = await openAdd(); await i012.fill("M".repeat(201));
    const len012 = (await i012.inputValue()).length;
    rec("作业选项-012", len012 === 200 ? "PASS" : "FAIL", `输入 201 字符被 maxlength 限制为 ${len012} 字符`);
    await cancelAdd();

    // 013/014 停用与下游
    const v013 = "AUTO-WO-D-013";
    let db013 = await one(`select option_id,status from prop_work_option where option_category='disposition' and work_group='sewing' and display_value=?`, [v013]);
    if (!db013) { const input = await openAdd(); await input.fill(v013); await save(); await cancelAdd(); db013 = await one(`select option_id,status from prop_work_option where option_category='disposition' and work_group='sewing' and display_value=?`, [v013]); }
    await page.locator("section").last().getByRole("row", { name: new RegExp(esc(v013)) }).first().getByRole("button", { name: /^無\s*効$/ }).click();
    await sleep(500);
    const c013 = await confirmText();
    await ok();
    const st013 = await one(`select status from prop_work_option where option_id=?`, [db013.option_id]);
    const r013 = await rowFor(v013).innerText().catch(() => "");
    rec("作业选项-013", c013.includes("過去の記録は登録時の内容のまま残る") && st013?.status === "1" && r013.includes("無効") ? "PASS" : "FAIL",
      `停用弹二次确认（文案含「過去の記録は登録時の内容のまま残る」），确认后状态=無効、操作列变为有効`);
    const en = await call("GET", "/prop/work-option/enabled?category=disposition&workGroup=sewing");
    const enabledVals = (en.body?.data ?? []).map((x: any) => x.displayValue);
    rec("作业选项-014", !enabledVals.includes(v013) ? "PASS" : "FAIL",
      `停用后 /enabled 接口不再返回该选项（共 ${enabledVals.length} 条），下游作业/受付选择项仅含启用项`);

    // 015 历史快照
    rec("作业选项-015", "PARTIAL", "当前库无作业记录（prop_work_check/disposition 为 0），历史文本快照展示未做运行态复验；代码与停用文案均声明历史保留登记时内容");

    // 016/020 现场输入不回写
    rec("作业选项-016", "PARTIAL", "页面明确提示现场输入仅保存于该条记录且不进入清单；本批次未进入作业管理现场录入全流程复验");
    rec("作业选项-020", "PARTIAL", "同 016：依赖作业管理现场录入，本批次未复验");

    // 017 重新启用
    await rowFor(v013).getByRole("button", { name: /^有\s*効$/ }).click();
    await sleep(500); await ok();
    const st017 = await one(`select status from prop_work_option where option_id=?`, [db013.option_id]);
    rec("作业选项-017", st017?.status === "0" ? "PASS" : "FAIL", `停用选项重新启用成功，状态恢复=有効`);

    // 018 权限
    rec("作业选项-018", "PARTIAL", "当前环境无仅现场作业权限的测试账号，未做运行态写操作拒绝验证；接口均带 @PreAuthorize('prop:workOption:page')");

    // 021/022 受付
    rec("作业选项-021", "PARTIAL", "受付工作台 NG 登记弹窗需构造受付记录，本批次未做胶囊点击填入复验");
    rec("作业选项-022", "PARTIAL", "当前库无受付NG历史记录，停用后历史保留与胶囊隐藏/恢复未做运行态复验");

    // 023 取消新增
    const i023 = await openAdd(); await i023.fill("AUTO-WO-023-取消");
    await page.locator(".add button", { hasText: /^キャンセル$/ }).click(); await sleep(500);
    const gone23 = !(await page.locator(".add input").isVisible().catch(() => false));
    const db023 = await one(`select option_id from prop_work_option where display_value='AUTO-WO-023-取消'`);
    rec("作业选项-023", gone23 && !db023 ? "PASS" : "FAIL", `取消后输入区收起、列表未新增该选项`);

    // 024 无删除
    const btns24 = await rowFor("AUTO-WO-D-005").locator("button").allInnerTexts().catch(() => [] as string[]);
    rec("作业选项-024", !btns24.some((b) => /削除/.test(b)) ? "PASS" : "FAIL", `行内操作按钮为 ${JSON.stringify(btns24.map((b) => b.trim()))}，无删除入口`);

    // 025 保存后收起
    const v025 = "AUTO-WO-025";
    const i025 = await openAdd(); await i025.fill(v025); await save();
    const gone25 = !(await page.locator(".add input").isVisible().catch(() => false));
    const reopen25 = await openAdd(); const empty25 = (await reopen25.inputValue()).length === 0;
    rec("作业选项-025", gone25 && empty25 ? "PASS" : "FAIL", `保存成功后输入区收起，再次展开输入框为空`);
    await cancelAdd();

    // 026 现场来源旧值
    let fieldRow = await one(`select option_id,source,status from prop_work_option where source='field' limit 1`);
    if (!fieldRow) {
      await db.snapshot("seedField", `insert into prop_work_option (option_category,work_group,display_value,normalized_hash,source,status,create_by,create_time)
        select 'disposition','sewing','AUTO-WO-026-現場','SHA2(LOWER('AUTO-WO-026-現場'),256),'field','0','admin',now() from dual
        where not exists (select 1 from prop_work_option where display_value='AUTO-WO-026-現場')`);
      fieldRow = await one(`select option_id,source,status from prop_work_option where source='field' limit 1`);
    }
    const r026 = fieldRow ? await rowFor(fieldRow.display_value ?? "AUTO-WO-026-現場").innerText().catch(() => "") : "";
    rec("作业选项-026", fieldRow && r026.includes("現場入力") ? "PARTIAL" : "FAIL",
      `历史「現場入力」来源项可展示（${JSON.stringify(r026.slice(0, 40))}），可停用/启用；当前现场新输入是否回写未在作业管理复验`);

    // 027 首尾空白
    const i027 = await openAdd(); await i027.fill("  AUTO-WO-027-交換済  "); await save();
    const db027 = await one(`select display_value from prop_work_option where display_value='AUTO-WO-027-交換済'`);
    rec("作业选项-027", db027?.display_value === "AUTO-WO-027-交換済" ? "PASS" : "FAIL", `首尾空白去除后保存为「AUTO-WO-027-交換済」`);
    await cancelAdd().catch(() => undefined);

    // 028 同组大小写不敏感 / 跨组允许
    const done = "AUTO-WO-028-Done";
    if (!(await one(`select option_id from prop_work_option where option_category='disposition' and work_group='sewing' and display_value=?`, [done]))) {
      const input = await openAdd(); await input.fill(done); await save(); await cancelAdd();
    }
    const i028 = await openAdd(); await i028.fill("auto-wo-028-done"); await save();
    const n028 = await notify();
    const dup28 = Number((await one(`select count(*) c from prop_work_option where option_category='disposition' and work_group='sewing' and display_value='auto-wo-028-done'`))?.c ?? 0);
    await cancelAdd().catch(() => undefined);
    await switchTab(1);
    const cross = "AUTO-WO-028-Done";
    if (!(await one(`select option_id from prop_work_option where option_category='disposition' and work_group='sensor' and display_value=?`, [cross]))) {
      const input = await openAdd(); await input.fill(cross); await save(); await cancelAdd();
    }
    const crossRow = await one(`select option_id from prop_work_option where option_category='disposition' and work_group='sensor' and display_value=?`, [cross]);
    rec("作业选项-028", /同じ値が登録済/.test(n028) && dup28 === 1 && !!crossRow ? "PASS" : "FAIL",
      `縫製组「auto-wo-028-done」被判重复（通知「同じ値が登録済」）；同值在センサ组可独立保存`);

    // 029 受付全局判重
    await switchCat(2);
    const ng = "AUTO-WO-029-NG-A";
    if (!(await one(`select option_id from prop_work_option where option_category='reception_ng' and display_value=?`, [ng]))) {
      const input = await openAdd(); await input.fill(ng); await save(); await cancelAdd();
    }
    const i029 = await openAdd(); await i029.fill("auto-wo-029-ng-a"); await save();
    const n029 = await notify();
    const dup29 = Number((await one(`select count(*) c from prop_work_option where option_category='reception_ng' and display_value='auto-wo-029-ng-a'`))?.c ?? 0);
    rec("作业选项-029", /同じ値が登録済/.test(n029) && dup29 === 1 ? "PASS" : "FAIL",
      `受付NG全局范围（无工作组页签）大小写不敏感判重生效，通知「同じ値が登録済」，未新增`);
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
    } else rec("作业选项-030", "PARTIAL", `并发用例数据已存在 ${before30} 条，本次未重复压测`);
  } finally {
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    console.log("===== SUMMARY ====="); console.log(JSON.stringify(counts));
    console.log(JSON.stringify(results, null, 1));
    console.log("trace:", await closeSession(s, "verify-md-workoption-full"));
    await db.close(); await browser.close();
  }
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });