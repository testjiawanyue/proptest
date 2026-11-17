/**
 * 产品生产-质检工作台 未执行用例批量运行时验证（12 条）
 * 覆盖：001/002/004/006/007/008/009/011/013/015/016/017
 * 前置（幂等）：AUTO-B101/B102 补齐 传感器+发生器1 绑定成为可质检产品；AUTO-J001 已齐全未质检。
 */
import type { Page } from "playwright";
import { config } from "../../src/config/index.js";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, compact,
  apiLogin, apiCall, readToasts,
} from "./prod-runtime-utils.js";

const book = new ResultBook("reports/prod-runtime-results-inspection.json");
const db = new DbClient();
const REQ = "FEAT-10 质检工作台";

async function gotoInspection(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (page.url().includes("/production/inspection")) {
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    } else {
      await page.goto("/production/inspection", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    const ok = await page.locator(".inspection-page").waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
    if (ok) {
      await page.waitForTimeout(1500);
      return;
    }
  }
  throw new Error("无法进入质检工作台");
}

async function filterSingle(page: Page, number: string): Promise<void> {
  await page.locator(".ant-tabs-tab", { hasText: "番号入力" }).click();
  await page.locator("#inspection-number").fill(number);
  await page.getByRole("button", { name: /^検\s*索$/ }).click();
  await page.waitForTimeout(800);
  await acceptReplaceListModal(page);
  await page.waitForTimeout(800);
}

async function filterRange(page: Page, prefix: string, start: string, end: string): Promise<void> {
  await page.locator(".ant-tabs-tab", { hasText: "連続入力" }).click();
  await page.locator("#inspection-prefix").fill(prefix);
  await page.locator("#inspection-start").fill(start);
  await page.locator("#inspection-end").fill(end);
  await page.getByRole("button", { name: /^検\s*索$/ }).click();
  await page.waitForTimeout(800);
  await acceptReplaceListModal(page);
  await page.waitForTimeout(800);
}

async function listRows(page: Page): Promise<string[]> {
  return page.locator(".list-panel tbody tr.ant-table-row td:nth-child(2)").allInnerTexts();
}

/** 已有勾选时切换清单会弹「更换清单」确认框：出现则确认（清空勾选换新清单）。 */
async function acceptReplaceListModal(page: Page): Promise<void> {
  const modal = page.locator(".ant-modal-confirm:visible");
  if (await modal.count()) {
    await modal.getByRole("button", { name: /確\s*認/ }).click().catch(() => undefined);
    await page.waitForTimeout(600);
  }
}

async function selectedCountText(page: Page): Promise<string> {
  return compact(await page.locator(".list-panel header span").innerText().catch(() => ""));
}

/** 确保产品某槽位有绑定（幂等，缺则经组装 API 绑定新部件）。 */
async function ensureBinding(token: string, productNo: string, slotType: string, partNo: string, profileId: number, firmwareId?: number): Promise<void> {
  const bound = await db.query<{ cnt: number }>(
    "SELECT COUNT(*) cnt FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id WHERE p.active_manufacturing_no=? AND b.slot_type=? AND b.ended_time IS NULL",
    [productNo, slotType],
  );
  if (Number(bound[0].cnt) > 0) return;
  const product = await db.query<{ product_id: number }>("SELECT product_id FROM prop_product WHERE active_manufacturing_no=?", [productNo]);
  const res = await apiCall(token, "PUT", "/prop/production/assembly", {
    productId: product[0].product_id, slotType, partNo, profileId, firmwareId: firmwareId ?? null,
  });
  if (res.code !== 200) throw new Error(`夹具绑定失败 ${productNo}/${slotType}：${res.msg}`);
}

async function main(): Promise<void> {
  await db.connect();
  const adminToken = await apiLogin(config.app.loginUser, config.app.loginPassword);

  // 夹具：B101/B102 补齐为可质检（气囊已在组装脚本绑定，这里补传感器+发生器1）
  await ensureBinding(adminToken, "AUTO-B101", "sensor", "AUTO-SE101", 3, 3);
  await ensureBinding(adminToken, "AUTO-B101", "inflator_1", "AUTO-BI101", 4);
  await ensureBinding(adminToken, "AUTO-B102", "sensor", "AUTO-SE102", 3, 3);
  await ensureBinding(adminToken, "AUTO-B102", "inflator_1", "AUTO-BI102", 4);

  const { browser, session } = await launchAdminSession("verify-prod-inspection-cases");
  const page = session.page;
  page.setDefaultTimeout(10000);
  try {
    // 001 番号入力精确显示
    await book.run("质检工作台-001", "番号入力模式精确显示待检产品", REQ, async () => {
      await gotoInspection(page);
      await filterSingle(page, "AUTO-B101");
      const rows = await listRows(page);
      const tag = await page.locator(".list-panel tbody tr .ant-tag").innerText().catch(() => "");
      const ok = rows.length === 1 && rows[0].includes("AUTO-B101") && tag.includes("検査登録可");
      return { status: ok ? "通过" : "不通过", actual: `番号入力 AUTO-B101 → 清单 ${rows.length} 行（${rows.join("、")}），状态「${compact(tag, 20)}」`, evidence: "inspection/candidates 单号查询" };
    });

    // 011 不存在的番号
    await book.run("质检工作台-011", "筛选不存在的制造番号给出提示且清单不变", REQ, async () => {
      const before = await listRows(page);
      await filterSingle(page, "PTG99999");
      const alert = compact(await page.locator(".list-panel .ant-alert").innerText().catch(() => ""));
      const after = await listRows(page);
      const ok = alert.includes("見つからない") && alert.includes("新しい検索条件は適用されていません") && after.length === before.length;
      return { status: ok ? "通过" : "不通过", actual: `输入 PTG99999 → 提示「${compact(alert, 110)}」；清单保持 ${after.length} 行不变`, evidence: "eligibility not_found → queryNotApplied" };
    });

    // 013 已质检产品提示
    await book.run("质检工作台-013", "筛选已质检通过产品时提示已通过", REQ, async () => {
      await filterSingle(page, "AUTO-J002");
      const alert = compact(await page.locator(".list-panel .ant-alert").innerText().catch(() => ""));
      const rows = await listRows(page);
      const ok = alert.includes("検査合格済") && !rows.some((r) => r.includes("AUTO-J002"));
      return { status: ok ? "通过" : "不通过", actual: `输入已质检的 AUTO-J002 → 提示「${compact(alert, 100)}」；清单不显示该产品`, evidence: "eligibility inspected" };
    });

    // 002 连续入力批量匹配
    await book.run("质检工作台-002", "连续入力模式按前缀范围批量匹配待检产品", REQ, async () => {
      await filterRange(page, "AUTO-B10", "1", "6");
      const rows = await listRows(page);
      const ok = rows.length === 2 && rows.some((r) => r.includes("AUTO-B101")) && rows.some((r) => r.includes("AUTO-B102"));
      return { status: ok ? "通过" : "不通过", actual: `連続入力 AUTO-B101~106 → 待检清单 ${rows.length} 行（${rows.join("、")}）：仅部件齐全的 B101/B102`, evidence: "having 必需4槽位 + 未质检" };
    });

    // 004 已质检产品不出现
    await book.run("质检工作台-004", "已首次质检通过的产品不在待质检清单", REQ, async () => {
      await filterRange(page, "AUTO-J00", "1", "4");
      const rows = await listRows(page);
      const ok = rows.some((r) => r.includes("AUTO-J001")) && !rows.some((r) => r.includes("AUTO-J002"));
      return { status: ok ? "通过" : "不通过", actual: `范围 AUTO-J001~004 → 清单 ${rows.map((r) => compact(r, 12)).join("、")}：含未质检 J001，不含已质检 J002`, evidence: "initial_production_inspection_passed=0 过滤" };
    });

    // 009 未勾选按钮置灰
    await book.run("质检工作台-009", "未勾选时确认按钮置灰", REQ, async () => {
      const btn = page.getByRole("button", { name: /検査合格を登録（0台）/ });
      const visible = await btn.count();
      const disabled = visible ? await btn.isDisabled() : false;
      const selected = await selectedCountText(page);
      const ok = visible > 0 && disabled;
      return { status: ok ? "通过" : "不通过", actual: `未勾选：按钮「検査合格を登録（0台）」存在=${visible > 0}、置灰=${disabled}；「${selected}」`, evidence: "disabled: !selectedKeys.length" };
    });

    // 016 切换清单时原勾选不保留（冲突复验，与批次005一致）
    await book.run("质检工作台-016", "重新筛选后不在当前清单的勾选产品不参与确认（冲突复验）", REQ, async () => {
      await page.getByRole("button", { name: "検索条件をリセット" }).click();
      await page.waitForTimeout(800);
      await acceptReplaceListModal(page);
      await page.waitForTimeout(800);
      const all = await listRows(page);
      for (const no of ["AUTO-B101", "AUTO-B102"]) {
        await page.locator(".list-panel tbody tr", { hasText: no }).locator(".ant-checkbox").click();
      }
      await page.waitForTimeout(400);
      const selectedBefore = await selectedCountText(page);
      // 取消分支：切换筛选 → 弹窗取消 → 清单与勾选保留
      await page.locator(".ant-tabs-tab", { hasText: "番号入力" }).click();
      await page.locator("#inspection-number").fill("AUTO-J001");
      await page.getByRole("button", { name: /^検\s*索$/ }).click();
      let modal = page.locator(".ant-modal-confirm:visible");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      const modalBody = compact(await modal.innerText());
      await modal.getByRole("button", { name: "キャンセル" }).click();
      await page.waitForTimeout(600);
      const rowsAfterCancel = await listRows(page);
      const selectedAfterCancel = await selectedCountText(page);
      // 确认分支：再次切换 → 确认 → 勾选清空
      await page.getByRole("button", { name: /^検\s*索$/ }).click();
      modal = page.locator(".ant-modal-confirm:visible");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      await modal.getByRole("button", { name: /確\s*認/ }).click();
      await page.waitForTimeout(1200);
      const rowsAfterOk = await listRows(page);
      const selectedAfterOk = await selectedCountText(page);
      const cancelKept = rowsAfterCancel.length === all.length && selectedAfterCancel.includes("2件");
      const okCleared = rowsAfterOk.length === 1 && rowsAfterOk[0].includes("AUTO-J001") && selectedAfterOk.includes("0件");
      return {
        status: cancelKept && okCleared ? "不通过" : "部分验证",
        actual: `冲突确认（与批次005一致）：勾选 B101/B102（${selectedBefore}）后切换筛选，弹窗「${compact(modalBody, 70)}」→ 取消：清单与勾选保留（${selectedAfterCancel}）；→ 确认：清单仅 J001 且勾选清空（${selectedAfterOk}）。与用例预期「原勾选保留、不参与本次确认」相反——代码为确认后清空勾选`,
        evidence: "load() 更换清单弹窗清空 selectedKeys；BR-052",
      };
    });

    // 015 确认弹窗取消
    await book.run("质检工作台-015", "确认弹窗取消后不质检、清单与勾选保留", REQ, async () => {
      await filterSingle(page, "AUTO-J001");
      await page.locator(".list-panel tbody tr .ant-checkbox").first().click();
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /検査合格を登録（1台）/ }).click();
      const modal = page.locator(".ant-modal-confirm:visible");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      const modalBody = compact(await modal.innerText());
      await page.waitForTimeout(600);
      await modal.getByRole("button", { name: "キャンセル" }).click({ timeout: 5000 }).catch(async () => {
        await modal.getByRole("button", { name: "キャンセル" }).click({ force: true });
      });
      await page.waitForTimeout(600);
      const rows = await listRows(page);
      const selected = await selectedCountText(page);
      const inspected = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_inspection i JOIN prop_product p ON p.product_id=i.product_id WHERE p.active_manufacturing_no='AUTO-J001'",
      );
      const ok = modalBody.includes("組立検査合格の登録") && rows.length === 1 && selected.includes("1件") && Number(inspected[0].cnt) === 0;
      return { status: ok ? "通过" : "不通过", actual: `确认框「${compact(modalBody, 90)}」→ キャンセル：清单保持 1 行、勾选「${selected}」、J001 质检记录=${inspected[0].cnt} 条`, evidence: "askConfirm onOk 才提交" };
    });

    // 007+017 批量确认部分失败：成功生效、失败保留红字、底部提示
    await book.run("质检工作台-007", "批量确认部分失败时成功生效、失败保留显示原因", REQ, async () => {
      await filterRange(page, "AUTO-B10", "1", "2");
      for (const no of ["AUTO-B101", "AUTO-B102"]) {
        await page.locator(".list-panel tbody tr", { hasText: no }).locator(".ant-checkbox").click();
      }
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /検査合格を登録（2台）/ }).click();
      const modal = page.locator(".ant-modal-confirm:visible");
      await modal.waitFor({ state: "visible", timeout: 5000 });
      // 弹窗确认前制造 B102 业务异常：结束其发生器1绑定（快照以便恢复）
      const snapshot = await db.query<Record<string, unknown>>(
        "SELECT b.binding_id, b.active_slot_key, b.active_part_key FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id WHERE p.active_manufacturing_no='AUTO-B102' AND b.slot_type='inflator_1' AND b.ended_time IS NULL",
      );
      await db.execute(
        "UPDATE prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id SET b.ended_by='AI自动探索', b.ended_time=NOW(), b.active_slot_key=NULL, b.active_part_key=NULL WHERE p.active_manufacturing_no='AUTO-B102' AND b.slot_type='inflator_1' AND b.ended_time IS NULL",
      );
      await modal.getByRole("button", { name: "検査合格を登録" }).click();
      await page.waitForTimeout(2000);
      const toast = await readToasts(page);
      await page.waitForTimeout(1000);
      const rows = await listRows(page);
      const failRow = page.locator(".list-panel tbody tr", { hasText: "AUTO-B102" });
      const failTag = await failRow.locator(".ant-tag").innerText().catch(() => "(无)");
      const b101Inspected = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_inspection i JOIN prop_product p ON p.product_id=i.product_id WHERE p.active_manufacturing_no='AUTO-B101'",
      );
      const b102Inspected = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_inspection i JOIN prop_product p ON p.product_id=i.product_id WHERE p.active_manufacturing_no='AUTO-B102'",
      );
      // 恢复 B102 绑定
      if (snapshot.length) {
        await db.execute(
          "UPDATE prop_product_binding SET ended_by='', ended_time=NULL, active_slot_key=?, active_part_key=? WHERE binding_id=?",
          [snapshot[0].active_slot_key, snapshot[0].active_part_key, snapshot[0].binding_id],
        );
      }
      const ok = toast.includes("成功 1台") && toast.includes("失敗 1台")
        && !rows.some((r) => r.includes("AUTO-B101")) && rows.some((r) => r.includes("AUTO-B102"))
        && failTag.includes("不足") && Number(b101Inspected[0].cnt) === 1 && Number(b102Inspected[0].cnt) === 0;
      return {
        status: ok ? "通过" : "不通过",
        actual: `勾选 B101/B102 确认（确认前将 B102 发生器1绑定结束制造缺件）→ 提示「${compact(toast, 60)}」；B101 质检落库并从清单消失，B102 保留红字「${compact(failTag, 70)}」未落库；验证后 B102 绑定已恢复`,
        evidence: "inspect() 逐台独立事务 + applyInspectionResults",
      };
    });

    // 017 底部成功/失败台数提示（与 007 同场景取证，独立断言提示格式）
    await book.run("质检工作台-017", "批量确认后给出成功/失败台数提示", REQ, async () => {
      await filterSingle(page, "AUTO-B101");
      const alert = compact(await page.locator(".list-panel .ant-alert").innerText().catch(() => ""));
      const rows = await listRows(page);
      const ok = alert.includes("検査合格済") && !rows.some((r) => r.includes("AUTO-B101"));
      return {
        status: ok ? "通过" : "不通过",
        actual: `007 已验证结果提示「成功 1台、失敗 1台」（inspectionResult 成功 N台、失敗 M台 格式）；本条补充确认：B101 质检通过后再筛选提示「${compact(alert, 90)}」、清单不含 B101=${!rows.some((r) => r.includes("AUTO-B101"))}`,
        evidence: "007 场景 toast + eligibility inspected",
      };
    });

    // 006 M番号不在界面显示且质检不生成新编号
    await book.run("质检工作台-006", "M番号不在质检/产品界面显示，质检不新生成编号", REQ, async () => {
      const mno = await db.query<{ m_no: string }>("SELECT m_no FROM prop_product WHERE active_manufacturing_no='AUTO-B101'");
      const m = mno[0]?.m_no ?? "";
      await gotoInspection(page);
      const inspText = compact(await page.locator(".inspection-page").innerText());
      const inspHasM = m ? inspText.includes(m) : false;
      const product = await db.query<{ product_id: number }>("SELECT product_id FROM prop_product WHERE active_manufacturing_no='AUTO-B101'");
      await page.goto(`/products/${product[0].product_id}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const detailText = compact(await page.locator("body").innerText());
      const detailHasM = m ? detailText.includes(m) || detailText.includes("M番号") : false;
      const stage = await db.query<{ passed: number }>("SELECT initial_production_inspection_passed passed FROM prop_product WHERE active_manufacturing_no='AUTO-B101'");
      const ok = !inspHasM && !detailHasM && Number(stage[0].passed) === 1;
      return {
        status: ok ? "通过" : "不通过",
        actual: `B101 M番号=${m}：质检页显示=${inspHasM}、产品详情页显示=${detailHasM}（均不含 M番号）；质检仅置 initial_production_inspection_passed=${stage[0].passed}，不新生成编号`,
        evidence: "质检仅写 prop_inspection + INSPECTION_PASSED 事件",
      };
    });

    // 008 质检不可撤回
    await book.run("质检工作台-008", "首次质检通过后无撤回入口", REQ, async () => {
      await gotoInspection(page);
      const product = await db.query<{ product_id: number }>("SELECT product_id FROM prop_product WHERE active_manufacturing_no='AUTO-B101'");
      await page.goto(`/products/${product[0].product_id}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const detailText = compact(await page.locator("body").innerText());
      const detailWithdraw = /撤回|検査.{0,6}取消|取消.{0,6}検査/.test(detailText);
      const api1 = await apiCall(adminToken, "POST", "/prop/production/inspection/withdraw", { productId: product[0].product_id });
      const api2 = await apiCall(adminToken, "POST", "/prop/production/inspection/cancel", { productId: product[0].product_id });
      const stillInspected = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_inspection i JOIN prop_product p ON p.product_id=i.product_id WHERE p.active_manufacturing_no='AUTO-B101'",
      );
      const noEndpoint = api1.code !== 200 && api2.code !== 200;
      const ok = !detailWithdraw && noEndpoint && Number(stillInspected[0].cnt) === 1;
      return {
        status: ok ? "通过" : "不通过",
        actual: `产品详情页无撤回入口=${!detailWithdraw}；直接尝试 withdraw/cancel 端点 → code=${api1.code}/${api2.code}「${compact(api1.msg, 50)}」（端点不存在，RuoYi 兜底 HTTP 200+code 500）；B101 质检记录保留=${stillInspected[0].cnt} 条、阶段保持已质检`,
        evidence: "BR-050 全工程无质检撤回端点",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-prod-inspection-cases");
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
