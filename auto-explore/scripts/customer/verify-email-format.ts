/**
 * 冲突复验：邮箱格式是否校验（用例 客户编辑-008 / 需求基线 REQ-012 已明确"无邮箱格式校验"）
 * 方法：新建公司时添加地址+联系人，邮箱填入非法格式，观察是否被拦截。
 */
import { chromium, type Locator, type Page } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function fillField(dialog: Locator, label: string, value: string): Promise<void> {
  const item = dialog.locator(".ant-form-item", { hasText: label }).first();
  await item.getByRole("textbox").fill(value);
}

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-email" });
  const page = session.page;

  const companyName = "AUTO-邮箱验证公司";
  const invalidEmail = "not-an-email";

  try {
    await login(page);
    await page.goto("/customer");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);

    await page.getByRole("button", { name: "新建公司" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 5000 });

    await fillField(dialog, "公司名称", companyName);
    await dialog.getByRole("button", { name: "添加地址" }).first().click();
    await page.waitForTimeout(500);
    await dialog.getByRole("button", { name: "添加联系人" }).first().click();
    await page.waitForTimeout(500);

    await fillField(dialog, "邮编", "1000001");
    await fillField(dialog, "地址 1", "AUTO-东京都千代田区1-1-1");
    await fillField(dialog, "姓名", "AUTO-テスト太郎");
    await fillField(dialog, "邮箱", invalidEmail);

    let apiStatus: number | undefined;
    let apiBody = "";
    page.on("response", (response) => {
      void (async () => {
        if (response.request().method() === "POST" && response.url().includes("/prop/customer/company")) {
          apiStatus = response.status();
          apiBody = (await response.text().catch(() => "")).slice(0, 300);
        }
      })();
    });

    await dialog.getByRole("button", { name: /确\s*定/ }).click();
    await page.waitForTimeout(2000);

    const dialogClosed = !(await dialog.isVisible().catch(() => false));
    const fieldErrors = await page.locator(".ant-form-item-explain-error").allInnerTexts().catch(() => [] as string[]);
    const toast = await page.locator(".ant-message span").allInnerTexts().then((t) => t.join(" | ")).catch(() => "");
    console.log(`[email] dialogClosed=${dialogClosed} api=${apiStatus} body='${apiBody}'`);
    console.log(`[email] fieldErrors=${JSON.stringify(fieldErrors)} toast='${toast}'`);

    const contact = await db.snapshot(
      "contact",
      `SELECT * FROM prop_customer_contact ORDER BY contact_id DESC LIMIT 1`,
    );
    const savedEmail = contact.rows.length > 0 ? JSON.stringify(contact.rows[0]) : "(no contact row)";
    console.log(`[email] latest contact row: ${savedEmail.slice(0, 400)}`);

    const emailSaved = savedEmail.includes(invalidEmail);

    console.log("---- VERDICT ----");
    if (dialogClosed && emailSaved) {
      console.log("CONFIRMED: 非法格式邮箱（" + invalidEmail + "）未触发任何校验，随联系人正常落库。与需求基线「无邮箱格式校验」一致；用例 客户编辑-008 的预期（格式校验拦截）与基线矛盾，应修正用例。");
    } else if (!dialogClosed || fieldErrors.length > 0) {
      console.log("NOT-CONFIRMED: 存在邮箱格式校验拦截，基线与静态结论需修正。fieldErrors=" + JSON.stringify(fieldErrors));
    } else {
      console.log("UNCONFIRMED: 需要人工查看 Trace。dialogClosed=" + dialogClosed + " emailSaved=" + emailSaved);
    }
  } finally {
    const tracePath = await closeSession(session, "verify-email");
    console.log("[email] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[email] FAILED:", e.message); process.exit(1); });
