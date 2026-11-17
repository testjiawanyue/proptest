/**
 * 冲突复验：并发编辑是否静默覆盖（用例 客户编辑-010 / BR-059）
 * 静态结论：只有行锁串行化，无版本比较，后保存覆盖先保存且无提示。
 * 方法：两个浏览器会话同时打开同一公司的编辑弹窗，A 先保存、B 后保存，
 *       观察 B 是否收到"数据已被他人修改"提示，以及数据库最终值。
 */
import { chromium, type Browser, type Page } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { createCompany } from "../../src/actions/customer.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

interface SaveOutcome {
  label: string;
  toastText: string;
  apiCalls: { method: string; path: string; status: number; body: string }[];
}

async function openEditor(page: Page, subjectId: number): Promise<void> {
  await page.goto(`/customer/detail/${subjectId}`);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.getByRole("button", { name: "编辑资料" }).first().click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 5000 });
}

async function fillAndSave(page: Page, label: string, storagePath: string, apiLog: SaveOutcome["apiCalls"]): Promise<SaveOutcome> {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").last().fill(storagePath);
  await dialog.getByRole("button", { name: /确\s*定/ }).click();
  await page.waitForTimeout(2000);
  const toastText = await page.locator(".ant-message span, .ant-modal-confirm-content, .el-message").allInnerTexts()
    .then((texts) => texts.join(" | ").slice(0, 300))
    .catch(() => "");
  return { label, toastText, apiCalls: apiLog };
}

function watchCustomerApi(page: Page, apiCalls: SaveOutcome["apiCalls"]): void {
  page.on("response", (response) => {
    void (async () => {
      const request = response.request();
      if (["PUT", "POST"].includes(request.method()) && request.url().includes("/prop/customer")) {
        apiCalls.push({
          method: request.method(),
          path: new URL(request.url()).pathname,
          status: response.status(),
          body: (await response.text().catch(() => "")).slice(0, 300),
        });
      }
    })();
  });
}

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });

  const setup = await createSession(browser, { traceName: "concurrent-setup" });
  await login(setup.page);
  const companyName = "AUTO-并发验证公司";
  await createCompany(setup.page, { name: companyName });
  const found = await db.snapshot("find", `SELECT subject_id FROM prop_customer_subject WHERE subject_name = '${companyName}' ORDER BY subject_id DESC LIMIT 1`);
  const subjectId = Number(found.rows[0].subject_id);
  console.log(`[concurrent] test company created: subject_id=${subjectId}`);
  await closeSession(setup, "concurrent-setup");

  const sessionA = await createSession(browser, { traceName: "concurrent-A" });
  const sessionB = await createSession(browser, { traceName: "concurrent-B" });
  const apiA: SaveOutcome["apiCalls"] = [];
  const apiB: SaveOutcome["apiCalls"] = [];
  watchCustomerApi(sessionA.page, apiA);
  watchCustomerApi(sessionB.page, apiB);

  try {
    await login(sessionA.page);
    await login(sessionB.page);

    await openEditor(sessionA.page, subjectId);
    await openEditor(sessionB.page, subjectId);
    console.log("[concurrent] both editors open on the same company");

    const outcomeA = await fillAndSave(sessionA.page, "A", "AUTO-路径-A-先保存", apiA);
    console.log(`[concurrent] A saved: toast='${outcomeA.toastText}' api=${JSON.stringify(outcomeA.apiCalls)}`);

    const outcomeB = await fillAndSave(sessionB.page, "B", "AUTO-路径-B-后保存", apiB);
    console.log(`[concurrent] B saved: toast='${outcomeB.toastText}' api=${JSON.stringify(outcomeB.apiCalls)}`);

    const finalRow = await db.snapshot("final", `SELECT storage_path, update_time FROM prop_customer_subject WHERE subject_id = ${subjectId}`);
    const finalPath = String(finalRow.rows[0].storage_path ?? "");
    console.log(`[concurrent] final db storage_path='${finalPath}'`);

    const bWarned = /他人|已被.*修改|覆盖|冲突|刷新/.test(outcomeB.toastText) ||
      outcomeB.apiCalls.some((call) => call.status === 409 || /他人|冲突|已被/.test(call.body));

    console.log("---- VERDICT ----");
    if (finalPath.includes("B-后保存") && !bWarned) {
      console.log("CONFLICT-CONFIRMED: B 后保存静默覆盖了 A 的修改，全程无任何提示。与静态分析一致（有行锁无版本检查），用例 客户编辑-010 的预期（提示他人已修改）在当前实现下必然失败。");
    } else if (bWarned) {
      console.log("NO-CONFLICT: B 保存时收到了并发修改提示，用例预期成立，静态结论需修正。");
    } else {
      console.log(`UNCONFIRMED: final='${finalPath}', bWarned=${bWarned}，需要人工查看 Trace。`);
    }
  } finally {
    await closeSession(sessionA, "concurrent-A");
    await closeSession(sessionB, "concurrent-B");
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[concurrent] FAILED:", e.message); process.exit(1); });
