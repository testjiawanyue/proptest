/**
 * 订单管理·新建订单方向运行时验证
 * 来源：用例 新建订单-001~020（核心项）、REQ-041/REQ-042；BR-008~BR-017
 * 方法：真实 UI 走完创建表单（客户选择器/地址/联系人/字典产品名/多行）+ POST 请求捕获 + DB 快照对比 + API 幂等重放
 * 产出订单：customer_order_no=AUTO-CO-NEW-001（幂等：已存在则跳过创建，直接进入校验项）
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-order-create" });
  const { context, page } = session;
  const api500: string[] = [];
  page.on("response", (r) => { if (r.status() >= 500) api500.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  try {
    await login(page);
    const cookies = await context.cookies();
    const token = cookies.find((ck) => ck.name === "Admin-Token")?.value || "";
    const api = async (method: string, url: string, data?: unknown) => {
      const resp = await context.request.fetch(`http://localhost:8090/dev-api${url}`, {
        method, data: data as never,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      return { status: resp.status(), body: await resp.json().catch(() => ({})) };
    };

    // ---- 幂等检查：本轮订单是否已建 ----
    const existing = await db.snapshot("chk", "SELECT order_id, generated_no FROM prop_order WHERE customer_order_no='AUTO-CO-NEW-001'");
    let createdOrderId: number | null = existing.rows.length ? Number(existing.rows[0].order_id) : null;
    let capturedPayload: string | null = null;

    if (!createdOrderId) {
      // ---- 1. 打开新建页，检查默认值（用例-001）----
      await page.goto("/orders/new");
      await page.waitForTimeout(1500);
      const saleChecked = await page.locator(".ant-radio-button-wrapper-checked", { hasText: "販売" }).count();
      const directChecked = await page.locator(".ant-radio-button-wrapper-checked", { hasText: "直販" }).count();
      const orderDateVal = await page.locator(".ant-picker input").first().inputValue();
      const today = new Date().toLocaleDateString("sv-SE");
      console.log("[new] defaults: sale checked:", saleChecked > 0, "| direct checked:", directChecked > 0, "| orderDate:", orderDateVal, "today:", today);

      // ---- 2. 空提交校验（REQ-041 异常，BR-015）----
      await page.locator(".sticky-actions button", { hasText: "注文を作成" }).click();
      await page.waitForTimeout(800);
      const errTexts = await page.locator(".ant-form-item-explain-error").allInnerTexts();
      console.log("[new] empty submit errors:", JSON.stringify(errTexts));

      // ---- 3. 下单方选择（用例-002/003：客户选择器搜索+选择）----
      await page.locator("#orderForm_ordering").click();
      const subjectModal = page.locator(".ant-modal", { hasText: "会社・支店／現場を選択" });
      await subjectModal.getByPlaceholder("会社名・支店名・番号で検索").fill("测试公司1");
      await subjectModal.getByPlaceholder("会社名・支店名・番号で検索").press("Enter");
      await page.waitForTimeout(1000);
      await subjectModal.locator(".ant-tree-node-content-wrapper", { hasText: "测试公司1" }).first().click();
      await page.waitForTimeout(800);
      const okBtn = subjectModal.getByRole("button", { name: /選択：/ });
      console.log("[new] subject ok button:", await okBtn.innerText().catch(() => "(无)"));
      await okBtn.click();
      await page.waitForTimeout(600);

      // ---- 4. 納品先选择（用例-004）+ 請求書先默认（用例-005）----
      await page.locator("#orderForm_recipient").click();
      const subjectModal2 = page.locator(".ant-modal", { hasText: "会社・支店／現場を選択" });
      await subjectModal2.getByPlaceholder("会社名・支店名・番号で検索").fill("测试公司1");
      await subjectModal2.getByPlaceholder("会社名・支店名・番号で検索").press("Enter");
      await page.waitForTimeout(1000);
      await subjectModal2.locator(".ant-tree-node-content-wrapper", { hasText: "测试公司1" }).first().click();
      await page.waitForTimeout(800);
      await subjectModal2.getByRole("button", { name: /選択：/ }).click();
      await page.waitForTimeout(600);
      const billingText = await page.locator(".customer-relations").innerText();
      console.log("[new] billing auto-copy ordering（显示测试公司1）:", billingText.includes("测试公司1"), "| billing区文本含注文先と同じ:", billingText.includes("注文先と同じ"));

      // ---- 5. 配送地址（用例-006/007 选用既有地址）----
      await page.locator("#orderForm_deliveryAddress").click();
      const addrModal = page.locator(".ant-modal", { hasText: "配送先住所を選択" });
      await page.waitForTimeout(800);
      console.log("[new] address modal text head:", (await addrModal.innerText()).slice(0, 120).replace(/\n/g, " | "));
      await addrModal.getByRole("button", { name: /^選択$/ }).first().click();
      await page.waitForTimeout(600);
      // 若弹窗仍在（需要确认按钮），点选择
      if (await addrModal.isVisible().catch(() => false)) {
        await addrModal.getByRole("button", { name: /^選択$/ }).click().catch(() => {});
        await page.waitForTimeout(500);
      }
      console.log("[new] address modal closed:", !(await addrModal.isVisible().catch(() => false)));

      // ---- 6. 联系人（任意，用例-009 选用既有）----
      const contactBtn = page.getByText("＋ 担当者を選択（任意）");
      if (await contactBtn.isVisible().catch(() => false)) {
        await contactBtn.click();
        const contactModal = page.locator(".ant-modal", { hasText: "担当者を選択" });
        await page.waitForTimeout(800);
        await contactModal.getByText("张三").first().click();
        await page.waitForTimeout(500);
        if (await contactModal.isVisible().catch(() => false)) {
          await contactModal.getByRole("button", { name: /^選択$/ }).click().catch(() => {});
          await page.waitForTimeout(500);
        }
        console.log("[new] contact modal closed:", !(await contactModal.isVisible().catch(() => false)));
      } else {
        console.log("[new] contact entry not visible（可能已自动带出）");
      }

      // ---- 7. 产品名字典（用例-010：仅启用项可选）----
      await page.locator(".ant-select").first().click();
      await page.waitForTimeout(500);
      const prodOptions = await page.locator(".ant-select-dropdown:visible .ant-select-item-option").allInnerTexts();
      console.log("[new] product name options:", JSON.stringify(prodOptions));
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "一命多助" }).first().click();

      // ---- 8. 订购行（用例-011/012/013）----
      // 单行时删除按钮禁用（013）
      const delBtns = page.locator(".line-row button", { hasText: "削除" });
      const singleDelDisabled = await delBtns.first().isDisabled().catch(() => null);
      console.log("[new] single-line delete disabled:", singleDelDisabled);
      // 加一行（011）
      await page.locator("button", { hasText: "＋ ご希望の色を追加" }).click();
      await page.waitForTimeout(400);
      const lineRows = page.locator(".line-row");
      console.log("[new] line rows:", await lineRows.count());
      await lineRows.nth(0).getByPlaceholder("ご希望の色（任意）").fill("AUTO-橙");
      await lineRows.nth(0).locator(".ant-input-number input").fill("2");
      await lineRows.nth(1).getByPlaceholder("ご希望の色（任意）").fill("AUTO-蓝");
      await lineRows.nth(1).locator(".ant-input-number input").fill("1");
      // 数量 0 校验（012）
      await lineRows.nth(1).locator(".ant-input-number input").fill("0");
      await page.locator(".sticky-actions button", { hasText: "注文を作成" }).click();
      await page.waitForTimeout(800);
      const qtyErr = await page.locator(".ant-form-item-explain-error").allInnerTexts();
      console.log("[new] quantity=0 errors:", JSON.stringify(qtyErr));
      await lineRows.nth(1).locator(".ant-input-number input").fill("1");
      // 删除第二行再重新加（013 行删除可用）
      await lineRows.nth(1).locator("button", { hasText: "削除" }).click();
      await page.waitForTimeout(400);
      console.log("[new] after delete line rows:", await page.locator(".line-row").count());
      await page.locator("button", { hasText: "＋ ご希望の色を追加" }).click();
      await page.waitForTimeout(400);
      await page.locator(".line-row").nth(1).getByPlaceholder("ご希望の色（任意）").fill("AUTO-蓝");
      await page.locator(".line-row").nth(1).locator(".ant-input-number input").fill("1");

      // ---- 9. 客户订单号 + 备注，提交（用例-014）----
      await page.locator(".ant-form-item", { hasText: "お客様注文番号" }).locator("input").first().fill("AUTO-CO-NEW-001");
      const postPromise = page.waitForRequest((r) => r.url().includes("/prop/order") && r.method() === "POST", { timeout: 15000 });
      const respPromise = page.waitForResponse((r) => r.url().includes("/prop/order") && r.request().method() === "POST", { timeout: 15000 });
      await page.locator(".sticky-actions button", { hasText: "注文を作成" }).click();
      const postReq = await postPromise;
      capturedPayload = postReq.postData();
      const postResp = await respPromise;
      const postBody = JSON.parse(await postResp.text());
      console.log("[new] POST status:", postResp.status(), "code:", postBody.code, "msg:", postBody.msg);
      await page.waitForTimeout(1500);
      console.log("[new] after create url:", page.url());
      const created = await db.snapshot("created", "SELECT order_id, order_no, generated_no, order_status FROM prop_order WHERE customer_order_no='AUTO-CO-NEW-001'");
      createdOrderId = created.rows.length ? Number(created.rows[0].order_id) : null;
      console.log("[new] DB row:", JSON.stringify(created.rows));
    } else {
      console.log("[new] AUTO-CO-NEW-001 已存在（幂等跳过创建），orderId:", createdOrderId);
      await page.goto(`/orders/${createdOrderId}`);
      await page.waitForTimeout(1500);
    }

    // ---- 10. DB 快照对比（用例-014/015/016：编号、快照、操作记录）----
    if (createdOrderId) {
      const row = await db.snapshot("row", "SELECT order_no, generated_no, order_type, customer_type, order_status, ordering_party_snapshot, recipient_snapshot, billing_party_snapshot, delivery_address_snapshot FROM prop_order WHERE order_id=?", [createdOrderId]);
      const lines = await db.snapshot("lines", "SELECT product_name, color_note, quantity FROM prop_order_line WHERE order_id=? ORDER BY sort_order", [createdOrderId]);
      const ops = await db.snapshot("ops", "SELECT operation_type, description FROM prop_order_operation WHERE order_id=?", [createdOrderId]);
      console.log("[db] order:", JSON.stringify(row.rows).slice(0, 900));
      console.log("[db] lines:", JSON.stringify(lines.rows));
      console.log("[db] operations:", JSON.stringify(ops.rows).slice(0, 400));
    }

    // ---- 11. 幂等重放（BR-008，用例-019/020 方向）----
    if (capturedPayload) {
      const before = await db.snapshot("cnt", "SELECT COUNT(*) c FROM prop_order");
      const replay = await api("POST", "/prop/order", JSON.parse(capturedPayload));
      console.log("[idem] same requestId+same payload -> code:", replay.body.code, "msg:", replay.body.msg, "orderId:", replay.body.data?.orderId ?? replay.body.data);
      const altered = JSON.parse(capturedPayload);
      altered.remark = "AUTO-篡改内容";
      const conflict = await api("POST", "/prop/order", altered);
      console.log("[idem] same requestId+diff payload -> code:", conflict.body.code, "msg:", conflict.body.msg);
      const after = await db.snapshot("cnt", "SELECT COUNT(*) c FROM prop_order");
      console.log("[idem] order count before/after:", before.rows[0].c, after.rows[0].c);
    }

    console.log("---- VERDICT ----");
    console.log(createdOrderId ? `PASS 用例-014：订单创建成功，orderId=${createdOrderId}。` : "CHECK 创建未成功");
    if (createdOrderId) {
      const g = await db.snapshot("g", "SELECT generated_no, order_status FROM prop_order WHERE order_id=?", [createdOrderId]);
      const gen = String(g.rows[0].generated_no || "");
      console.log(/^I26\d{4}$/.test(gen) ? `PASS 用例-014b：编号 ${gen} 符合 [I]+YY+NNNN 格式。` : `CHECK 编号格式：${gen}`);
    }
    console.log(api500.length ? `API-5xx 巡检命中：${api500.join(" ; ")}` : "API-5xx 巡检：新建方向无 5xx。");
  } finally {
    const tracePath = await closeSession(session, "verify-order-create");
    console.log("[create] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[create] FAILED:", e.message); process.exit(1); });
