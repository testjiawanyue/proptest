/**
 * 冲突复验：删除被订单引用的地址是否被拦截（用例 客户删除-003 / 静态分析 BR-066）
 * 方法：新建公司+地址 → DB 种入引用该地址的订单 → 编辑工作区移除地址并保存
 *       观察是否拦截，以及数据库地址是否被删。
 */
import { chromium, type Locator } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { createCompany } from "../../src/actions/customer.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function fillField(dialog: Locator, label: string, value: string): Promise<void> {
  const item = dialog.locator(".ant-form-item", { hasText: label }).first();
  await item.getByRole("textbox").fill(value);
}

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-delete-address" });
  const page = session.page;
  const companyName = "AUTO-删除验证公司";

  try {
    await login(page);

    await createCompany(page, { name: companyName });
    const company = await db.snapshot("company", `SELECT subject_id FROM prop_customer_subject WHERE subject_name = '${companyName}' ORDER BY subject_id DESC LIMIT 1`);
    const subjectId = Number(company.rows[0].subject_id);
    console.log(`[del] company subject_id=${subjectId}`);

    await page.goto(`/customer/detail/${subjectId}`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.getByRole("button", { name: "编辑资料" }).first().click();
    let dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    await dialog.getByRole("button", { name: "添加地址" }).first().click();
    await page.waitForTimeout(500);
    await fillField(dialog, "邮编", "1000002");
    await fillField(dialog, "地址 1", "AUTO-删除验证地址");
    await dialog.getByRole("button", { name: /确\s*定/ }).click();
    await page.waitForTimeout(2000);

    const addr = await db.snapshot("addr", `SELECT address_id FROM prop_customer_address WHERE subject_id = ${subjectId} ORDER BY address_id DESC LIMIT 1`);
    const addressId = Number(addr.rows[0].address_id);
    console.log(`[del] address created: address_id=${addressId}`);

    await db.snapshot("seed-order",
      `INSERT INTO prop_order (order_no, order_date, order_type, customer_type, order_status,
        ordering_party_snapshot, recipient_snapshot, billing_party_snapshot,
        delivery_address_id, delivery_address_snapshot, revision, create_by, create_time)
       VALUES ('AUTO-ORD-001', CURDATE(), 'normal', 'direct', 'active', '{}', '{}', '{}', ${addressId}, '{}', 1, 'admin', NOW())`);
    console.log("[del] seeded order AUTO-ORD-001 referencing the address");

    await page.goto(`/customer/detail/${subjectId}`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.getByRole("button", { name: "编辑资料" }).first().click();
    dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible", timeout: 5000 });

    let saveStatus: number | undefined;
    let saveBody = "";
    page.on("response", (response) => {
      void (async () => {
        if (response.request().method() === "PUT" && response.url().includes(`/prop/customer/${subjectId}`)) {
          saveStatus = response.status();
          saveBody = (await response.text().catch(() => "")).slice(0, 400);
        }
      })();
    });

    await dialog.getByRole("button", { name: "移除" }).first().click();
    await page.waitForTimeout(500);
    const confirmDialog = page.getByRole("dialog").last();
    const confirmRemove = confirmDialog.getByRole("button", { name: /移\s*除/ });
    if (await confirmRemove.isVisible().catch(() => false)) {
      await confirmRemove.click();
      console.log("[del] removal confirm modal accepted");
      await page.waitForTimeout(800);
    }
    await dialog.getByRole("button", { name: /确\s*定/ }).click();
    await page.waitForTimeout(2000);

    const dialogClosed = !(await dialog.isVisible().catch(() => false));
    const toast = await page.locator(".ant-message span, .ant-form-item-explain-error").allInnerTexts().then((t) => t.join(" | ")).catch(() => "");
    console.log(`[del] save: status=${saveStatus} body='${saveBody}' dialogClosed=${dialogClosed} toast='${toast}'`);

    const addrAfter = await db.snapshot("addrAfter", `SELECT address_id FROM prop_customer_address WHERE address_id = ${addressId}`);
    const addressDeleted = addrAfter.rows.length === 0;
    console.log(`[del] address exists after save: ${!addressDeleted}`);

    console.log("---- VERDICT ----");
    if (addressDeleted && (saveStatus ?? 200) < 400) {
      console.log("CONFLICT-CONFIRMED: 被订单引用的地址可经编辑移除并成功保存删除，系统未检查订单引用。与静态分析一致；用例 客户删除-003 的预期（引用拦截）在当前实现下必然失败。删除后订单 AUTO-ORD-001 的 delivery_address_id 成为悬空引用。");
    } else if (!addressDeleted) {
      console.log("NO-CONFLICT: 地址删除被拦截或保留，用例预期成立，静态结论需修正。");
    } else {
      console.log("UNCONFIRMED: 需人工查看 Trace。");
    }
  } finally {
    const tracePath = await closeSession(session, "verify-delete-address");
    console.log("[del] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[del] FAILED:", e.message); process.exit(1); });


