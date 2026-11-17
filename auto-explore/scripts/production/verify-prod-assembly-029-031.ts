/**
 * 部件组装补充用例运行时验证（3 条）
 * 覆盖：部件组装-029（列宽稳定）、030（百件上限/无分页/保存保护）、031（空前缀范围不丢失）。
 * 夹具（幂等，API 入库）：AUTO-C001~100、AUTO-D001~101、单号 001/002/003/999/A001/0001（profile 17）。
 */
import type { Page } from "playwright";
import { config } from "../../src/config/index.js";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, compact,
  apiLogin, intakeViaApi, readToasts, pickOptionScroll,
} from "./prod-runtime-utils.js";

const book = new ResultBook("reports/prod-runtime-results-assembly-029-031.json");
const db = new DbClient();
const REQ = "FEAT-06 部件组装（VAL-21/VAL-19/VAL-20）";

function pad(value: number): string {
  return String(value).padStart(3, "0");
}

async function columnEdges(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".assembly-page .sheet thead th")).map((th) =>
      Math.round(th.getBoundingClientRect().right),
    ),
  );
}

async function resultHeader(page: Page): Promise<string> {
  return compact(await page.locator(".assembly-card header h2").innerText());
}

async function openSelect(page: Page, id: string): Promise<void> {
  // 先关闭可能残留的下拉（点击页面标题空白处），避免出现两个可见下拉
  await page.locator(".assembly-card header h2").first().click({ force: true }).catch(() => {});
  await page
    .waitForFunction(
      (sel) => !document.querySelector(sel),
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
      { timeout: 5000 },
    )
    .catch(() => {});
  await page
    .locator(`#${id}`)
    .locator("xpath=ancestor::div[contains(@class,'ant-select')][1]")
    .click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden):not(.ant-slide-up-leave):not(.ant-slide-up-leave-active)")
    .last()
    .waitFor({ state: "attached", timeout: 8000 });
  await page.waitForTimeout(400);
}

async function waitDropdownClosed(page: Page): Promise<void> {
  await page
    .waitForFunction(
      (sel) => !document.querySelector(sel),
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
      { timeout: 5000 },
    )
    .catch(() => {});
}

async function pickSmall(page: Page, text: string): Promise<void> {
  const option = page
    .locator(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden):not(.ant-slide-up-leave):not(.ant-slide-up-leave-active) .ant-select-item-option",
      { hasText: text },
    )
    .last();
  await option.waitFor({ state: "visible", timeout: 8000 });
  await option.click({ force: true });
  await waitDropdownClosed(page);
}

async function setDefaultProfiles(page: Page): Promise<void> {
  await openSelect(page, "assembly-airbag-profile");
  await pickSmall(page, "气囊 A型");
  await openSelect(page, "assembly-sensor-profile");
  await pickSmall(page, "传感器 A型");
  await openSelect(page, "assembly-firmware");
  await page
    .locator(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden):not(.ant-slide-up-leave):not(.ant-slide-up-leave-active) .ant-select-item-option",
    )
    .last()
    .click({ force: true });
  await waitDropdownClosed(page);
  await openSelect(page, "assembly-inflator_1-profile");
  await pickSmall(page, "充气发生器 A型");
  await page.waitForTimeout(300);
}

async function searchRange(page: Page, prefix: string, start: string, end: string): Promise<void> {
  await page.locator("#assembly-prefix").fill(prefix);
  await page.locator("#assembly-start").fill(start);
  await page.locator("#assembly-end").fill(end);
  await page.locator(".filter-actions .ant-btn-primary").click();
  await page.waitForTimeout(800);
}

async function main(): Promise<void> {
  await db.connect();
  const token = await apiLogin(config.app.loginUser, config.app.loginPassword);
  const ensureIntake = async (numbers: string[]): Promise<void> => {
    try {
      await intakeViaApi(token, 17, numbers);
    } catch (error) {
      if (!String(error).includes("入庫できる新しい番号がない")) throw error;
    }
  };
  const rangeC = Array.from({ length: 100 }, (_, i) => `AUTO-C${pad(i + 1)}`);
  const rangeD = Array.from({ length: 101 }, (_, i) => `AUTO-D${pad(i + 1)}`);
  await ensureIntake(rangeC);
  await ensureIntake(rangeD);
  for (const no of ["001", "002", "003", "999", "A001", "0001"]) {
    await ensureIntake([no]);
  }
  console.log("夹具就绪：AUTO-C×100 / AUTO-D×101 / 001/002/003/999/A001/0001");

  // 夹具重置：029/030 保存断言用的部件若已建档则清除（保证重跑一致）
  await db.execute(
    `DELETE e FROM prop_production_event e JOIN prop_part_item i ON e.part_id=i.part_id
     WHERE i.part_no IN ('AUTO-C002-A', 'AUTO-C003-A')`,
  );
  await db.execute(
    `DELETE b FROM prop_product_binding b JOIN prop_part_item i ON b.part_id=i.part_id
     WHERE i.part_no IN ('AUTO-C002-A', 'AUTO-C003-A')`,
  );
  await db.execute("DELETE FROM prop_part_item WHERE part_no IN ('AUTO-C002-A', 'AUTO-C003-A')");

  const { browser, session } = await launchAdminSession("verify-prod-assembly-029-031");
  const page = session.page;
  page.setDefaultTimeout(15000);
  try {
    await page.goto("/production/assembly", { waitUntil: "domcontentloaded" });
    await page.locator(".assembly-page").waitFor({ state: "visible" });

    await book.run("部件组装-029", "列宽稳定", REQ, async () => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await searchRange(page, "AUTO-C", "001", "020");
      const header20 = await resultHeader(page);
      const base = await columnEdges(page);
      const firstAirbag = page.locator(".sheet tbody tr").nth(0).locator("td").nth(1).locator("input");
      await firstAirbag.click();
      await firstAirbag.fill("AUTO-C001-X");
      await firstAirbag.blur();
      await page.waitForTimeout(600);
      const errorText = compact(
        await page.locator(".sheet tbody tr").nth(0).locator("td").nth(1).innerText(),
      );
      const edgesError = await columnEdges(page);
      await firstAirbag.click();
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await setDefaultProfiles(page);
      let releaseSave: () => void = () => undefined;
      await page.route(/\/prop\/production\/assembly$/, async (route) => {
        if (route.request().method() === "OPTIONS") {
          await route.continue().catch(() => undefined);
          return;
        }
        await new Promise<void>((resolve) => { releaseSave = resolve; });
        await route.continue().catch(() => undefined);
      });
      const row1Airbag = page.locator(".sheet tbody tr").nth(1).locator("td").nth(1).locator("input");
      await row1Airbag.click();
      await row1Airbag.fill("AUTO-C002-A");
      await row1Airbag.blur();
      await page.waitForTimeout(500);
      const edgesSaving = await columnEdges(page);
      const lockedDuringSave = {
        search: await page.locator(".filter-actions .ant-btn-primary").isDisabled(),
        reset: await page.locator(".filter-actions .ant-btn:not(.ant-btn-primary)").isDisabled(),
        cell: await row1Airbag.isDisabled(),
      };
      releaseSave();
      await page.unroute(/\/prop\/production\/assembly$/);
      await page.waitForTimeout(1200);
      const bound = await db.query<{ cnt: number }>(
        `SELECT COUNT(*) cnt FROM prop_product_binding b JOIN prop_product p ON p.product_id=b.product_id
         JOIN prop_part_item i ON i.part_id=b.part_id
         WHERE p.active_manufacturing_no='AUTO-C002' AND b.slot_type='airbag' AND b.ended_time IS NULL AND i.active_part_no='AUTO-C002-A'`,
      );
      await page.setViewportSize({ width: 800, height: 900 });
      await page.waitForTimeout(400);
      const narrow = await page.evaluate(() => {
        const wrap = document.querySelector(".sheet-wrap") as HTMLElement;
        return {
          wrapScroll: wrap.scrollWidth,
          wrapClient: wrap.clientWidth,
          docScroll: document.documentElement.scrollWidth,
          winInner: window.innerWidth,
        };
      });
      await page.setViewportSize({ width: 1600, height: 1000 });
      const edgesStable = base.length === 5 &&
        base.every((v, i) => v === edgesError[i] && v === edgesSaving[i]);
      const innerScrollOnly = narrow.wrapScroll > narrow.wrapClient && narrow.docScroll <= narrow.winInner + 2;
      const ok = header20.includes("20") && edgesStable && innerScrollOnly &&
        errorText.length > 0 && lockedDuringSave.search && lockedDuringSave.reset &&
        Number(bound[0].cnt) === 1;
      return {
        status: ok ? "通过" : "部分验证",
        actual: `20件=${header20}；五列边界 初始=${base} 错误态=${edgesError} 保存中=${edgesSaving}（一致=${edgesStable}）；` +
          `未选默认资料录入红字「${compact(errorText, 50)}」；保存中 検索/リセット/输入禁用=${lockedDuringSave.search}/${lockedDuringSave.reset}/${lockedDuringSave.cell}；` +
          `保存落库=${bound[0].cnt}；窄视口 表内横滚=${narrow.wrapScroll}>${narrow.wrapClient}、页面不横滚=${narrow.docScroll}<=${narrow.winInner}`,
        evidence: "colgroup+table-layout:fixed 实测边界坐标；page.route 延迟保存",
      };
    });

    await book.run("部件组装-030", "百件上限、无分页与保存保护", REQ, async () => {
      await searchRange(page, "AUTO-C", "001", "021");
      const header21 = await resultHeader(page);
      await page.evaluate(() => {
        document.querySelector(".sheet-wrap")?.scrollTo(0, 99999);
        window.scrollTo(0, document.body.scrollHeight);
      });
      const row21 = await page.locator(".sheet tbody tr", { hasText: "AUTO-C021" }).count();
      await searchRange(page, "AUTO-C", "001", "100");
      const header100 = await resultHeader(page);
      await page.evaluate(() => {
        document.querySelector(".sheet-wrap")?.scrollTo(0, 99999);
        window.scrollTo(0, document.body.scrollHeight);
      });
      const row100 = await page.locator(".sheet tbody tr", { hasText: "AUTO-C100" }).count();
      const noPagination = (await page.locator(".assembly-page .ant-pagination").count()) === 0;
      await searchRange(page, "AUTO-D", "001", "101");
      await page.waitForTimeout(500);
      const alert = compact(await page.locator(".assembly-card .ant-alert-warning").first().innerText().catch(() => ""));
      const headerAfter = await resultHeader(page);
      const kept = headerAfter.includes("100");
      // 草稿拦截：dispatchEvent 点击避免失焦先触发自动保存
      const cell = page.locator(".sheet tbody tr").nth(2).locator("td").nth(1).locator("input");
      await cell.click();
      await cell.fill("AUTO-DIRTY-X");
      let searchCalls = 0;
      const onReq = (req: { url(): string }) => {
        if (req.url().includes("/prop/production/products")) searchCalls += 1;
      };
      page.on("request", onReq);
      await page.locator(".filter-actions .ant-btn-primary").dispatchEvent("click");
      await page.waitForTimeout(700);
      page.off("request", onReq);
      const dirtyToast = await readToasts(page);
      const headerKept = (await resultHeader(page)).includes("100") && searchCalls === 0;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const ok = header21.includes("21") && row21 === 1 && header100.includes("100") && row100 === 1 &&
        noPagination && alert.includes("100") && kept && dirtyToast.length > 0 && headerKept;
      return {
        status: ok ? "通过" : "部分验证",
        actual: `21件=${header21}（末行 AUTO-C021 可达=${row21 === 1}）；100件=${header100}（末行 AUTO-C100 可达=${row100 === 1}，无分页=${noPagination}）；` +
          `101件拒绝：警告「${compact(alert, 70)}」，旧清单保留=${kept}（${headerAfter}）；` +
          `脏格筛选拦截提示「${compact(dirtyToast, 60)}」，清单不变=${headerKept}`,
        evidence: "后端 requireWorkbenchLimit(>100 抛 queryLimit) + 前端 hasIssues 拦截",
      };
    });

    await book.run("部件组装-031", "空前缀范围不丢失", REQ, async () => {
      await searchRange(page, "", "001", "003");
      await page.waitForTimeout(600);
      const header3 = await resultHeader(page);
      const rows = await page.locator(".sheet tbody tr td code").allInnerTexts();
      const exact = rows.length === 3 && rows.join(",") === "001,002,003";
      const invalidCases: Array<[string, string, string]> = [
        ["", "001", ""],
        ["", "00A", "003"],
        ["", "01", "003"],
        ["", "003", "001"],
      ];
      const invalidResults: string[] = [];
      for (const [prefix, start, end] of invalidCases) {
        await page.locator("#assembly-prefix").fill(prefix);
        await page.locator("#assembly-start").fill(start);
        await page.locator("#assembly-end").fill(end);
        await page.locator(".filter-actions .ant-btn-primary").click();
        await page.waitForTimeout(500);
        const toast = await readToasts(page);
        const unchanged = (await resultHeader(page)) === header3;
        invalidResults.push(`${start || "空"}~${end || "空"}:提示=${toast.length > 0},清单不变=${unchanged}`);
      }
      const invalidOk = invalidResults.every((x) => x.includes("提示=true") && x.includes("清单不变=true"));
      const ok = header3.includes("3") && exact && invalidOk;
      return {
        status: ok ? "通过" : "不通过",
        actual: `空前缀 001~003 → ${header3}，行=[${rows.join(",")}]（精确=${exact}，999/A001/0001/「3」均未命中）；` +
          `非法范围：${invalidResults.join("；")}`,
        evidence: "productionRangeError 前端校验 + 后端 validateQueryRange 兜底",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-prod-assembly-029-031");
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
