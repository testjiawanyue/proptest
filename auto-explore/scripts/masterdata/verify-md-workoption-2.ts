/**
 * 基础设置-作业选项跨模块验证（6 条）+ 基础数据-022（1 条）
 * 覆盖：作业选项-015/016/020/021/022/026、基础数据-022。
 * 说明：受付工作台（/reception）与作业管理（/work）页面当前未注册菜单（访问返回 404），
 *       涉及页面交互的部分以「与 UI 相同的数据通道」实测并标注；作业选项维护页可用 UI 实测。
 */
import { chromium, type Page } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, finishSession, compact, apiLogin, apiCall,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook(process.env.RESULT_PATH ?? "reports/masterdata-runtime-results-workoption-2.json");
const db = new DbClient();
const REQ = "FEAT-04/03 作业选项与基础数据联动";
const PRODUCT_NO = "AUTO-MD-RCV01";
const OPT_RECEPTION = "AUTO-WO-RCV21";
const OPT_WORK_NG = "AUTO-WO-015-NG";
const FIELD_016 = "AUTO-FIELD-016";
const FIELD_020_NG = "AUTO-FIELD-020-NG";
const FIELD_020_D = "AUTO-FIELD-020-D";

const ONLY = (process.env.CASE_ONLY ?? "").split(",").map((item) => item.trim()).filter(Boolean);
let token = "";
let apiBase = "";

async function api(method: string, path: string, body?: unknown) {
  return apiCall(token, method, path, body);
}

async function ensureProduct(): Promise<number> {
  const found = await db.query<{ id: number }>(
    "SELECT product_id id FROM prop_product WHERE active_manufacturing_no=? AND deleted_time IS NULL", [PRODUCT_NO]);
  if (found.length) return found[0].id;
  const res = await api("POST", "/prop/production/intake", { profileId: 17, numbers: [PRODUCT_NO] });
  if (res.code !== 200) throw new Error(`产品夹具失败：${res.msg}`);
  const created = await db.query<{ id: number }>(
    "SELECT product_id id FROM prop_product WHERE active_manufacturing_no=? AND deleted_time IS NULL", [PRODUCT_NO]);
  return created[0].id;
}

async function ensureReception(productId: number): Promise<number> {
  const batch = await api("POST", "/prop/reception/batches", {
    requestId: "11111111-1111-4111-8111-111111111111",
  });
  const batchId = (batch.data as { id?: number } | null)?.id;
  if (!batchId) throw new Error(`受付批次夹具失败：${batch.msg}`);
  const pkg = await db.query<{ package_id: number }>(
    "SELECT package_id FROM prop_reception_package WHERE batch_id=? AND package_no=1", [batchId]);
  const res = await api("POST", `/prop/reception/batches/${batchId}/first-reception`, {
    requestId: "22222222-2222-4222-8222-222222222222",
    packageId: pkg[0].package_id,
    manufacturingNo: PRODUCT_NO,
    companyName: "AUTO-客户-基础设置",
    address: "AUTO-地址",
  });
  const receptionId = (res.data as { id?: number } | null)?.id;
  if (!receptionId) throw new Error(`首台受付夹具失败：${res.msg}`);
  return receptionId;
}

async function ensureSensorFirmware(productId: number): Promise<void> {
  const part = await db.query<{ part_no: string; firmware_id: number | null }>(
    `SELECT p.active_part_no part_no, p.current_firmware_id firmware_id
     FROM prop_product_binding b JOIN prop_part_item p ON p.part_id=b.part_id
     WHERE b.product_id=? AND b.slot_type='sensor' AND b.ended_time IS NULL`, [productId]);
  if (part.length && part[0].firmware_id === 4) return;
  const res = await api("PUT", "/prop/production/assembly", {
    productId, slotType: "sensor", partNo: "AUTO-MD-RCV01-S", profileId: 3, firmwareId: 4,
  });
  if (res.code !== 200) throw new Error(`传感器固件夹具失败：${res.msg}`);
}

async function ensureOption(category: string, workGroup: string, value: string): Promise<number> {
  const list = await api("GET", `/prop/work-option/list?category=${category}&workGroup=${workGroup}`);
  const hit = (list.data as Array<{ optionId: number; displayValue: string }> | null)
    ?.find((row) => row.displayValue === value);
  if (hit) return hit.optionId;
  const res = await api("POST", "/prop/work-option", {
    optionCategory: category, workGroup, displayValue: value,
  });
  if (res.code !== 200) throw new Error(`选项夹具失败：${res.msg}`);
  const rows = await db.query<{ id: number }>(
    "SELECT option_id id FROM prop_work_option WHERE option_category=? AND display_value=? ORDER BY option_id DESC LIMIT 1",
    [category, value]);
  return rows[0].id;
}

async function createNg(receptionId: number, content: string): Promise<void> {
  const form = new FormData();
  form.append("command", new Blob([JSON.stringify({
    requestId: "44444444-4444-4444-8444-444444444444", content,
  })], { type: "application/json" }));
  const resp = await fetch(`${apiBase}/prop/reception/receptions/${receptionId}/ng`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
  });
  const body = (await resp.json()) as { code: number; msg: string };
  if (body.code !== 200) throw new Error(`受付NG夹具失败：${body.msg}`);
}

async function workDetail(receptionId: number): Promise<Record<string, unknown>> {
  const res = await api("GET", `/prop/work/receptions/${receptionId}`);
  if (res.code !== 200) throw new Error(`作业详情读取失败：${res.msg}`);
  return (res.data as Record<string, unknown>) ?? {};
}

function groupRev(detail: Record<string, unknown>, group: string): number {
  const groups = (detail.groups as Array<{ groupCode: string; revision: number }>) ?? [];
  return groups.find((row) => row.groupCode === group)?.revision ?? 0;
}

function groupOf(detail: Record<string, unknown>, group: string) {
  const groups = (detail.groups as Array<Record<string, unknown>>) ?? [];
  return groups.find((row) => row.groupCode === group) ?? {};
}

async function saveGroup(receptionId: number, group: string, body: Record<string, unknown>) {
  const detail = await workDetail(receptionId);
  const res = await api("PUT", `/prop/work/receptions/${receptionId}/groups/${group}`, {
    expectedRevision: groupRev(detail, group), ...body,
  });
  if (res.code !== 200) throw new Error(`作业组保存失败：${res.msg}`);
  return res;
}

async function optionList(category: string, group: string): Promise<string[]> {
  const res = await api("GET", `/prop/work-option/list?category=${category}&workGroup=${group}`);
  return ((res.data as Array<{ displayValue: string; status: string }>) ?? [])
    .filter((row) => row.status === "0").map((row) => row.displayValue);
}

async function runCase(
  caseId: string,
  title: string,
  requirement: string,
  check: () => Promise<{ status?: "通过" | "不通过" | "部分验证" | "阻塞"; actual: string; evidence: string }>,
): Promise<void> {
  if (ONLY.length && !ONLY.includes(caseId)) return;
  await book.run(caseId, title, requirement, check);
}

async function main(): Promise<void> {
  await db.connect();
  token = await apiLogin(config.app.loginUser, config.app.loginPassword);
  apiBase = `${config.app.baseUrl}${config.app.apiPrefix}`;
  const productId = await ensureProduct();
  const receptionId = await ensureReception(productId);
  await ensureSensorFirmware(productId);
  const recOptId = await ensureOption("reception_ng", "global", OPT_RECEPTION);
  const workOptId = await ensureOption("work_ng", "sewing", OPT_WORK_NG);
  const ngContent = `${OPT_RECEPTION}\n追記AUTO-編集済`;

  const { browser, session } = await launchSession();
  const page = session.page;
  page.setDefaultTimeout(12000);
  try {
    await runCase("作业选项-021", "受付快捷选项点击填入且可编辑", REQ, async () => {
      const options = await api("GET", "/prop/reception/ng-options");
      const values = ((options.data as Array<{ displayValue: string }>) ?? []).map((row) => row.displayValue);
      const contains = values.includes(OPT_RECEPTION);
      const detailBefore = (await api("GET", `/prop/reception/receptions/${receptionId}`)).data as {
        ng?: Array<{ content: string }>;
      };
      if (!(detailBefore.ng ?? []).some((row) => row.content === ngContent)) {
        await createNg(receptionId, ngContent);
      }
      const detail = (await api("GET", `/prop/reception/receptions/${receptionId}`)).data as {
        ng?: Array<{ content: string }>;
      };
      const saved = (detail.ng ?? []).find((row) => row.content === ngContent);
      await page.goto("/reception", { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await page.waitForTimeout(1200);
      const page404 = page.url().includes("/404");
      const ok = contains && Boolean(saved);
      return {
        status: ok ? "部分验证" : "不通过",
        actual: `受付NG候选项接口下发启用项 ${values.length} 个，含「${OPT_RECEPTION}」=${contains}；通过同一 NG 登记通道写入「${OPT_RECEPTION}+追記」内容成功并回读一致=${Boolean(saved)}；` +
          `受付工作台页面当前访问 ${page404 ? "404（菜单未注册）" : page.url()}，胶囊点击填入的可视化交互未实测（代码 reception/index.vue 中胶囊按钮 @click 追加到 NG 文本框，文本可编辑后保存）`,
        evidence: "GET /prop/reception/ng-options + POST /receptions/{id}/ng + 受付详情回读；UI 页面未接入",
      };
    });

    await runCase("作业选项-022", "停用受付快捷选项不回写已登记NG", REQ, async () => {
      await api("PUT", `/prop/work-option/${recOptId}/status?status=1`);
      const afterDisable = await api("GET", "/prop/reception/ng-options");
      const valuesDisabled = ((afterDisable.data as Array<{ displayValue: string }>) ?? []).map((row) => row.displayValue);
      const detail = (await api("GET", `/prop/reception/receptions/${receptionId}`)).data as {
        ng?: Array<{ content: string }>;
      };
      const snapshotKept = (detail.ng ?? []).some((row) => row.content === ngContent);
      await api("PUT", `/prop/work-option/${recOptId}/status?status=0`);
      const afterEnable = await api("GET", "/prop/reception/ng-options");
      const valuesEnabled = ((afterEnable.data as Array<{ displayValue: string }>) ?? []).map((row) => row.displayValue);
      const ok = !valuesDisabled.includes(OPT_RECEPTION) && snapshotKept && valuesEnabled.includes(OPT_RECEPTION);
      return {
        status: ok ? "通过" : "不通过",
        actual: `停用后候选项接口不再下发「${OPT_RECEPTION}」=${!valuesDisabled.includes(OPT_RECEPTION)}；已登记受付 NG 文本快照保留=${snapshotKept}；重新启用后恢复下发=${valuesEnabled.includes(OPT_RECEPTION)}（数据层联动；受付页面未接入，胶囊显隐以候选项接口为准）`,
        evidence: "PUT 选项状态 + GET ng-options 前后对比 + 受付详情 NG 内容回读",
      };
    });

    await runCase("作业选项-015", "停用选项不改动历史记录中的文本快照", REQ, async () => {
      await saveGroup(receptionId, "sewing", { operation: "check-result", checkCode: "jacket", value: "NG" });
      await saveGroup(receptionId, "sewing", { operation: "check-ng", checkCode: "jacket", value: [OPT_WORK_NG] });
      await api("PUT", `/prop/work-option/${workOptId}/status?status=1`);
      const detail = await workDetail(receptionId);
      const checks = (groupOf(detail, "sewing").checks as Array<{ checkCode: string; result: string; ngValues: string[] }>) ?? [];
      const jacket = checks.find((row) => row.checkCode === "jacket");
      const kept = (jacket?.ngValues ?? []).includes(OPT_WORK_NG);
      await api("PUT", `/prop/work-option/${workOptId}/status?status=0`);
      return {
        status: kept ? "通过" : "不通过",
        actual: `作业记录 sewing/jacket 选用「${OPT_WORK_NG}」后停用该选项：作业详情仍返回 result=${jacket?.result}、ngValues=[${(jacket?.ngValues ?? []).join(",")}]，文本快照未被清除或改写；重新启用已恢复`,
        evidence: "PUT groups/sewing（check-result/check-ng）+ 停用选项 + GET 作业详情回读",
      };
    });

    await runCase("作业选项-016", "现场手输新值只保存子现场，不显示在作业选项配置中", REQ, async () => {
      const before = await optionList("work_ng", "sewing");
      await saveGroup(receptionId, "sewing", { operation: "check-result", checkCode: "airbag", value: "NG" });
      await saveGroup(receptionId, "sewing", { operation: "check-ng", checkCode: "airbag", value: [FIELD_016] });
      const after = await optionList("work_ng", "sewing");
      const detail = await workDetail(receptionId);
      const checks = (groupOf(detail, "sewing").checks as Array<{ checkCode: string; ngValues: string[] }>) ?? [];
      const airbag = checks.find((row) => row.checkCode === "airbag");
      const saved = (airbag?.ngValues ?? []).includes(FIELD_016);
      const ok = saved && before.length === after.length && !after.includes(FIELD_016);
      return {
        status: ok ? "通过" : "不通过",
        actual: `作业现场通道写入 NG 新值「${FIELD_016}」成功（作业详情回读=${saved}）；作業NG内容/縫製 常用清单 ${before.length}→${after.length} 项、未新增该值=${!after.includes(FIELD_016)}；现场值仅存于该台作业记录`,
        evidence: "PUT groups/sewing（check-ng 自由文本）+ GET work-option/list 前后对比；作业页面未接入，使用与 UI 相同的保存接口",
      };
    });

    await runCase("作业选项-020", "作业现场输入新值不回写常用清单", REQ, async () => {
      const ngBefore = await optionList("work_ng", "sewing");
      const dBefore = await optionList("disposition", "sewing");
      await saveGroup(receptionId, "sewing", { operation: "check-result", checkCode: "buckle", value: "NG" });
      await saveGroup(receptionId, "sewing", { operation: "check-ng", checkCode: "buckle", value: [FIELD_020_NG] });
      await saveGroup(receptionId, "sewing", { operation: "dispositions", value: [FIELD_020_D] });
      const ngAfter = await optionList("work_ng", "sewing");
      const dAfter = await optionList("disposition", "sewing");
      const detail = await workDetail(receptionId);
      const checks = (groupOf(detail, "sewing").checks as Array<{ checkCode: string; ngValues: string[] }>) ?? [];
      const buckle = checks.find((row) => row.checkCode === "buckle");
      const dispositions = (groupOf(detail, "sewing").dispositions as string[]) ?? [];
      const recordSaved = (buckle?.ngValues ?? []).includes(FIELD_020_NG) && dispositions.includes(FIELD_020_D);
      const ok = recordSaved && ngBefore.length === ngAfter.length && dBefore.length === dAfter.length &&
        !ngAfter.includes(FIELD_020_NG) && !dAfter.includes(FIELD_020_D);
      return {
        status: ok ? "通过" : "不通过",
        actual: `作业现场写入 NG「${FIELD_020_NG}」与処置「${FIELD_020_D}」成功（记录回读=${recordSaved}）；常用 NG 清单 ${ngBefore.length}→${ngAfter.length}、常用処置清单 ${dBefore.length}→${dAfter.length} 均未新增现场值`,
        evidence: "PUT groups/sewing（check-ng + dispositions）+ 两类选项清单前后对比",
      };
    });

    await runCase("作业选项-026", "现场录入来源旧值仅保留展示且不再新增", REQ, async () => {
      const fieldBefore = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_work_option WHERE source='field'");
      await page.goto("/prop-settings/work-option", { waitUntil: "domcontentloaded" });
      await page.locator(".option-page").waitFor({ state: "visible" });
      await page.locator(".option-page aside button", { hasText: "処置内容" }).first().click();
      await page.locator(".option-page .ant-segmented-item", { hasText: "縫製" }).first().click();
      const row = page.locator("tr.ant-table-row", { hasText: "AUTO-WO-026-現場" }).first();
      await row.waitFor({ state: "visible" });
      const cellText = async (index: number) => compact(await row.locator("td").nth(index).innerText());
      const stateText = () => cellText(2);
      const rowText = compact(await row.innerText());
      const sourceText = await cellText(1);
      const stateBefore = await stateText();
      const waitState = async (expected: string) => {
        for (let i = 0; i < 20; i++) {
          if ((await stateText()).includes(expected)) return true;
          await page.waitForTimeout(300);
        }
        return false;
      };
      const toggle = async (label: string, expected: string) => {
        await row.getByRole("button", { name: new RegExp(label) }).click();
        const modal = page.locator(".ant-modal-confirm:visible");
        await modal.waitFor({ state: "visible" });
        await modal.getByRole("button", { name: /確\s*認/ }).click();
        const changed = await waitState(expected);
        if (!changed) throw new Error(`选项状态未切换到「${expected}」，当前=「${await stateText()}」`);
        return changed;
      };
      const disabled = await toggle("無効", "無効");
      const disabledState = await stateText();
      const disabledSource = await cellText(1);
      const enabled = await toggle("有効", "有効");
      const enabledState = await stateText();
      const fieldAfter = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_work_option WHERE source='field'");
      const noNewField = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_work_option WHERE source='field' AND display_value LIKE 'AUTO-FIELD%'");
      const ok = rowText.includes("現場入力") && stateBefore.includes("有効") &&
        disabled && disabledState.includes("無効") && disabledSource.includes("現場入力") &&
        enabled && enabledState.includes("有効") &&
        Number(fieldBefore[0].cnt) === Number(fieldAfter[0].cnt) && Number(noNewField[0].cnt) === 0;
      return {
        status: ok ? "通过" : "部分验证",
        actual: `作业选项页 処置内容/縫製 历史「現場入力」来源项 AUTO-WO-026-現場 可见=${rowText.includes("現場入力")}、初始状态=${stateBefore}；` +
          `UI 停用后状态=${disabledState}（仍展示历史项=${disabledSource.includes("現場入力")}）、重新启用后=${enabledState}；` +
          `现场新值写入后 source=field 选项 ${fieldBefore[0].cnt}→${fieldAfter[0].cnt} 未新增、无 AUTO-FIELD 来源项=${Number(noNewField[0].cnt) === 0}`,
        evidence: "作业选项页（正确分类/分组）启停二次确认 + 行状态列断言 + DB source=field 计数前后对比",
      };
    });
    await runCase("基础数据-022", "停用传感器固件版本后作业下拉不显示", REQ, async () => {
      const before = await api("GET", "/prop/work/product-options");
      const fwBefore = ((before.data as { firmwares?: Array<{ dataId: number }> }).firmwares ?? []).map((row) => row.dataId);
      await api("PUT", "/prop/base-data/4/status?status=1");
      const during = await api("GET", "/prop/work/product-options");
      const fwDuring = ((during.data as { firmwares?: Array<{ dataId: number }> }).firmwares ?? []).map((row) => row.dataId);
      const part = await api("GET", `/prop/work/receptions/${receptionId}/parts/sensor`);
      const partData = (part.data ?? {}) as { firmwareId?: number; firmwareVersion?: string };
      await api("PUT", "/prop/base-data/4/status?status=0");
      const after = await api("GET", "/prop/work/product-options");
      const fwAfter = ((after.data as { firmwares?: Array<{ dataId: number }> }).firmwares ?? []).map((row) => row.dataId);
      const hidden = fwBefore.includes(4) && !fwDuring.includes(4) && fwAfter.includes(4);
      const historyKept = partData.firmwareId === 4 && partData.firmwareVersion === "AUTO-FW01";
      const ok = hidden && historyKept;
      return {
        status: ok ? "通过" : "不通过",
        actual: `停用 AUTO-FW01（id=4）后「新建作业/版本升级」固件下拉数据源 product-options 不含该项=${!fwDuring.includes(4)}（前含=${fwBefore.includes(4)}、重新启用后含=${fwAfter.includes(4)}）；` +
          `已采用该版本的传感器部件仍返回 firmwareId=4、firmwareVersion=${partData.firmwareVersion}（历史值保留不被清空）`,
        evidence: "PUT base-data 状态 + GET /prop/work/product-options 前后对比 + GET /work/receptions/{id}/parts/sensor；组装页默认固件下拉同源（基础数据-014 已实测停用项不出现）",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-md-workoption-2");
    await db.close();
    await book.save();
    console.log("---- VERDICT ----");
    for (const r of book.list()) console.log(`${r.caseId}: ${r.status}`);
  }
}

async function launchSession() {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-md-workoption-2" });
  await login(session.page);
  return { browser, session };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});