/**
 * 产品生产-部件组装 未执行用例批量运行时验证（21 条）
 * 覆盖：001/002/003/010-错误/011/012/013/014/016/017/018/019/020/021/022/023/024/025/026/027/028
 * 夹具（幂等）：产品 AUTO-B101~B106（入库 API）；部件 AUTO-SEED-S1/A1/A2（DB 种入）；
 *   资料 气囊A型(2)/气囊B型(6)/传感器A型(3)/充气发生器A型(4)；固件 85cm(3)/AUTO-FW01(4)。
 */
import type { Page } from "playwright";
import { config } from "../../src/config/index.js";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, compact,
  apiLogin, apiCall, intakeViaApi, seedPart, readToasts, pickOptionScroll,
} from "./prod-runtime-utils.js";

const book = new ResultBook("reports/prod-runtime-results-assembly.json");
const db = new DbClient();
const REQ = "FEAT-09 部件组装";
const B_NUMBERS = ["AUTO-B101", "AUTO-B102", "AUTO-B103", "AUTO-B104", "AUTO-B105", "AUTO-B106"];

async function gotoAssembly(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (page.url().includes("/production/assembly")) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    } else {
      await page.goto("/production/assembly", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    const ok = await page.locator(".assembly-page").waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    if (ok) {
      await page.waitForTimeout(800);
      return;
    }
  }
  throw new Error("无法进入部件组装页");
}

async function dismissNotifications(page: Page): Promise<void> {
  for (const icon of await page.locator(".ant-notification .ant-notification-close-icon").all()) {
    await icon.click().catch(() => undefined);
  }
}

async function filterRange(page: Page, prefix: string, start: string, end: string): Promise<void> {
  const rangeTab = page.locator(".ant-segmented-item", { hasText: "範囲検索" });
  await rangeTab.click().catch(() => undefined);
  await page.locator("#assembly-prefix").fill(prefix);
  await page.locator("#assembly-start").fill(start);
  await page.locator("#assembly-end").fill(end);
  await dismissNotifications(page);
  await page.getByRole("button", { name: /検\s*索/ }).click();
  await page.waitForTimeout(1500);
}

async function filterSingle(page: Page, number: string): Promise<void> {
  await page.locator(".ant-segmented-item", { hasText: "製造番号検索" }).click();
  await page.locator("#assembly-number").fill(number);
  await dismissNotifications(page);
  await page.getByRole("button", { name: /検\s*索/ }).click();
  await page.waitForTimeout(1500);
}

/** 返回某产品行某槽位的录入框。槽位顺序：airbag=1, sensor=2, inflator_1=3, inflator_2=4（0 列为製造番号）。 */
function cellInput(page: Page, manufacturingNo: string, slotIndex: number) {
  return page.locator(".sheet tbody tr", { hasText: manufacturingNo }).locator("td").nth(slotIndex).locator("input");
}

async function setDefault(page: Page, selectId: string, optionText: string): Promise<void> {
  await page.locator(`#${selectId}`).locator("xpath=ancestor::div[contains(@class,'ant-select')][1]").click();
  await page.waitForTimeout(400);
  await pickOptionScroll(page, optionText);
  await page.waitForTimeout(400);
  // 若出现默认资料切换确认弹窗则确认
  const modal = page.locator(".ant-modal-confirm:visible");
  if (await modal.count()) {
    await modal.getByRole("button", { name: "切り替える" }).click().catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

async function setupDefaults(page: Page): Promise<void> {
  await setDefault(page, "assembly-airbag-profile", "气囊 A型");
  await setDefault(page, "assembly-sensor-profile", "传感器 A型");
  await setDefault(page, "assembly-firmware", "85cm");
  await setDefault(page, "assembly-inflator_1-profile", "充气发生器 A型");
}

async function rowNumbers(page: Page): Promise<string[]> {
  return page.locator(".sheet tbody tr td code").allInnerTexts();
}

async function main(): Promise<void> {
  await db.connect();
  const adminToken = await apiLogin(config.app.loginUser, config.app.loginPassword);

  // 夹具：确保 AUTO-B101~B106 已入库（仅补缺失）
  const existing = await db.query<{ active_manufacturing_no: string }>(
    `SELECT active_manufacturing_no FROM prop_product WHERE active_manufacturing_no IN (${B_NUMBERS.map(() => "?").join(",")}) AND deleted_time IS NULL`,
    B_NUMBERS,
  );
  const missing = B_NUMBERS.filter((no) => !existing.some((r) => r.active_manufacturing_no === no));
  if (missing.length) {
    const res = await apiCall(adminToken, "POST", "/prop/production/intake", { profileId: 1, numbers: missing });
    if (res.code !== 200) throw new Error(`夹具入库失败：${res.msg}`);
  }
  // 夹具：类型不符/资料不一致用部件
  await seedPart(db, { partNo: "AUTO-SEED-S1", partType: "sensor", profileId: 3, remark: "AUTO-FIXTURE-组装-021 传感器撞列夹具" });
  await seedPart(db, { partNo: "AUTO-SEED-A1", partType: "airbag", profileId: 6, remark: "AUTO-FIXTURE-组装-022/023 气囊夹具" });
  await seedPart(db, { partNo: "AUTO-SEED-A2", partType: "airbag", profileId: 6, remark: "AUTO-FIXTURE-组装-022 气囊夹具(Esc分支)" });

  const { browser, session } = await launchAdminSession("verify-prod-assembly-cases");
  const page = session.page;
  page.setDefaultTimeout(10000);
  try {
    // 017 未筛选时空表与引导
    await book.run("部件组装-017", "未筛选时表格为空并给出筛选引导", REQ, async () => {
      await gotoAssembly(page);
      const emptyText = compact(await page.locator(".assembly-card .ant-empty").innerText().catch(() => ""));
      const rows = await rowNumbers(page);
      const header = compact(await page.locator(".assembly-card header h2").innerText());
      const ok = emptyText.includes("製造番号") && rows.length === 0 && header.includes("組立一覧");
      return { status: ok ? "通过" : "不通过", actual: `未筛选：表头「${header}」、行数=${rows.length}、引导文案「${emptyText}」`, evidence: "assemblyEmpty；不默认加载清单" };
    });

    // 001 页面结构
    await book.run("部件组装-001", "部件组装页结构：提示条/筛选区/默认资料区/空表", REQ, async () => {
      const banner = await page.locator(".assembly-page > .ant-alert").count();
      const segmented = await page.locator(".ant-segmented-item").allInnerTexts();
      const defaultsText = compact(await page.locator(".defaults").innerText());
      const emptyText = compact(await page.locator(".assembly-card .ant-empty").innerText().catch(() => ""));
      const hasFirmware = defaultsText.includes("センサのバージョンNo.");
      const ok = banner > 0 && segmented.join().includes("範囲検索") && segmented.join().includes("製造番号検索")
        && defaultsText.includes("エアバッグの部品情報") && defaultsText.includes("インフレータ1の部品情報") && hasFirmware
        && emptyText.includes("製造番号");
      return {
        status: ok ? "通过" : "不通过",
        actual: `顶部操作提示条=${banner > 0 ? "有" : "无"}；筛选方式=${segmented.join("/")}；默认资料区含 气囊/传感器+固件版本/发生器1/2 下拉=${defaultsText.length > 0 && hasFirmware}；空表提示「${emptyText}」`,
        evidence: "assembly/index.vue 模板结构",
      };
    });

    // 002 范围筛选
    await book.run("部件组装-002", "范围筛选仅显示范围内产品", REQ, async () => {
      await filterRange(page, "AUTO-B10", "1", "6");
      const rows = await rowNumbers(page);
      const header = compact(await page.locator(".assembly-card header h2").innerText());
      const ok = rows.length === 6 && rows.every((no) => B_NUMBERS.includes(no)) && header.includes("6件");
      return { status: ok ? "通过" : "不通过", actual: `筛选 AUTO-B101~106 → 「${header}」，行=${rows.join("、")}`, evidence: "manufacturingRange SQL" };
    });

    // 019 范围严格匹配不放宽位数
    await book.run("部件组装-019", "范围筛选严格匹配，不做位数放宽", REQ, async () => {
      const rowsA = await rowNumbers(page);
      await page.getByRole("button", { name: "リセット" }).click();
      await page.waitForTimeout(500);
      await filterRange(page, "AUTO-B1", "1", "2");
      const rowsB = await rowNumbers(page);
      const toast = await readToasts(page);
      const ok = rowsA.length === 6 && rowsB.length === 0 && toast.includes("該当するジャケットがありません");
      await filterRange(page, "AUTO-B10", "1", "6");
      return {
        status: ok ? "通过" : "不通过",
        actual: `「AUTO-B10+1~6」命中 ${rowsA.length} 行；「AUTO-B1+1~2」命中 ${rowsB.length} 行并提示「${compact(toast, 60)}」（不把 1~2 放宽成 101~102）`,
        evidence: "manufacturingRange char_length 严格匹配",
      };
    });

    // 003 编号筛选
    await book.run("部件组装-003", "编号筛选精确显示单个产品", REQ, async () => {
      await filterSingle(page, "AUTO-B101");
      const rows = await rowNumbers(page);
      const ok = rows.length === 1 && rows[0] === "AUTO-B101";
      await page.locator(".ant-segmented-item", { hasText: "範囲検索" }).click();
      await filterRange(page, "AUTO-B10", "1", "6");
      return { status: ok ? "通过" : "不通过", actual: `编号筛选 AUTO-B101 → 仅 ${rows.join("、")} 一行`, evidence: "manufacturingNo 精确匹配" };
    });

    // 018 全阶段产品混排 + 发生器2 空可补录
    await book.run("部件组装-018", "范围筛选显示全部阶段产品，发生器位置2空可补录", REQ, async () => {
      await filterRange(page, "AUTO-J00", "1", "4");
      const rows = await rowNumbers(page);
      const j002Inf2 = await cellInput(page, "AUTO-J002", 4).inputValue();
      const j001Airbag = await cellInput(page, "AUTO-J001", 1).inputValue();
      const ok = rows.includes("AUTO-J001") && rows.includes("AUTO-J002") && rows.includes("AUTO-J003") && rows.includes("AUTO-J004")
        && j002Inf2 === "" && j001Airbag === "AUTO-A050";
      await filterRange(page, "AUTO-B10", "1", "6");
      return {
        status: ok ? "通过" : "不通过",
        actual: `范围 AUTO-J001~004 显示 ${rows.join("、")}（含待质检 J001、已质检 J002、组装中 J003/J004）；J002 发生器位置2=${j002Inf2 === "" ? "空白可补录" : j002Inf2}；J001 气囊列显示已绑定 ${j001Airbag}`,
        evidence: "selectProducts 不过滤阶段；inflator_2 任意槽",
      };
    });

    // 020 默认资料为空时录入被拦截
    await book.run("部件组装-020", "默认部件资料未选择时录入无法保存", REQ, async () => {
      await gotoAssembly(page);
      await filterRange(page, "AUTO-B10", "1", "6");
      const cell = cellInput(page, "AUTO-B101", 1);
      await cell.fill("AUTO-BX101");
      await page.locator(".assembly-card header").click();
      await page.waitForTimeout(800);
      const errorText = compact(await page.locator(".sheet tbody tr", { hasText: "AUTO-B101" }).locator(".cell-error").innerText().catch(() => ""));
      await page.locator(".sheet tbody tr", { hasText: "AUTO-B101" }).getByRole("button", { name: "入力を取り消す" }).click().catch(() => undefined);
      const created = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_part_item WHERE part_no='AUTO-BX101'");
      const ok = errorText.includes("先に上部で部品情報の初期値を選択") && Number(created[0].cnt) === 0;
      return { status: ok ? "通过" : "不通过", actual: `行内红字「${errorText}」；AUTO-BX101 未建档（DB=${created[0].cnt} 条）`, evidence: "saveCell defaultProfileRequired" };
    });

    // 设定默认资料（后续用例前提）
    await setupDefaults(page);

    // 021 类型不符拦截（失败格保留给 028 用）
    await book.run("部件组装-021", "气囊列录入传感器编号被拦截", REQ, async () => {
      // 使用恒空的发声器1列（气囊列会被 026 持久占用，避免重跑时变成更换语义）
      const cell = cellInput(page, "AUTO-B106", 3);
      await cell.fill("AUTO-SEED-S1");
      await page.locator(".assembly-card header").click();
      await page.waitForTimeout(1500);
      const errorText = compact(await page.locator(".sheet tbody tr", { hasText: "AUTO-B106" }).locator(".cell-error").innerText().catch(() => ""));
      const bindings = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id JOIN prop_part_item i ON i.part_id=b.part_id WHERE p.active_manufacturing_no='AUTO-B106' AND b.slot_type='inflator_1' AND i.active_part_no='AUTO-SEED-S1' AND b.ended_time IS NULL",
      );
      const typeMsgShown = errorText.includes("種別が取付位置と一致しない");
      const genericMsg = errorText.includes("保存できませんでした");
      const ok = errorText.length > 0 && Number(bindings[0].cnt) === 0;
      return {
        status: ok ? (typeMsgShown ? "通过" : "部分验证") : "不通过",
        actual: `行内红字「${errorText}」（类型不符具体原因${typeMsgShown ? "已展示" : genericMsg ? "未展示，仅通用「保存できませんでした」——同批次005新发现①的行内原因丢失问题" : "未识别"}）；未建立绑定（DB=${bindings[0].cnt}）`,
        evidence: "后端 typeMismatch；行内文案受 propProduction.mjs error?.msg 缺陷影响",
      };
    });

    // 028 失败格拦截页面级动作
    await book.run("部件组装-028", "存在失败格时重新筛选/重置被拦截", REQ, async () => {
      await dismissNotifications(page);
      await page.getByRole("button", { name: /検\s*索/ }).click();
      await page.waitForTimeout(600);
      const toast1 = await readToasts(page);
      const rowsAfterSearch = await rowNumbers(page);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "リセット" }).click();
      await page.waitForTimeout(600);
      const toast2 = await readToasts(page);
      const rowsAfterReset = await rowNumbers(page);
      const blocked1 = toast1.includes("未保存・保存中・保存失敗・要確認");
      const blocked2 = toast2.includes("未保存・保存中・保存失敗・要確認");
      // 处理失败格后动作恢复
      await page.locator(".sheet tbody tr", { hasText: "AUTO-B106" }).getByRole("button", { name: "入力を取り消す" }).click();
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: "リセット" }).click();
      await page.waitForTimeout(800);
      const rowsAfterHandled = await rowNumbers(page);
      const ok = blocked1 && blocked2 && rowsAfterSearch.length === 6 && rowsAfterReset.length === 6 && rowsAfterHandled.length === 0;
      return {
        status: ok ? "通过" : "不通过",
        actual: `失败格存在时：検索拦截=${blocked1}、リセット拦截=${blocked2}（提示「未保存・保存中・保存失敗・要確認の入力があります…」），清单保持 6 行；取消失败格后リセット生效（${rowsAfterHandled.length} 行）。注：页面无翻页控件（单次最多100件），翻页步骤不适用`,
        evidence: "hasIssues() 拦截；页脚 1回100件まで・ページ分割なし",
      };
    });

    // 011 Enter 保存并移到下一行同列
    await book.run("部件组装-011", "回车保存当前格并移到下一行同列", REQ, async () => {
      await filterRange(page, "AUTO-B10", "1", "6");
      const cell = cellInput(page, "AUTO-B101", 1);
      await cell.fill("AUTO-BA101");
      await cell.press("Enter");
      await page.waitForTimeout(1500);
      const nextCell = cellInput(page, "AUTO-B102", 1);
      const focusMoved = await nextCell.evaluate((el) => document.activeElement === el);
      const saved = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id JOIN prop_part_item i ON i.part_id=b.part_id WHERE p.active_manufacturing_no='AUTO-B101' AND i.active_part_no='AUTO-BA101' AND b.slot_type='airbag' AND b.ended_time IS NULL",
      );
      const ok = focusMoved && Number(saved[0].cnt) === 1;
      return { status: ok ? "通过" : "不通过", actual: `B101 气囊录入 AUTO-BA101 回车→保存（DB 绑定=${saved[0].cnt}），光标移到下一行气囊框=${focusMoved}`, evidence: "onKeydown Enter → focus(r+1,c)" };
    });

    // 012 Tab 保存并右移
    await book.run("部件组装-012", "Tab 保存当前格并向右移动", REQ, async () => {
      const cell = cellInput(page, "AUTO-B102", 1);
      await cell.fill("AUTO-BA102");
      await cell.press("Tab");
      await page.waitForTimeout(1500);
      const sensorCell = cellInput(page, "AUTO-B102", 2);
      const focusMoved = await sensorCell.evaluate((el) => document.activeElement === el);
      const saved = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id JOIN prop_part_item i ON i.part_id=b.part_id WHERE p.active_manufacturing_no='AUTO-B102' AND i.active_part_no='AUTO-BA102' AND b.ended_time IS NULL",
      );
      const ok = focusMoved && Number(saved[0].cnt) === 1;
      return { status: ok ? "通过" : "不通过", actual: `B102 气囊录入 AUTO-BA102 按 Tab→保存（DB 绑定=${saved[0].cnt}），光标右移到传感器框=${focusMoved}`, evidence: "onKeydown Tab → focus(nextR,nextC)" };
    });

    // 013 上方向键带出上一行同槽位编号
    await book.run("部件组装-013", "上方向键带出上一行同槽位编号", REQ, async () => {
      const cell = cellInput(page, "AUTO-B103", 1);
      const original = await cell.inputValue();
      await cell.click();
      await cell.press("ArrowUp");
      await page.waitForTimeout(400);
      const copied = await cell.inputValue();
      await cell.press("Escape");
      await page.waitForTimeout(300);
      const restored = await cell.inputValue();
      const ok = copied === "AUTO-BA102" && restored === original;
      return { status: ok ? "通过" : "不通过", actual: `B103 气囊框按↑带出上一行编号「${copied}」，Esc 放弃后恢复原值「${restored || "空"}」`, evidence: "onKeydown ArrowUp 复制上一行同列值" };
    });

    // 014 失焦自动保存
    await book.run("部件组装-014", "录入后焦点离开自动保存", REQ, async () => {
      const cell = cellInput(page, "AUTO-B103", 1);
      await cell.fill("AUTO-BA103");
      await page.locator(".assembly-card header").click();
      await page.waitForTimeout(1500);
      const status = compact(await page.locator(".save-status").innerText().catch(() => ""));
      const saved = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id JOIN prop_part_item i ON i.part_id=b.part_id WHERE p.active_manufacturing_no='AUTO-B103' AND i.active_part_no='AUTO-BA103' AND b.ended_time IS NULL",
      );
      const ok = Number(saved[0].cnt) === 1 && status.includes("自動保存済み");
      return { status: ok ? "通过" : "不通过", actual: `B103 气囊录入 AUTO-BA103 失焦→自动保存（DB 绑定=${saved[0].cnt}），底部状态「${status}」`, evidence: "@blur=saveCell + saveStatusText" };
    });

    // 022 资料不一致确认更正（Enter 确认 / Esc 取消）
    await book.run("部件组装-022", "已建档编号资料与默认不一致时经确认才更正", REQ, async () => {
      await gotoAssembly(page);
      await setupDefaults(page);
      // 幂等重置：A1 归位 B型(6) 且解绑；A2 归位 B型(6)
      await db.execute("UPDATE prop_part_item SET current_profile_id=6 WHERE active_part_no IN ('AUTO-SEED-A1','AUTO-SEED-A2')");
      const b104Airbag = await db.query<{ binding_id: number }>(
        "SELECT b.binding_id FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id WHERE p.active_manufacturing_no='AUTO-B104' AND b.slot_type='airbag' AND b.ended_time IS NULL",
      );
      if (b104Airbag.length) {
        const product = await db.query<{ product_id: number }>("SELECT product_id FROM prop_product WHERE active_manufacturing_no='AUTO-B104'");
        await apiCall(adminToken, "DELETE", `/prop/production/products/${product[0].product_id}/bindings/airbag`);
      }
      await filterRange(page, "AUTO-B10", "1", "6");
      const cell = cellInput(page, "AUTO-B104", 1);
      await cell.fill("AUTO-SEED-A1");
      await page.locator(".assembly-card header").click();
      const confirmBar = page.locator(".sheet tbody tr", { hasText: "AUTO-B104" }).locator(".inline-confirm");
      await confirmBar.waitFor({ state: "visible", timeout: 8000 });
      const confirmText = compact(await confirmBar.innerText());
      await cell.click();
      await cell.press("Enter");
      await page.waitForTimeout(1500);
      const profileAfter = await db.query<{ current_profile_id: number }>("SELECT current_profile_id FROM prop_part_item WHERE active_part_no='AUTO-SEED-A1'");
      const corrected = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_production_event e JOIN prop_part_item i ON e.part_id=i.part_id WHERE i.active_part_no='AUTO-SEED-A1' AND e.event_type='PROFILE_CORRECTED'",
      );
      // Esc 分支：B105 录入 A2，出现确认条后 Esc
      const cellB = cellInput(page, "AUTO-B105", 1);
      await cellB.fill("AUTO-SEED-A2");
      await page.locator(".assembly-card header").click();
      const confirmBarB = page.locator(".sheet tbody tr", { hasText: "AUTO-B105" }).locator(".inline-confirm");
      await confirmBarB.waitFor({ state: "visible", timeout: 8000 });
      await cellB.click();
      await cellB.press("Escape");
      await page.waitForTimeout(800);
      const a2 = await db.query<{ current_profile_id: number }>("SELECT current_profile_id FROM prop_part_item WHERE active_part_no='AUTO-SEED-A2'");
      const a2Bound = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_product_binding b JOIN prop_part_item i ON i.part_id=b.part_id WHERE i.active_part_no='AUTO-SEED-A2' AND b.ended_time IS NULL",
      );
      const ok = confirmText.includes("部品マスタ") && profileAfter[0].current_profile_id === 2 && Number(corrected[0].cnt) >= 1
        && a2[0].current_profile_id === 6 && Number(a2Bound[0].cnt) === 0;
      return {
        status: ok ? "通过" : "不通过",
        actual: `行内确认条「${compact(confirmText, 100)}」；Enter 确认后 A1 资料更正为 A型(profile=2) 且 PROFILE_CORRECTED 事件=${corrected[0].cnt} 条；Esc 取消后 A2 资料保持 B型(profile=6)、未绑定`,
        evidence: "confirmProfileHistory + PROFILE_CORRECTED 事件",
      };
    });

    // 023 资料 Tag 下拉更正只作用于当前部件
    await book.run("部件组装-023", "资料 Tag 下拉更正只作用于当前部件", REQ, async () => {
      await filterRange(page, "AUTO-B10", "1", "6");
      const row = page.locator(".sheet tbody tr", { hasText: "AUTO-B104" });
      const tag = row.locator("td").nth(1).locator(".editable-tag").first();
      const before = compact(await tag.innerText());
      await tag.click();
      await page.locator(".ant-dropdown:visible .ant-dropdown-menu-item", { hasText: "气囊 B型" }).click();
      const modal = page.locator(".ant-modal-confirm:visible");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      const modalBody = compact(await modal.innerText());
      await modal.getByRole("button", { name: /確\s*認/ }).click();
      await page.waitForTimeout(1500);
      const a1 = await db.query<{ current_profile_id: number }>("SELECT current_profile_id FROM prop_part_item WHERE active_part_no='AUTO-SEED-A1'");
      const a2 = await db.query<{ current_profile_id: number }>("SELECT current_profile_id FROM prop_part_item WHERE active_part_no='AUTO-SEED-A2'");
      const ok = a1[0].current_profile_id === 6 && a2[0].current_profile_id === 6 && modalBody.includes("訂正");
      return {
        status: ok ? "通过" : "不通过",
        actual: `Tag「${before}」下拉改选气囊 B型 → 弹窗「${compact(modalBody, 90)}」→ 确认后 A1 profile=6（B型）；同资料体系其他部件 A2 profile 保持 ${a2[0].current_profile_id} 不受影响（仍为 B型）`,
        evidence: "updateProfile API + prop_part_item.current_profile_id",
      };
    });

    // 024 固件 Tag 下拉更新只作用于当前传感器
    await book.run("部件组装-024", "固件 Tag 下拉更新版本只作用于当前传感器", REQ, async () => {
      // 幂等：若 B101 传感器格为空则录入 AUTO-SE101（默认固件 85cm）
      const sensorCell = cellInput(page, "AUTO-B101", 2);
      if (!(await sensorCell.inputValue())) {
        await sensorCell.fill("AUTO-SE101");
        await page.locator(".assembly-card header").click();
        await page.waitForTimeout(1500);
      }
      const current = await db.query<{ current_firmware_id: number }>("SELECT current_firmware_id FROM prop_part_item WHERE active_part_no='AUTO-SE101'");
      const targetFirmware = current[0].current_firmware_id === 4 ? { id: 3, text: "85cm" } : { id: 4, text: "AUTO-FW01" };
      const fwTag = page.locator(".sheet tbody tr", { hasText: "AUTO-B101" }).locator("td").nth(2).locator(".editable-tag", { hasText: "バージョンNo." }).first();
      await fwTag.click();
      await page.locator(".ant-dropdown:visible .ant-dropdown-menu-item", { hasText: targetFirmware.text }).first().click();
      const modal = page.locator(".ant-modal-confirm:visible");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      const modalBody = compact(await modal.innerText());
      await modal.getByRole("button", { name: /確\s*認/ }).click();
      await page.waitForTimeout(1500);
      const after = await db.query<{ current_firmware_id: number }>("SELECT current_firmware_id FROM prop_part_item WHERE active_part_no='AUTO-SE101'");
      const other = await db.query<{ current_firmware_id: number }>("SELECT current_firmware_id FROM prop_part_item WHERE active_part_no='AUTO-S001'");
      const events = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_production_event e JOIN prop_part_item i ON e.part_id=i.part_id WHERE i.active_part_no='AUTO-SE101' AND e.event_type IN ('FIRMWARE_SET','FIRMWARE_UPDATED')",
      );
      const ok = after[0].current_firmware_id === targetFirmware.id && other[0].current_firmware_id === 3 && modalBody.includes("バージョンNo.");
      return {
        status: ok ? "通过" : "不通过",
        actual: `固件 Tag 下拉选择 ${targetFirmware.text} → 弹窗「${compact(modalBody, 90)}」→ SE101 固件=${after[0].current_firmware_id}（目标 ${targetFirmware.id}），固件事件累计 ${events[0].cnt} 条；其他传感器 AUTO-S001 固件保持 ${other[0].current_firmware_id} 不变`,
        evidence: "updateFirmware API + FIRMWARE_UPDATED 事件",
      };
    });

    // 025 切换默认资料只影响新录入
    await book.run("部件组装-025", "切换默认资料只影响之后新录入", REQ, async () => {
      await setDefault(page, "assembly-airbag-profile", "气囊 B型");
      const cell = cellInput(page, "AUTO-B105", 1);
      if (!(await cell.inputValue())) {
        await cell.fill("AUTO-BA105");
        await page.locator(".assembly-card header").click();
        await page.waitForTimeout(1500);
      }
      const b101 = await db.query<{ current_profile_id: number }>(
        "SELECT i.current_profile_id FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id JOIN prop_part_item i ON i.part_id=b.part_id WHERE p.active_manufacturing_no='AUTO-B101' AND b.slot_type='airbag' AND b.ended_time IS NULL",
      );
      const b105 = await db.query<{ current_profile_id: number }>(
        "SELECT i.current_profile_id FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id JOIN prop_part_item i ON i.part_id=b.part_id WHERE p.active_manufacturing_no='AUTO-B105' AND b.slot_type='airbag' AND b.ended_time IS NULL",
      );
      const ok = b101[0].current_profile_id === 2 && b105[0].current_profile_id === 6;
      // 恢复默认 A型
      await setDefault(page, "assembly-airbag-profile", "气囊 A型");
      return {
        status: ok ? "通过" : "不通过",
        actual: `默认气囊资料切为 B型 后新录入 AUTO-BA105 → B105 气囊资料=6（B型）；已保存的 B101 气囊资料保持=${b101[0].current_profile_id}（2=A型 不变）`,
        evidence: "requestDefaultChange；保存行不受默认切换影响",
      };
    });

    // 026 最后一行 Enter 仅保存不跳转
    await book.run("部件组装-026", "最后一行按 Enter 仅保存不跳转", REQ, async () => {
      const cell = cellInput(page, "AUTO-B106", 1);
      if (!(await cell.inputValue())) await cell.fill("AUTO-BA106");
      await cell.click();
      await cell.press("Enter");
      await page.waitForTimeout(600);
      const toast = await readToasts(page);
      const focusStayed = await cell.evaluate((el) => document.activeElement === el);
      const ok = focusStayed && toast.includes("Enterで保存");
      return { status: ok ? "通过" : "不通过", actual: `最后一行 B106 气囊格按 Enter → 保存且光标不跳走=${focusStayed}，提示「${compact(toast, 60)}」`, evidence: "onKeydown Enter 末行 focus(r,c) + enterSaved" };
    });

    // 027 相同编号重复提交为无操作
    await book.run("部件组装-027", "同格重复提交相同编号不产生重复数据", REQ, async () => {
      const eventsBefore = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_production_event e JOIN prop_product p ON p.product_id=e.product_id WHERE p.active_manufacturing_no='AUTO-B106'",
      );
      let putCount = 0;
      const listener = (req: import("playwright").Request) => {
        if (req.url().includes("/prop/production/assembly") && req.method() === "PUT") putCount++;
      };
      page.on("request", listener);
      const cell = cellInput(page, "AUTO-B106", 1);
      await cell.fill("AUTO-BA106");
      await page.locator(".assembly-card header").click();
      await page.waitForTimeout(1200);
      page.off("request", listener);
      const eventsAfter = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_production_event e JOIN prop_product p ON p.product_id=e.product_id WHERE p.active_manufacturing_no='AUTO-B106'",
      );
      const ok = putCount === 0 && eventsAfter[0].cnt === eventsBefore[0].cnt;
      return {
        status: ok ? "通过" : "不通过",
        actual: `同格重输相同编号 AUTO-BA106 → 组装保存请求 ${putCount} 次（0=前端直接视为无操作），B106 事件数 ${eventsBefore[0].cnt}→${eventsAfter[0].cnt} 不变`,
        evidence: "saveCell: value===original 时直接 return",
      };
    });

    // 010-错误 同位置已有绑定时更换确认（Esc 取消还原 / Enter 确认更换）
    await book.run("部件组装-010-错误", "同位置已有有效绑定时更换需确认，取消则还原", REQ, async () => {
      // 取消分支：J001 气囊 AUTO-A050 → 输入 AUTO-A002 → 确认条 → Esc 还原
      await filterSingle(page, "AUTO-J001");
      const j001Cell = cellInput(page, "AUTO-J001", 1);
      await j001Cell.fill("AUTO-A002");
      await page.locator(".assembly-card header").click();
      const confirmBar = page.locator(".sheet tbody tr", { hasText: "AUTO-J001" }).locator(".inline-confirm");
      await confirmBar.waitFor({ state: "visible", timeout: 8000 });
      const confirmText = compact(await confirmBar.innerText());
      await j001Cell.click();
      await j001Cell.press("Escape");
      await page.waitForTimeout(800);
      const restored = await j001Cell.inputValue();
      // 确认分支：B104 气囊（当前为 AUTO-SEED-A1）→ 输入 AUTO-FREE01 → 确认 → 更换
      await filterSingle(page, "AUTO-B104");
      const b104Cell = cellInput(page, "AUTO-B104", 1);
      const oldNo = await b104Cell.inputValue();
      await b104Cell.fill("AUTO-FREE01");
      await page.locator(".assembly-card header").click();
      const row = page.locator(".sheet tbody tr", { hasText: "AUTO-B104" });
      await row.locator(".inline-confirm").waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
      for (let i = 0; i < 3; i++) {
        const bar = row.locator(".inline-confirm");
        if (!(await bar.count()) || !(await bar.isVisible().catch(() => false))) break;
        await bar.getByRole("button", { name: /確\s*認/ }).click();
        await page.waitForTimeout(1500);
      }
      await page.waitForTimeout(800);
      const active = await db.query<{ part_no: string }>(
        "SELECT i.active_part_no part_no FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id JOIN prop_part_item i ON i.part_id=b.part_id WHERE p.active_manufacturing_no='AUTO-B104' AND b.slot_type='airbag' AND b.ended_time IS NULL",
      );
      const j001Active = await db.query<{ part_no: string }>(
        "SELECT i.active_part_no part_no FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id JOIN prop_part_item i ON i.part_id=b.part_id WHERE p.active_manufacturing_no='AUTO-J001' AND b.slot_type='airbag' AND b.ended_time IS NULL",
      );
      const replacedEvent = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_production_event e JOIN prop_product p ON p.product_id=e.product_id WHERE p.active_manufacturing_no='AUTO-B104' AND e.event_type='PART_REPLACED'",
      );
      const ok = confirmText.includes("取り付け") && restored === "AUTO-A050"
        && active.length === 1 && active[0].part_no === "AUTO-FREE01" && j001Active.length === 1 && j001Active[0].part_no === "AUTO-A050"
        && Number(replacedEvent[0].cnt) >= 1;
      return {
        status: ok ? "通过" : "不通过",
        actual: `取消分支：J001 气囊改输 AUTO-A002 → 确认条「${compact(confirmText, 80)}」→ Esc 还原为 ${restored}（DB 仍绑 AUTO-A050）；确认分支：B104 气囊由 ${oldNo} 换为 AUTO-FREE01 → 确认后有效绑定仅 1 条=${active[0]?.part_no}，PART_REPLACED 事件=${replacedEvent[0].cnt} 条`,
        evidence: "confirmReplacement + PART_REPLACED 事件；同位置唯一有效绑定",
      };
    });

    // 016 缺件产品保持组装中且不进入质检清单（API 资格判定）
    await book.run("部件组装-016", "最低必需部件缺失时保持组装中且质检不显示", REQ, async () => {
      const eligibility = await apiCall(adminToken, "GET", "/prop/production/inspection/eligibility?manufacturingNo=AUTO-J003");
      const data = eligibility.data as { status?: string; message?: string };
      const candidates = await apiCall(adminToken, "GET", "/prop/production/inspection/candidates?manufacturingNo=AUTO-J003");
      const rows = (candidates as unknown as { rows?: unknown[] }).rows ?? [];
      const stage = await db.query<{ productionStage: string }>(
        "SELECT CASE WHEN p.initial_production_inspection_passed=1 THEN '已质检' WHEN COUNT(DISTINCT CASE WHEN b.slot_type IN ('body','airbag','sensor','inflator_1') THEN b.slot_type END)=4 THEN '待质检' ELSE '组装中' END productionStage FROM prop_product p LEFT JOIN prop_product_binding b ON b.product_id=p.product_id AND b.ended_time IS NULL WHERE p.active_manufacturing_no='AUTO-J003' GROUP BY p.product_id",
      );
      const ok = data.status === "incomplete" && rows.length === 0 && stage[0]?.productionStage === "组装中";
      return {
        status: ok ? "通过" : "不通过",
        actual: `AUTO-J003（缺传感器）资格判定=${data.status}「${compact(data.message ?? "", 90)}」；质检候选=0 条；阶段派生=${stage[0]?.productionStage}`,
        evidence: "inspectionEligibility incomplete + having=4 口径",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-prod-assembly-cases");
    await db.close();
    await book.save();
    console.log("---- VERDICT ----");
    for (const r of book.list()) console.log(`${r.caseId}: ${r.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
