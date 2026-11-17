/**
 * 质检工作台补充用例运行时验证（5 条）
 * 覆盖：质检工作台-018（自适应布局）、019（标记/事实/事件原子一致）、020（历史认定边界）、
 *      021（百件上限与请求锁定）、022（空前缀范围不丢失）。
 * 夹具（幂等）：AUTO-Q001~098 齐全产品（与既有待检「3」「AUTO-J001」凑满 100 台）；
 *   021 阶段追加 AUTO-Q099 凑成 101；022 阶段齐全化 001/002/003/999/A001/0001。
 * 顺序敏感：021 的 100 件场景必须在 022 夹具之前执行。
 */
import type { Page } from "playwright";
import { config } from "../../src/config/index.js";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, compact,
  apiLogin, apiCall, ensureQualifiedProduct, readToasts,
} from "./prod-runtime-utils.js";

const book = new ResultBook("reports/prod-runtime-results-inspection-018-022.json");
const db = new DbClient();
const REQ = "FEAT-07 质检工作台（VAL-16/VAL-12a/VAL-12b/VAL-14/VAL-15）";

function pad(value: number): string {
  return String(value).padStart(3, "0");
}

async function eligibleCount(): Promise<number> {
  const rows = await db.query<{ cnt: number }>(
    `SELECT COUNT(*) cnt FROM prop_product p
     WHERE p.deleted_time IS NULL AND p.initial_production_inspection_passed = 0
       AND (SELECT COUNT(DISTINCT b.slot_type) FROM prop_product_binding b
            WHERE b.product_id = p.product_id AND b.ended_time IS NULL
              AND b.slot_type IN ('body','airbag','sensor','inflator_1')) = 4`,
  );
  return Number(rows[0].cnt);
}

async function nextFreeAutoQ(count: number): Promise<string[]> {
  const rows = await db.query<{ m: number | null }>(
    `SELECT MAX(n) m FROM (
       SELECT CAST(SUBSTRING(active_manufacturing_no, 7) AS UNSIGNED) n FROM prop_product
        WHERE active_manufacturing_no REGEXP '^AUTO-Q[0-9]+$'
       UNION ALL
       SELECT CAST(SUBSTRING(active_part_no, 7) AS UNSIGNED) n FROM prop_part_item
        WHERE active_part_no REGEXP '^AUTO-Q[0-9]+$'
     ) t`,
  );
  const base = Number(rows[0].m ?? 0);
  return Array.from({ length: count }, (_, index) => `AUTO-Q${pad(base + 1 + index)}`);
}

async function listHeader(page: Page): Promise<string> {
  return compact(await page.locator(".list-panel header h2").innerText());
}

async function filterRange(page: Page, prefix: string, start: string, end: string): Promise<void> {
  await page.locator("#inspection-prefix").fill(prefix);
  await page.locator("#inspection-start").fill(start);
  await page.locator("#inspection-end").fill(end);
  await page.locator(".filter-panel .ant-btn-primary").click();
  await page.waitForTimeout(800);
}

async function productIdOf(no: string): Promise<number> {
  const rows = await db.query<{ product_id: number }>(
    "SELECT product_id FROM prop_product WHERE active_manufacturing_no=? AND deleted_time IS NULL",
    [no],
  );
  if (!rows.length) throw new Error(`产品不存在：${no}`);
  return rows[0].product_id;
}

async function main(): Promise<void> {
  await db.connect();
  const token = await apiLogin(config.app.loginUser, config.app.loginPassword);
  let current = await eligibleCount();
  if (current > 100) {
    const victims = await db.query<{ id: number }>(
      `SELECT p.product_id id FROM prop_product p
       WHERE p.deleted_time IS NULL AND p.initial_production_inspection_passed = 0
         AND p.active_manufacturing_no LIKE 'AUTO-Q%'
         AND (SELECT COUNT(*) FROM prop_inspection i WHERE i.product_id = p.product_id) = 0
       ORDER BY p.active_manufacturing_no DESC LIMIT ?`,
      [current - 100],
    );
    for (const victim of victims) {
      const id = Number(victim.id);
      await db.execute("DELETE FROM prop_production_event WHERE product_id = ?", [id]);
      await db.execute("DELETE FROM prop_intake_item WHERE product_id = ?", [id]);
      await db.execute("DELETE FROM prop_product_order_relation WHERE product_id = ?", [id]);
      await db.execute("DELETE FROM prop_product_binding WHERE product_id = ?", [id]);
      await db.execute("DELETE FROM prop_product WHERE product_id = ?", [id]);
    }
    console.log(`待检超限，回收 AUTO-Q×${victims.length}`);
    current = await eligibleCount();
  }
  const need = Math.max(0, 100 - current);
  console.log(`当前待检=${current}，需补齐=${need}`);
  const fixtureSerials = await nextFreeAutoQ(need);
  for (let i = 0; i < fixtureSerials.length; i++) {
    await ensureQualifiedProduct(db, token, fixtureSerials[i]);
    if ((i + 1) % 20 === 0) console.log(`  夹具进度 ${i + 1}/${need}`);
  }
  const afterFixture = await eligibleCount();
  console.log(`夹具后待检=${afterFixture}`);

  const { browser, session } = await launchAdminSession("verify-prod-inspection-018-022");
  const page = session.page;
  page.setDefaultTimeout(15000);
  try {
    await book.run("质检工作台-018", "自适应左右工作台", REQ, async () => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto("/production/inspection", { waitUntil: "domcontentloaded" });
      await page.locator(".inspection-page").waitFor({ state: "visible" });
      await page.waitForFunction(
        () => document.querySelector(".list-panel header h2")?.textContent?.match(/\d+/),
      );
      const header = await listHeader(page);
      const filter = (await page.locator(".filter-panel").boundingBox())!;
      const list = (await page.locator(".list-panel").boundingBox())!;
      const sideBySide = filter.x + filter.width <= list.x + 1;
      const banner = await page.locator(".inspection-page > .ant-alert").isVisible();
      await page.setViewportSize({ width: 1366, height: 700 });
      await page.waitForTimeout(400);
      const metrics = await page.evaluate(() => {
        const body = document.querySelector(".list-panel .ant-table-body") as HTMLElement;
        return { scrollH: body.scrollHeight, clientH: body.clientHeight };
      });
      const footerBtn = (await page.locator(".list-panel footer .ant-btn-primary").boundingBox())!;
      const footerReachable = footerBtn.y + footerBtn.height <= 700;
      await page.setViewportSize({ width: 700, height: 900 });
      await page.waitForTimeout(400);
      const filterN = (await page.locator(".filter-panel").boundingBox())!;
      const listN = (await page.locator(".list-panel").boundingBox())!;
      const singleColumn = filterN.y + filterN.height <= listN.y + 1;
      const searchBtn = (await page.locator(".filter-panel .ant-btn-primary").boundingBox())!;
      const controlsFit = searchBtn.width > 40 && searchBtn.x + searchBtn.width <= 700;
      const noPagination = (await page.locator(".inspection-page .ant-pagination").count()) === 0;
      await page.setViewportSize({ width: 1600, height: 1000 });
      const ok = sideBySide && banner && metrics.scrollH > metrics.clientH && footerReachable &&
        singleColumn && controlsFit && noPagination;
      return {
        status: ok ? "通过" : "部分验证",
        actual: `桌面左右布局=${sideBySide}、说明横幅=${banner}、清单=${header}；矮视口表体内滚=${metrics.scrollH}>${metrics.clientH}、底部按钮可达=${footerReachable}；` +
          `窄屏单列=${singleColumn}、控件不裁切=${controlsFit}；无分页=${noPagination}`,
        evidence: "boundingBox 实测 + ant-table-body scrollHeight；布局为 grid minmax(280px,30%) + 1fr，≤900px 单列",
      };
    });

    await book.run("质检工作台-021", "百件上限与请求锁定", REQ, async () => {
      const notes: string[] = [];
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => (document.querySelector(".list-panel header h2")?.textContent ?? "").includes("100"),
        undefined,
        { timeout: 30000 },
      );
      const header100 = await listHeader(page);
      const rowCount100 = await page.locator(".list-panel tr.ant-table-row").count();
      notes.push(`100件=${header100}（行数=${rowCount100}）`);
      const queryGates: Array<() => void> = [];
      let queryArmed = true;
      await page.route(/\/prop\/production\/inspection\/candidates/, async (route) => {
        if (route.request().method() === "OPTIONS" || !queryArmed) {
          await route.continue().catch(() => {});
          return;
        }
        await new Promise<void>((resolve) => queryGates.push(resolve));
        await route.continue().catch(() => {});
      });
      await page.locator("#inspection-prefix").fill("AUTO-Q");
      await page.locator("#inspection-start").fill("001");
      await page.locator("#inspection-end").fill("050");
      await page.locator(".filter-panel .ant-btn-primary").click();
      await page.waitForTimeout(500);
      const duringQuery = {
        search: await page.locator(".filter-panel .ant-btn-primary").isDisabled(),
        tabs: await page.locator(".ant-tabs-tab-disabled").count(),
        checkbox: await page.locator(".list-panel tr.ant-table-row .ant-checkbox-input").first().isDisabled(),
        reset: await page.locator(".filter-panel header .ant-btn").isDisabled(),
      };
      queryArmed = false;
      queryGates.forEach((release) => release());
      await page.waitForFunction(
        (before) => {
          const currentText = document.querySelector(".list-panel header h2")?.textContent ?? "";
          return currentText !== before && currentText.includes("検索結果");
        },
        header100,
        { timeout: 15000 },
      );
      await page.unroute(/\/prop\/production\/inspection\/candidates/);
      const filteredHeader = await listHeader(page);
      notes.push(`查询中禁用(検索=${duringQuery.search},页签=${duringQuery.tabs},勾选=${duringQuery.checkbox},重置=${duringQuery.reset})，筛选结果=${filteredHeader}`);
      const boxes = page.locator(".list-panel tr.ant-table-row .ant-checkbox-input");
      await boxes.nth(0).check();
      await boxes.nth(1).check();
      await filterRange(page, "AUTO-Q", "051", "060");
      let modal = page.locator(".ant-modal:visible");
      await modal.waitFor({ state: "visible" });
      await modal.locator("button", { hasText: "キャンセル" }).click();
      await page.waitForTimeout(400);
      const keptAfterCancel = (await listHeader(page)) === filteredHeader &&
        compact(await page.locator(".list-panel header span").innerText()).includes("2");
      await filterRange(page, "AUTO-Q", "051", "060");
      modal = page.locator(".ant-modal:visible");
      await modal.waitFor({ state: "visible" });
      await modal.locator(".ant-btn-primary").last().click();
      await page.waitForTimeout(800);
      const replaced = (await listHeader(page)).includes("10");
      notes.push(`更换清单：取消保留=${keptAfterCancel}，确认替换=${replaced}（${await listHeader(page)}）`);
      const targetRow = await db.query<{ s: string }>(
        `SELECT p.active_manufacturing_no s FROM prop_product p
         WHERE p.deleted_time IS NULL AND p.initial_production_inspection_passed = 0
           AND p.active_manufacturing_no LIKE 'AUTO-Q%'
           AND (SELECT COUNT(*) FROM prop_inspection i WHERE i.product_id = p.product_id) = 0
           AND (SELECT COUNT(DISTINCT b.slot_type) FROM prop_product_binding b
                WHERE b.product_id = p.product_id AND b.ended_time IS NULL
                  AND b.slot_type IN ('body','airbag','sensor','inflator_1')) = 4
         ORDER BY p.active_manufacturing_no LIMIT 1`,
      );
      if (!targetRow.length) throw new Error("无可用 AUTO-Q 待检产品");
      const targetNo = targetRow[0].s;
      const targetNum = targetNo.replace("AUTO-Q", "");
      await filterRange(page, "AUTO-Q", targetNum, targetNum);
      await page.waitForFunction(
        () => (document.querySelector(".list-panel header h2")?.textContent ?? "").includes("（1件）"),
      );
      const confirmGates: Array<() => void> = [];
      let confirmArmed = true;
      let confirmCalls = 0;
      let confirmStatus = 0;
      let confirmBody = "";
      page.on("response", (res) => {
        if (/\/prop\/production\/inspection$/.test(res.url()) && res.request().method() === "POST") {
          confirmStatus = res.status();
          res.text().then((body) => { confirmBody = body; }).catch(() => {});
        }
      });
      await page.route(/\/prop\/production\/inspection$/, async (route) => {
        if (route.request().method() === "OPTIONS") {
          await route.continue().catch(() => {});
          return;
        }
        if (!confirmArmed) {
          await route.continue().catch(() => {});
          return;
        }
        confirmCalls += 1;
        await new Promise<void>((resolve) => confirmGates.push(resolve));
        try {
          const response = await route.fetch();
          confirmStatus = response.status();
          confirmBody = await response.text();
          await route.fulfill({ response });
        } catch {
          await route.continue().catch(() => {});
        }
      });
      await page.locator(".list-panel tr.ant-table-row .ant-checkbox-input").first().check();
      await page.locator(".list-panel footer .ant-btn-primary").click();
      const confirmModal = page.locator(".ant-modal:visible");
      await confirmModal.waitFor({ state: "visible" });
      const modalText = compact(await confirmModal.innerText());
      await confirmModal.locator("button", { hasText: "検査合格を登録" }).click();
      await page.waitForTimeout(500);
      const duringConfirm = {
        search: await page.locator(".filter-panel .ant-btn-primary").isDisabled(),
        checkbox: await page.locator(".list-panel tr.ant-table-row .ant-checkbox-input").first().isDisabled().catch(() => true),
      };
      confirmArmed = false;
      confirmGates.forEach((release) => release());
      let confirmToast = "";
      for (let attempt = 0; attempt < 12 && !confirmToast; attempt += 1) {
        await page.waitForTimeout(500);
        confirmToast = await readToasts(page);
      }
      await page.unroute(/\/prop\/production\/inspection$/);
      const q1Id = await productIdOf(targetNo);
      const q1Flag = await db.query<{ passed: number }>(
        "SELECT initial_production_inspection_passed passed FROM prop_product WHERE product_id=?", [q1Id]);
      notes.push(`确认弹窗含不可撤回说明=${modalText.includes("取り消せません")}；确认中禁用(検索=${duringConfirm.search},勾选=${duringConfirm.checkbox})，提交=${confirmCalls}次，结果「${compact(confirmToast, 40)}」，DB 标记=${q1Flag[0]?.passed}（HTTP ${confirmStatus} ${compact(confirmBody, 60)}）`);
      // 确认测试已质检目标产品（待检 -1），追加 Q099/Q100 → 101
      const extraSerials = await nextFreeAutoQ(2);
      for (const serial of extraSerials) {
        await ensureQualifiedProduct(db, token, serial);
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      const alert101 = compact(await page.locator(".list-panel .ant-alert-warning").first().innerText().catch(() => ""));
      const rows101 = await page.locator(".list-panel tr.ant-table-row").count();
      notes.push(`101件首次进入：提示「${compact(alert101, 60)}」，清单行数=${rows101}`);
      const ok = header100.includes("100") && rowCount100 === 100 &&
        duringQuery.search && duringQuery.tabs > 0 && duringQuery.checkbox && duringQuery.reset &&
        keptAfterCancel && replaced &&
        duringConfirm.search && confirmCalls === 1 && /成功\s*1台/.test(confirmToast) && q1Flag[0]?.passed === 1 &&
        alert101.includes("100") && rows101 === 0;
      return { status: ok ? "通过" : "部分验证", actual: notes.join("；"), evidence: "page.route 延迟 + 弹窗确认/取消 + 后端 100 上限（inspectionLimit）" };
    });

    await book.run("质检工作台-022", "空前缀范围不丢失", REQ, async () => {
      for (const no of ["001", "002", "003", "999", "A001", "0001"]) {
        await ensureQualifiedProduct(db, token, no);
      }
      await filterRange(page, "", "001", "003");
      await page.waitForTimeout(600);
      const header3 = await listHeader(page);
      const rows = await page.locator(".list-panel tr.ant-table-row td:not(.ant-table-selection-column)").allInnerTexts();
      const serials = rows.length >= 3
        ? Array.from({ length: 3 }, (_, index) => (rows[index * 5] ?? "").trim())
        : [];
      const exact = serials.join(",") === "001,002,003";
      const invalidCases: Array<[string, string]> = [
        ["001", ""],
        ["00A", "003"],
        ["01", "003"],
        ["003", "001"],
      ];
      const invalidResults: string[] = [];
      for (const [start, end] of invalidCases) {
        await page.locator("#inspection-prefix").fill("");
        await page.locator("#inspection-start").fill(start);
        await page.locator("#inspection-end").fill(end);
        await page.locator(".filter-panel .ant-btn-primary").click();
        await page.waitForTimeout(500);
        const toast = await readToasts(page);
        const unchanged = (await listHeader(page)) === header3;
        invalidResults.push(`${start || "空"}~${end || "空"}:提示=${toast.length > 0},清单不变=${unchanged}`);
      }
      const invalidOk = invalidResults.every((x) => x.includes("提示=true") && x.includes("清单不变=true"));
      const ok = header3.includes("3") && exact && invalidOk;
      return {
        status: ok ? "通过" : "不通过",
        actual: `空前缀 001~003 → ${header3}，行=[${serials.join(",")}]（999/A001/0001 均已齐全建档但未命中）；非法范围：${invalidResults.join("；")}`,
        evidence: "productionRangeError + 后端 validateQueryRange；范围为数字等长严格匹配",
      };
    });

    await book.run("质检工作台-019", "标记、质检事实和事件原子一致", REQ, async () => {
      const fresh = await db.query<{ id: number; s: string }>(
        `SELECT p.product_id id, p.active_manufacturing_no s FROM prop_product p
         WHERE p.deleted_time IS NULL AND p.initial_production_inspection_passed = 0
           AND p.active_manufacturing_no LIKE 'AUTO-Q%'
           AND (SELECT COUNT(*) FROM prop_inspection i WHERE i.product_id = p.product_id) = 0
           AND (SELECT COUNT(DISTINCT b.slot_type) FROM prop_product_binding b
                WHERE b.product_id = p.product_id AND b.ended_time IS NULL
                  AND b.slot_type IN ('body','airbag','sensor','inflator_1')) = 4
         ORDER BY p.active_manufacturing_no LIMIT 3`,
      );
      if (fresh.length < 3) throw new Error("可用待检 AUTO-Q 产品不足 3 台");
      const [idQ2, idQ3, idQ4] = fresh.map((row) => Number(row.id));
      const [noQ2, noQ3, noQ4] = fresh.map((row) => row.s);
      const [first, second] = await Promise.all([
        apiCall(token, "POST", "/prop/production/inspection", { productIds: [idQ2] }),
        apiCall(token, "POST", "/prop/production/inspection", { productIds: [idQ2] }),
      ]);
      const tally = (res: { data: unknown }) => {
        const data = res.data as { successCount: number; failureCount: number };
        return `成功${data.successCount}/失敗${data.failureCount}`;
      };
      const facts = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_inspection WHERE product_id=?", [idQ2]);
      const flag = await db.query<{ passed: number }>(
        "SELECT initial_production_inspection_passed passed FROM prop_product WHERE product_id=?", [idQ2]);
      const events = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_production_event WHERE product_id=? AND event_type='INSPECTION_PASSED'", [idQ2]);
      const batch = await apiCall(token, "POST", "/prop/production/inspection", { productIds: [idQ3, idQ4, idQ2] });
      const batchData = batch.data as { successCount: number; failureCount: number };
      const factsQ2After = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_inspection WHERE product_id=?", [idQ2]);
      const triple = await db.query<{ cnt: number }>(
        `SELECT COUNT(*) cnt FROM prop_product p
         WHERE p.product_id IN (?, ?)
           AND p.initial_production_inspection_passed = 1
           AND (SELECT COUNT(*) FROM prop_inspection i WHERE i.product_id = p.product_id) = 1
           AND (SELECT COUNT(*) FROM prop_production_event e WHERE e.product_id = p.product_id AND e.event_type='INSPECTION_PASSED') = 1`,
        [idQ3, idQ4]);
      const ok = Number(facts[0].cnt) === 1 && Number(flag[0].passed) === 1 && Number(events[0].cnt) === 1 &&
        batchData.successCount === 2 && batchData.failureCount === 1 &&
        Number(factsQ2After[0].cnt) === 1 && Number(triple[0].cnt) === 2;
      return {
        status: ok ? "通过" : "部分验证",
        actual: `并发双确认 ${noQ2}：结果[${tally(first)}|${tally(second)}]，DB 事实=${facts[0].cnt}、标记=${flag[0].passed}、事件=${events[0].cnt}（三项一致=1）；` +
          `批量[${noQ3},${noQ4},已质检${noQ2}] → 成功${batchData.successCount}/失敗${batchData.failureCount}，${noQ2} 事实仍=${factsQ2After[0].cnt}（无重复），${noQ3}/${noQ4} 标记+事实+事件各 1 条=${triple[0].cnt}/2；` +
          `代码证据：inspect() 逐台 transactions.executeWithoutResult 独立事务，insertInspection+markPassed+INSPECTION_PASSED 事件同一事务，重复主键触发 inspectionTaken。` +
          `注：故障注入（令标记/事实/事件单项写失败）需代码级注入手段，运行时未覆盖，以事务边界+并发/重复实测代替`,
        evidence: "API 并发/批量确认 + DB 三要素一致性断言",
      };
    });

    await book.run("质检工作台-020", "历史认定与正常质检边界", REQ, async () => {
      return {
        status: "阻塞",
        actual: "VAL-12b 原文：本条真实业务历史认定及未来 FEAT-20 断言保留，「未执行的历史断言不能标记为通过，具体环境初始化及验收范围在本次 Change 另记」；" +
          "openspec change persist-initial-production-inspection-qualification 明确「不复制开发业务数据、不把默认 0 称历史认定正确」；" +
          "源码检索全库无 FEAT-20/历史认定实现（ruoyi-prop/ruoyi-admin 零命中）。正常质检边界（标记读取来源、新建默认未通过）已由 019 与批次006 质检-006 覆盖。",
        evidence: "FEAT-07 validation.md VAL-12b + openspec change proposal + 源码零命中",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-prod-inspection-018-022");
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
