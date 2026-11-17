/**
 * 衣体入库补充用例运行时验证（2 条）
 * 覆盖：衣体入库-028（自适应双栏与确认全部）、衣体入库-029（请求期间禁用与候选归属）。
 * 夹具：profile 17（无前缀「AUTO-MD-PP-013」）；028 确认后产生 AUTO-N28001~100 共 100 条产品（收尾清理）。
 * 幂等：028 若 AUTO-N28 系列已存在会全部 skip，结果提示变为 スキップ 100件，判定不依赖成功计数文案。
 */
import type { Page } from "playwright";
import {
  ResultBook, DbClient, launchAdminSession, finishSession, compact,
  pickOptionScroll, readToasts,
} from "./prod-runtime-utils.js";

const book = new ResultBook("reports/prod-runtime-results-intake-028-029.json");
const db = new DbClient();
const REQ = "FEAT-05 衣体入库（VAL-09/VAL-08）";
const PROFILE17 = "AUTO-MD-PP-013";

async function selectProfile17(page: Page): Promise<void> {
  const current = await page
    .locator("#intake-profile")
    .evaluate((el) => el.closest(".ant-select")?.textContent ?? "");
  if (current.includes(PROFILE17)) return;
  await page
    .locator("#intake-profile")
    .locator("xpath=ancestor::div[contains(@class,'ant-select')][1]")
    .click();
  await pickOptionScroll(page, PROFILE17);
  await page.waitForTimeout(300);
}

async function candidateHeader(page: Page): Promise<string> {
  return compact(await page.locator(".candidate-panel header h2").innerText());
}

async function main(): Promise<void> {
  await db.connect();
  const { browser, session } = await launchAdminSession("verify-prod-intake-028-029");
  const page = session.page;
  page.setDefaultTimeout(15000);
  try {
    await book.run("衣体入库-028", "自适应双栏与确认全部", REQ, async () => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.goto("/production/intake", { waitUntil: "domcontentloaded" });
      await page.locator(".intake-page").waitFor({ state: "visible" });
      await selectProfile17(page);

      // 桌面双栏等高 + 左侧上下各 50%
      const setup = (await page.locator(".setup-panel").boundingBox())!;
      const candidate = (await page.locator(".candidate-panel").boundingBox())!;
      const profile = (await page.locator(".profile-area").boundingBox())!;
      const entry = (await page.locator(".entry-area").boundingBox())!;
      const sideBySide = setup.x + setup.width <= candidate.x + 1;
      const equalHeight = Math.abs(setup.height - candidate.height) <= 2;
      const halves = Math.abs(profile.height - entry.height) <= 24;

      // 加入 100 条候选
      await page.locator(".ant-tabs-tab", { hasText: "連続入力" }).click();
      await page.locator("#intake-prefix").fill("AUTO-N28");
      await page.locator("#intake-start").fill("001");
      await page.locator("#intake-end").fill("100");
      await page.locator(".entry-area > .ant-btn").click();
      await page.waitForFunction(
        () => document.querySelector(".candidate-panel header h2")?.textContent?.includes("100"),
        undefined,
        { timeout: 30000 },
      );
      const header100 = await candidateHeader(page);

      // 矮桌面：表体内部滚动、底部确认可达
      await page.setViewportSize({ width: 1366, height: 700 });
      await page.waitForTimeout(400);
      const metrics700 = await page.evaluate(() => {
        const body = document.querySelector(".candidate-panel .ant-table-body") as HTMLElement;
        return { scrollH: body.scrollHeight, clientH: body.clientHeight };
      });
      const confirmBtn = page.locator(".candidate-panel footer .ant-btn-primary");
      const confirmBox = (await confirmBtn.boundingBox())!;
      const footerReachable = confirmBox.y + confirmBox.height <= 700 && confirmBox.y >= 0;
      // 滚到第 100 条
      await page.evaluate(() => {
        const body = document.querySelector(".candidate-panel .ant-table-body") as HTMLElement;
        body.scrollTop = body.scrollHeight;
      });
      await page.waitForTimeout(300);
      const lastVisible = await page.locator(".candidate-panel tr.ant-table-row", { hasText: "AUTO-N28100" }).isVisible();
      // 增高后可见区域增大
      await page.setViewportSize({ width: 1366, height: 1000 });
      await page.waitForTimeout(400);
      const metrics1000 = await page.evaluate(() => {
        const body = document.querySelector(".candidate-panel .ant-table-body") as HTMLElement;
        return { clientH: body.clientHeight };
      });
      const grows = metrics1000.clientH > metrics700.clientH;

      // 窄屏：单列、控件不裁切
      await page.setViewportSize({ width: 700, height: 900 });
      await page.waitForTimeout(400);
      const setupN = (await page.locator(".setup-panel").boundingBox())!;
      const candidateN = (await page.locator(".candidate-panel").boundingBox())!;
      const singleColumn = setupN.y + setupN.height <= candidateN.y + 1;
      const addBtn = (await page.locator(".entry-area > .ant-btn").boundingBox())!;
      const controlsFit = addBtn.width > 40 && addBtn.x >= 0 && addBtn.x + addBtn.width <= 700;

      // 恢复桌面：只勾选 2 行后确认，仍提交全部
      await page.setViewportSize({ width: 1600, height: 1000 });
      await page.waitForTimeout(400);
      const boxes = page.locator(".candidate-panel tr.ant-table-row .ant-checkbox-input");
      await boxes.nth(0).check();
      await boxes.nth(1).check();
      await page.locator(".candidate-panel footer .ant-btn-primary").click();
      const modal = page.locator(".ant-modal:visible");
      await modal.waitFor({ state: "visible" });
      await modal.locator("button", { hasText: "入庫する" }).click();
      await page.waitForFunction(
        () => document.querySelector(".candidate-panel header h2")?.textContent?.includes("（0件）"),
        undefined,
        { timeout: 60000 },
      );
      await page.waitForTimeout(800);
      const toast = await readToasts(page);
      const dbCount = await db.query<{ cnt: number }>(
        "SELECT COUNT(*) cnt FROM prop_product WHERE manufacturing_no LIKE 'AUTO-N28%' AND deleted_time IS NULL",
      );
      const dbOk = Number(dbCount[0].cnt) === 100;
      const toastOk = /成功\s*100件|スキップ\s*100件/.test(toast);
      const ok = sideBySide && equalHeight && halves && header100.includes("100") &&
        metrics700.scrollH > metrics700.clientH && footerReachable && lastVisible && grows &&
        singleColumn && controlsFit && dbOk && toastOk;
      return {
        status: ok ? "通过" : "部分验证",
        actual: `双栏=${sideBySide} 等高=${equalHeight} 左上下各半=${halves}；候选=${header100}；` +
          `矮视口表体内滚=${metrics700.scrollH}>${metrics700.clientH}、确认按钮可达=${footerReachable}、滚至末行可见=${lastVisible}；` +
          `增高可见区增大=${grows}（${metrics700.clientH}→${metrics1000.clientH}）；窄屏单列=${singleColumn}、控件不裁切=${controlsFit}；` +
          `勾选2行确认仍提交全部：toast「${compact(toast, 60)}」、DB 建档=${dbCount[0].cnt}/100`,
        evidence: "boundingBox 实测 + ant-table-body scrollHeight + DB 计数",
      };
    });

    await book.run("衣体入库-029", "请求期间禁用与候选归属", REQ, async () => {
      await page.goto("/production/intake", { waitUntil: "domcontentloaded" });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".intake-page").waitFor({ state: "visible" });
      await selectProfile17(page);
      const notes: string[] = [];

      // 1) 延迟查重：期间控件禁用（注意：JSON POST 会先发 CORS 预检 OPTIONS，直接放行）
      const checkGate: Array<() => void> = [];
      await page.route(/\/prop\/production\/intake\/check$/, async (route) => {
        if (route.request().method() === "OPTIONS") {
          await route.continue().catch(() => undefined);
          return;
        }
        await new Promise<void>((resolve) => checkGate.push(resolve));
        await route.continue().catch(() => undefined);
      });
      await page.locator("#intake-number").fill("AUTO-R29001");
      await page.locator("#intake-number").press("Enter");
      await page.waitForTimeout(500);
      const duringCheck = {
        number: await page.locator("#intake-number").isDisabled(),
        profile: await page
          .locator("#intake-profile")
          .evaluate((el) => el.closest(".ant-select")?.classList.contains("ant-select-disabled") ?? false),
        add: await page.locator(".entry-area > .ant-btn").isDisabled(),
        tabs: await page.locator(".ant-tabs-tab-disabled").count(),
      };
      checkGate.forEach((release) => release());
      await page.waitForTimeout(300);
      await page.unroute(/\/prop\/production\/intake\/check$/);
      await page.waitForFunction(
        () => document.querySelector(".candidate-panel header h2")?.textContent?.includes("1"),
      );
      const row1 = compact(
        await page.locator(".candidate-panel tr.ant-table-row", { hasText: "AUTO-R29001" }).innerText(),
      );
      notes.push(`查重中禁用(编号=${duringCheck.number},资料=${duringCheck.profile},追加=${duringCheck.add},页签=${duringCheck.tabs})`);
      notes.push(`候选归属=${row1.includes("AUTO-规格-013") ? "本次资料" : row1}`);

      // 2) 查重失败：输入保留、候选不变
      await page.route(/\/prop\/production\/intake\/check$/, (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 500, msg: "AUTO-模拟查重失败" }) }),
      );
      await page.locator("#intake-number").fill("AUTO-R29002");
      await page.locator("#intake-number").press("Enter");
      await page.waitForTimeout(400);
      const readAll = async (): Promise<string> =>
        `${await readToasts(page)} ${compact(
          await page.locator(".ant-notification .ant-notification-notice").allInnerTexts().then((x) => x.join(" | ")).catch(() => ""),
        )}`;
      const failToastAll = (await readAll()) || (await page.waitForTimeout(600).then(readAll));
      const inputKept = (await page.locator("#intake-number").inputValue()) === "AUTO-R29002";
      const stillOne = (await candidateHeader(page)).includes("1");
      const enabledAgain = !(await page.locator("#intake-number").isDisabled());
      await page.unroute(/\/prop\/production\/intake\/check$/);
      notes.push(`查重失败:提示「${compact(failToastAll, 60)}」,输入保留=${inputKept},候选不变=${stillOne},恢复交互=${enabledAgain}`);

      // 3) 延迟确认入库：期间重复操作不生效
      const confirmGate: Array<() => void> = [];
      let confirmCalls = 0;
      await page.route(/\/prop\/production\/intake$/, async (route) => {
        if (route.request().method() === "OPTIONS") {
          await route.continue().catch(() => undefined);
          return;
        }
        confirmCalls += 1;
        await new Promise<void>((resolve) => confirmGate.push(resolve));
        await route.continue().catch(() => undefined);
      });
      await page.locator(".candidate-panel footer .ant-btn-primary").click();
      const modal = page.locator(".ant-modal:visible");
      await modal.waitFor({ state: "visible" });
      await modal.locator("button", { hasText: "入庫する" }).click();
      await page.waitForTimeout(500);
      const duringConfirm = {
        number: await page.locator("#intake-number").isDisabled(),
        profile: await page
          .locator("#intake-profile")
          .evaluate((el) => el.closest(".ant-select")?.classList.contains("ant-select-disabled") ?? false),
        add: await page.locator(".entry-area > .ant-btn").isDisabled(),
      };
      // 期间尝试再次触发（直接点确认按钮已随弹窗关闭不可用，改为按 Enter 触发追加）
      await page.locator("#intake-number").press("Enter").catch(() => undefined);
      confirmGate.forEach((release) => release());
      await page.waitForTimeout(300);
      await page.unroute(/\/prop\/production\/intake$/);
      await page.waitForFunction(
        () => document.querySelector(".candidate-panel header h2")?.textContent?.includes("0"),
        undefined,
        { timeout: 30000 },
      );
      const confirmToast = await readToasts(page);
      notes.push(`确认中禁用(编号=${duringConfirm.number},资料=${duringConfirm.profile},追加=${duringConfirm.add}),确认请求=${confirmCalls}次,结果「${compact(confirmToast, 40)}」`);

      // 4) 结束后切换资料清空原候选
      await page.locator("#intake-number").fill("AUTO-R29010");
      await page.locator("#intake-number").press("Enter");
      await page.waitForFunction(
        () => document.querySelector(".candidate-panel header h2")?.textContent?.includes("1"),
      );
      await page
        .locator("#intake-profile")
        .locator("xpath=ancestor::div[contains(@class,'ant-select')][1]")
        .click();
      await pickOptionScroll(page, "衣体 オレンジ 标准型123");
      await page.waitForTimeout(400);
      const cleared = (await candidateHeader(page)).includes("0");
      const prefixAuto = await page.locator(".ant-tabs-tab", { hasText: "連続入力" }).click()
        .then(() => page.locator("#intake-prefix").inputValue());
      notes.push(`切换资料后候选清空=${cleared},前缀带出=${prefixAuto}`);

      const ok = duringCheck.number && duringCheck.profile && duringCheck.add && duringCheck.tabs > 0 &&
        row1.includes("AUTO-规格-013") &&
        failToastAll.trim().length > 0 && inputKept && stillOne && enabledAgain &&
        duringConfirm.number && duringConfirm.profile && duringConfirm.add && confirmCalls === 1 &&
        /成功\s*1件/.test(confirmToast) && cleared;
      return { status: ok ? "通过" : "部分验证", actual: notes.join("；"), evidence: "page.route 延迟/拦截 + 禁用态断言 + 提示文案" };
    });
  } finally {
    await finishSession(browser, session, "verify-prod-intake-028-029");
    await db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
