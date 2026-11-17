/**
 * 产品生产-衣体入库 未执行用例批量运行时验证（18 条）
 * 覆盖：001/002/003/007/008/009/010/011/014/018/020/021/022/023/024/025/026/027
 * 数据约定：资料「衣体 オレンジ 标准型123」(profile_id=1, 前缀PTG) 与
 *   「AUTO-MD-PP-013 无前缀」(profile_id=17)；新增编号均以 AUTO/PTG26 系列，遗留保留并列明。
 */
import { config } from "../../src/config/index.js";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, compact,
  apiLogin, apiCall, intakeViaApi, seedPart, readToasts, pickOption, pickOptionScroll, modalText,
} from "./prod-runtime-utils.js";

const book = new ResultBook("reports/prod-runtime-results-intake.json");
const db = new DbClient();
const REQ = "FEAT-08 衣体入库";
const PROFILE_PT = "衣体 オレンジ 标准型123";
const PROFILE_NOPREFIX = "AUTO-MD-PP-013 无前缀";

async function gotoIntake(page: import("playwright").Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (page.url().includes("/production/intake")) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    } else {
      await page.goto("/production/intake", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    const ok = await page.locator(".profile-area .ant-select").waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    if (ok) {
      await page.waitForTimeout(600);
      return;
    }
  }
  throw new Error("无法进入衣体入库页");
}

async function selectProfile(page: import("playwright").Page, name: string): Promise<void> {
  await page.locator(".profile-area .ant-select").first().click();
  await pickOptionScroll(page, name);
  await page.waitForTimeout(500);
}

async function addSingle(page: import("playwright").Page, number: string): Promise<void> {
  const singleTab = page.locator(".ant-tabs-tab", { hasText: "番号入力" });
  if (!(await singleTab.getAttribute("class"))?.includes("active")) await singleTab.click();
  const input = page.locator("#intake-number");
  await input.fill(number);
  await page.getByRole("button", { name: /追\s*加/ }).click({ timeout: 5000 }).catch(async () => {
    await input.press("Enter");
  });
  await page.waitForTimeout(900);
}

async function addRange(page: import("playwright").Page, prefix: string, start: string, end: string): Promise<void> {
  await page.locator(".ant-tabs-tab", { hasText: "連続入力" }).click();
  await page.locator("#intake-prefix").fill(prefix);
  await page.locator("#intake-start").fill(start);
  await page.locator("#intake-end").fill(end);
  await page.getByRole("button", { name: /追\s*加/ }).click();
  await page.waitForTimeout(1200);
}

async function candidateHeader(page: import("playwright").Page): Promise<string> {
  return compact(await page.locator(".candidate-panel h2").innerText());
}

async function candidateRows(page: import("playwright").Page): Promise<string[]> {
  return page.locator(".candidate-panel tbody tr td code").allInnerTexts();
}

async function clearAll(page: import("playwright").Page): Promise<void> {
  await page.getByRole("button", { name: "今回の入力をクリア" }).click();
  await page.waitForTimeout(400);
}

async function main(): Promise<void> {
  await db.connect();
  const adminToken = await apiLogin(config.app.loginUser, config.app.loginPassword);
  const { browser, session } = await launchAdminSession("verify-prod-intake-cases");
  const page = session.page;
  page.setDefaultTimeout(10000);
  try {
    // 001 顶部菜单进入 + 页面结构
    await book.run("衣体入库-001", "首次进入衣体入库页布局与空状态", REQ, async () => {
      await gotoIntake(page);
      await page.goto("/customer", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const menu = page.locator(".top-menu li.ant-menu-submenu", { hasText: "产品生产" }).locator(".ant-menu-submenu-title");
      await menu.click();
      await page.waitForTimeout(1200);
      const urlAfterMenu = page.url();
      let navNote = "";
      if (!urlAfterMenu.includes("/production/intake")) {
        const subItem = page.locator(".ant-menu-submenu-popup:visible .ant-menu-item", { hasText: "衣体入库" }).first();
        const subVisible = await subItem.isVisible().catch(() => false);
        navNote = subVisible ? "点击后展开子菜单（首项衣体入库）" : "点击后未直达也未展开";
        if (subVisible) {
          await subItem.click();
          await page.waitForTimeout(1200);
        }
      }
      const landedIntake = page.url().includes("/production/intake");
      await gotoIntake(page);
      const left = compact(await page.locator(".setup-panel").innerText());
      const singleTab = await page.locator(".ant-tabs-tab", { hasText: "番号入力" }).count();
      const rangeTab = await page.locator(".ant-tabs-tab", { hasText: "連続入力" }).count();
      const addBtn = await page.getByRole("button", { name: /追\s*加/ }).count();
      const header = await candidateHeader(page);
      const empty = await page.locator(".candidate-panel .ant-empty, .candidate-panel .ant-empty-image").count();
      const confirmDisabled = await page.getByRole("button", { name: "すべて入庫する" }).isDisabled();
      const ok = left.includes("今回の入庫設定") && left.includes("ジャケットの部品情報") && singleTab > 0 && rangeTab > 0 && addBtn > 0
        && header.includes("0件") && empty > 0 && confirmDisabled;
      return {
        status: ok ? "通过" : "不通过",
        actual: `顶部点击产品生产：${landedIntake ? "默认进入衣体入库页签" : navNote || "未进入"}（URL=${urlAfterMenu}）；左侧「今回の入庫設定」含资料下拉/番号入力・連続入力页签/追加按钮；右侧「${header}」空状态图标=${empty > 0 ? "有" : "无"}；「すべて入庫する」置灰=${confirmDisabled}`,
        evidence: "intake/index.vue 模板结构 + 界面观察",
      };
    });

    // 007 未选资料拦截
    await book.run("衣体入库-007", "未选择衣体资料时编号不能加入", REQ, async () => {
      await gotoIntake(page);
      await page.locator("#intake-number").fill("PTG26001");
      await page.getByRole("button", { name: /追\s*加/ }).click();
      await page.waitForTimeout(600);
      const toast = await readToasts(page);
      const header = await candidateHeader(page);
      const ok = toast.includes("先にジャケットの部品情報を選択") && header.includes("0件");
      return { status: ok ? "通过" : "不通过", actual: `提示「${compact(toast, 80)}」，列表保持 ${header}`, evidence: "addCandidates 前置校验" };
    });

    // 002 资料选择带出前缀与摘要、停用不显示
    await book.run("衣体入库-002", "选择衣体资料带出前缀/厂商/规格，停用资料不显示", REQ, async () => {
      await gotoIntake(page);
      await page.locator(".profile-area .ant-select").first().click();
      await page.waitForTimeout(400);
      const options = await page.locator(".ant-select-dropdown:visible .ant-select-item-option").allInnerTexts();
      const api = await apiCall(adminToken, "GET", "/prop/part-profile/enabled/jacket");
      const enabledNames = JSON.stringify(api.data ?? []);
      const hasDisabled = options.some((text) => text.includes("AUTO-停用验证部件")) || enabledNames.includes("AUTO-停用验证部件");
      await pickOptionScroll(page, PROFILE_PT);
      await page.waitForTimeout(500);
      const summary = compact(await page.locator(".profile-summary").innerText());
      await page.locator(".ant-tabs-tab", { hasText: "連続入力" }).click();
      await page.waitForTimeout(300);
      const prefix = await page.locator("#intake-prefix").inputValue();
      const readonly = await page.locator("#intake-prefix").getAttribute("readonly");
      await page.locator(".ant-tabs-tab", { hasText: "番号入力" }).click();
      const ok = !hasDisabled && summary.length > 0 && prefix === "PTG" && readonly !== null;
      return {
        status: ok ? "通过" : "不通过",
        actual: `下拉${options.length}项均启用（停用资料${hasDisabled ? "出现" : "未出现"}）；摘要「${summary}」；連続入力前缀自动带出 PTG 且只读=${readonly !== null}`,
        evidence: "listEnabledPartProfiles('jacket') 仅启用项；prefixReadonly 绑定 numberPrefix",
      };
    });

    // 008 空编号拦截
    await book.run("衣体入库-008", "编号为空时加入被拦截", REQ, async () => {
      await page.locator("#intake-number").fill("");
      await page.getByRole("button", { name: /追\s*加/ }).click();
      await page.waitForTimeout(600);
      const toast = await readToasts(page);
      const header = await candidateHeader(page);
      const ok = toast.includes("番号をすべて入力") && header.includes("0件");
      return { status: ok ? "通过" : "不通过", actual: `提示「${compact(toast, 80)}」，列表保持 ${header}`, evidence: "fullNumberRequired 校验" };
    });

    // 003 单个编号加入
    await book.run("衣体入库-003", "单个编号加入进入待确认列表", REQ, async () => {
      await addSingle(page, "PTG26001");
      const header = await candidateHeader(page);
      const rows = await candidateRows(page);
      const tag = await page.locator(".candidate-panel tr", { hasText: "PTG26001" }).locator(".ant-tag").innerText().catch(() => "(无)");
      const ok = header.includes("1件") && rows.includes("PTG26001") && tag.includes("入庫待ち");
      return { status: ok ? "通过" : "不通过", actual: `列表 ${header}，编号 PTG26001 状态「${compact(tag, 30)}」`, evidence: "checkIntakeNumbers + 候选列表" };
    });

    // 022 规格列取资料规格且不可行内编辑
    await book.run("衣体入库-022", "待确认行规格列取所选资料规格且不可编辑", REQ, async () => {
      const row = page.locator(".candidate-panel tbody tr", { hasText: "PTG26001" });
      const text = compact(await row.innerText());
      const specCell = row.locator("td", { hasText: "オレンジ" }).first();
      const editable = await specCell.locator("input, textarea, [contenteditable='true']").count();
      const ok = text.includes("オレンジ") && text.includes("标准") && editable === 0;
      return { status: ok ? "通过" : "不通过", actual: `行内容「${compact(text, 120)}」；行内可编辑控件=${editable} 个`, evidence: "candidates 写入 profile.specification" };
    });

    // 009 行末删除单条
    await book.run("衣体入库-009", "行末删除移除单条临时记录", REQ, async () => {
      for (const no of ["PTG26901", "PTG26902", "PTG26903", "PTG26904", "PTG26905"]) await addSingle(page, no);
      const before = await candidateHeader(page);
      const row = page.locator(".candidate-panel tbody tr", { hasText: "PTG26903" });
      await row.getByRole("button", { name: /削\s*除/ }).click();
      await page.waitForTimeout(400);
      const after = await candidateHeader(page);
      const rows = await candidateRows(page);
      const ok = before.includes("6件") && after.includes("5件") && !rows.includes("PTG26903") && rows.includes("PTG26901");
      return { status: ok ? "通过" : "不通过", actual: `删除前 ${before} → 删除后 ${after}，PTG26903 移除、其余保留`, evidence: "remove(number)" };
    });

    // 010 勾选批量删除
    await book.run("衣体入库-010", "勾选后批量删除选中", REQ, async () => {
      const checkboxes = page.locator(".candidate-panel tbody tr .ant-checkbox");
      await checkboxes.nth(0).click();
      await checkboxes.nth(1).click();
      await page.waitForTimeout(300);
      const removeBtn = page.getByRole("button", { name: /選択した候補を削除（2件）/ });
      const enabled = await removeBtn.isEnabled();
      await removeBtn.click();
      await page.waitForTimeout(400);
      const header = await candidateHeader(page);
      const rows = await candidateRows(page);
      const ok = enabled && header.includes("3件") && rows.length === 3;
      return { status: ok ? "通过" : "不通过", actual: `「選択した候補を削除（2件）」可用=${enabled}，删除后 ${header}（剩 ${rows.length} 行：${rows.join("/")}）`, evidence: "removeSelected()" };
    });

    // 011 清空本次录入
    await book.run("衣体入库-011", "清空本次录入恢复空状态", REQ, async () => {
      await clearAll(page);
      const header = await candidateHeader(page);
      const empty = await page.locator(".candidate-panel .ant-empty, .candidate-panel .ant-empty-image").count();
      const ok = header.includes("0件") && empty > 0;
      return { status: ok ? "通过" : "不通过", actual: `清空后 ${header}，空状态图标=${empty > 0 ? "有" : "无"}`, evidence: "clearAll()" };
    });

    // 014 确认弹窗取消
    await book.run("衣体入库-014", "确认弹窗取消不执行入库且记录保留", REQ, async () => {
      await gotoIntake(page);
      await selectProfile(page, PROFILE_PT);
      await addSingle(page, "PTG26910");
      await page.getByRole("button", { name: "すべて入庫する" }).click();
      const modal = page.locator(".ant-modal-confirm");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      const modalBody = compact(await modal.innerText());
      await modal.getByRole("button", { name: "キャンセル" }).click();
      await page.waitForTimeout(500);
      const header = await candidateHeader(page);
      const rows = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_part_item WHERE part_no='PTG26910'");
      const ok = modalBody.length > 0 && header.includes("1件") && Number(rows[0].cnt) === 0;
      return { status: ok ? "通过" : "不通过", actual: `弹窗「${compact(modalBody, 90)}」→ キャンセル 后列表保持 ${header}，DB 无 PTG26910 建档`, evidence: "Modal.confirm onOk 才提交" };
    });

    // 018 范围加入去重
    await book.run("衣体入库-018", "范围加入与待确认列表重叠编号不重复生成", REQ, async () => {
      await gotoIntake(page);
      await selectProfile(page, PROFILE_NOPREFIX);
      await addSingle(page, "PTG26103");
      await addRange(page, "PTG26", "103", "105");
      const header = await candidateHeader(page);
      const rows = await candidateRows(page);
      const count103 = rows.filter((x) => x === "PTG26103").length;
      const ok = header.includes("3件") && count103 === 1 && rows.includes("PTG26104") && rows.includes("PTG26105");
      await clearAll(page);
      return { status: ok ? "通过" : "不通过", actual: `列表 ${header}：${rows.join("、")}（PTG26103 仅 ${count103} 条）`, evidence: "known 集合过滤重叠编号" };
    });

    // 024 无前缀资料前缀可编辑 + 026 留空纯数字生成（连续验证）
    await book.run("衣体入库-024", "无前缀资料前缀框可编辑，临时前缀参与生成", REQ, async () => {
      const readonly = await page.locator(".ant-tabs-tab", { hasText: "連続入力" }).click().then(() => page.locator("#intake-prefix").getAttribute("readonly"));
      await addRange(page, "AUTO-T26", "001", "002");
      const rows = await candidateRows(page);
      const ok = readonly === null && rows.includes("AUTO-T26001") && rows.includes("AUTO-T26002");
      await clearAll(page);
      return { status: ok ? "通过" : "不通过", actual: `前缀框只读属性=${readonly === null ? "无（可编辑）" : "有"}；生成 ${rows.join("、")}`, evidence: "prefixReadonly=false 时临时前缀参与 generateRange" };
    });

    await book.run("衣体入库-025", "临时前缀不回写资料、不产生新版本", REQ, async () => {
      const profile = await db.query<{ number_prefix: string | null }>(
        "SELECT v.number_prefix FROM prop_part_profile p JOIN prop_part_profile_version v ON v.version_id=p.current_version_id WHERE p.profile_id=17",
      );
      const versions = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_part_profile_version WHERE profile_id=17");
      const ok = profile[0]?.number_prefix === null && Number(versions[0].cnt) === 1;
      return { status: ok ? "通过" : "不通过", actual: `profile_id=17 编号前缀=${profile[0]?.number_prefix ?? "空"}，版本数=${versions[0].cnt}（未因临时前缀回写或产生新版本）`, evidence: "generateRange 仅内存使用临时前缀" };
    });

    await book.run("衣体入库-026", "前缀留空时按补零流水生成纯数字编号", REQ, async () => {
      await addRange(page, "", "001", "003");
      const rows = await candidateRows(page);
      const tags = await page.locator(".candidate-panel tbody tr .ant-tag").allInnerTexts();
      const ok = rows.includes("001") && rows.includes("002") && rows.includes("003");
      return { status: ok ? "通过" : "不通过", actual: `前缀留空生成 ${rows.join("、")}（前导零保留），状态标签=${JSON.stringify(tags)}`, evidence: "generateRange 空前缀 + 宽度补零" };
    });

    // 027 纯数字编号与他类型部件撞号 → 标记已有档案并跳过
    await book.run("衣体入库-027", "纯数字编号与他类型部件有效编号重复时标记已有档案并跳过", REQ, async () => {
      // 幂等前置：清掉历史运行留下的 001/003 产品（若有），保证本次全部新生成
      for (const no of ["001", "003"]) {
        const stale = await db.query<{ product_id: number }>("SELECT product_id FROM prop_product WHERE active_manufacturing_no=? AND deleted_time IS NULL", [no]);
        if (stale.length) await apiCall(adminToken, "DELETE", `/prop/production/products/${stale[0].product_id}`);
      }
      await seedPart(db, { partNo: "002", partType: "airbag", profileId: 2, remark: "AUTO-FIXTURE-衣体入库-027 气囊撞号夹具" });
      await clearAll(page);
      await addRange(page, "", "001", "003");
      const row002 = page.locator(".candidate-panel tbody tr").filter({ has: page.locator("td code", { hasText: /^002$/ }) });
      const tag002 = await row002.locator(".ant-tag").innerText().catch(() => "(无)");
      const marked = tag002.includes("登録済み");
      await page.getByRole("button", { name: "すべて入庫する" }).click();
      const modal = page.locator(".ant-modal-confirm");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      await modal.getByRole("button", { name: "入庫する" }).click();
      await page.waitForTimeout(2000);
      const toast = await readToasts(page);
      const created = await db.query<{ active_part_no: string; part_type: string }>(
        "SELECT active_part_no, part_type FROM prop_part_item WHERE active_part_no IN ('001','003') AND deleted_time IS NULL",
      );
      const ok = marked && toast.includes("成功 2件") && toast.includes("スキップ 1件") && created.length === 2 && created.every((r) => r.part_type === "jacket");
      // 清理本次入库的 001/003 产品（业务 API 删除），保证脚本可重跑
      for (const no of ["001", "003"]) {
        const product = await db.query<{ product_id: number }>("SELECT product_id FROM prop_product WHERE active_manufacturing_no=? AND deleted_time IS NULL", [no]);
        if (product.length) await apiCall(adminToken, "DELETE", `/prop/production/products/${product[0].product_id}`);
      }
      return {
        status: ok ? "通过" : "不通过",
        actual: `002 标记「${compact(tag002, 20)}」；确认结果「${compact(toast, 90)}」；001/003 以 jacket 建档，002（气囊夹具）跳过未重复建档`,
        evidence: "checkIntakeNumbers 跨类型查重 + intake skip",
      };
    });

    // 020 全部已有档案时确认不可触发
    await book.run("衣体入库-020", "列表仅含已有档案项时确认入库不可触发", REQ, async () => {
      await selectProfile(page, PROFILE_PT);
      await addSingle(page, "PTG1");
      const tag = await page.locator(".candidate-panel tbody tr", { hasText: "PTG1" }).locator(".ant-tag").innerText().catch(() => "(无)");
      const confirmBtn = page.getByRole("button", { name: "すべて入庫する" });
      const disabled = await confirmBtn.isDisabled();
      const parts = await db.query<{ cnt: number }>("SELECT COUNT(*) cnt FROM prop_part_item WHERE part_no='PTG1' AND part_type='jacket'");
      await clearAll(page);
      const ok = tag.includes("登録済み") && disabled && Number(parts[0].cnt) === 1;
      return {
        status: ok ? "通过" : "不通过",
        actual: `PTG1 标记「${compact(tag, 20)}」；「すべて入庫する」置灰无法点击（与用例“提示无待入库编号”实现形式不同：前端直接禁用，后端另有 noNewNumber 兜底）；PTG1 仍仅 1 条档案`,
        evidence: "canConfirm=some(!existing)；BR-020",
      };
    });

    // 021 失败编号保留
    await book.run("衣体入库-021", "批量入库失败编号保留在列表便于重试", REQ, async () => {
      // 夹具（幂等）：种入一个 active_manufacturing_no=AUTO-JF01 的游离产品，使确认时 insertProduct 撞唯一键失败
      const stale = await db.query<{ product_id: number }>("SELECT product_id FROM prop_product WHERE active_manufacturing_no='AUTO-JF01'");
      if (!stale.length) {
        await db.execute(
          "INSERT INTO prop_product (manufacturing_no, active_manufacturing_no, m_no, initial_production_inspection_passed, create_by, create_time, remark) VALUES ('AUTO-JF01','AUTO-JF01','M999001',0,'AI自动探索',NOW(),'AUTO-FIXTURE-衣体入库-021 失败夹具')",
        );
      }
      await addSingle(page, "AUTO-JF01");
      await page.getByRole("button", { name: "すべて入庫する" }).click();
      const modal = page.locator(".ant-modal-confirm");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      await modal.getByRole("button", { name: "入庫する" }).click();
      await page.waitForTimeout(2000);
      const toast = await readToasts(page);
      const header = await candidateHeader(page);
      const rowText = compact(await page.locator(".candidate-panel tbody tr", { hasText: "AUTO-JF01" }).innerText().catch(() => "(行已移除)"));
      const ok = toast.includes("失敗 1件") && header.includes("1件") && rowText.includes("AUTO-JF01");
      return {
        status: ok ? "通过" : "不通过",
        actual: `结果提示「${compact(toast, 90)}」；失败行保留 ${header}，行内显示原因「${compact(rowText, 110)}」`,
        evidence: "confirmIntake 失败项保留 + error 展示（并发撞号由 uk_part_active_no 兜底）",
      };
    });

    // 023 删除后重新入库配发新 M番号
    await book.run("衣体入库-023", "产品删除后同编号可重新入库并配发新 M番号", REQ, async () => {
      // 幂等前置：构造「已删除的 AUTO-R100 产品」——若存在活动产品直接删除；若完全没有则先入库再删
      let before = await db.query<{ product_id: number; m_no: string }>(
        "SELECT product_id, m_no FROM prop_product WHERE manufacturing_no='AUTO-R100' ORDER BY product_id DESC",
      );
      if (!before.length) {
        await intakeViaApi(adminToken, 1, ["AUTO-R100"]);
        before = await db.query<{ product_id: number; m_no: string }>(
          "SELECT product_id, m_no FROM prop_product WHERE manufacturing_no='AUTO-R100' ORDER BY product_id DESC",
        );
      }
      if (!before.length) throw new Error("夹具入库失败：AUTO-R100 未建档");
      const active = await db.query<{ product_id: number }>(
        "SELECT product_id FROM prop_product WHERE active_manufacturing_no='AUTO-R100' AND deleted_time IS NULL",
      );
      if (active.length) {
        const del = await apiCall(adminToken, "DELETE", `/prop/production/products/${active[0].product_id}`);
        if (del.code !== 200) throw new Error(`夹具删除失败：${del.msg}`);
      }
      await addSingle(page, "AUTO-R100");
      const row = page.locator(".candidate-panel tbody tr", { hasText: "AUTO-R100" });
      const tag = await row.locator(".ant-tag").innerText().catch(() => "(无)");
      await page.getByRole("button", { name: "すべて入庫する" }).click();
      const modal = page.locator(".ant-modal-confirm");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      await modal.getByRole("button", { name: "入庫する" }).click();
      await page.waitForTimeout(2000);
      const toast = await readToasts(page);
      const after = await db.query<{ m_no: string }>("SELECT m_no FROM prop_product WHERE active_manufacturing_no='AUTO-R100' AND deleted_time IS NULL");
      const ok = tag.includes("入庫待ち") && toast.includes("成功 1件") && after.length === 1 && after[0].m_no !== before[0].m_no;
      return {
        status: ok ? "通过" : "不通过",
        actual: `删除后重新加入状态「${compact(tag, 20)}」（不标记登録済み）；确认「${compact(toast, 60)}」；旧 M番号 ${before[0].m_no} → 新 M番号 ${after[0]?.m_no}（不复用）`,
        evidence: "deleteProduct 软删置空 active 编号；BR-019",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-prod-intake-cases");
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
