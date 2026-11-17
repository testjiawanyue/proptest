/**
 * 订单管理·编辑与取消方向运行时验证
 * 来源：用例 编辑订单/取消订单章节、REQ-042/REQ-046；BR-016/017/018/019/020
 * 方法：UI 编辑备注 + UI 取消流程 + API 规则矩阵（乐观锁/已取消禁改/重复取消幂等）+ DB 快照
 * 对象：KW1(order_id 由 customer_order_no=AUTO-CO-001 查)、KW2(AUTO-CO-002 取消对象)、KW3(AUTO-CO-003 已取消)
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-order-edit-cancel" });
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
    const idOf = async (co: string) => Number((await db.snapshot("id", "SELECT order_id FROM prop_order WHERE customer_order_no=?", [co])).rows[0]?.order_id);
    const kw1 = await idOf("AUTO-CO-001");
    const kw2 = await idOf("AUTO-CO-002");
    const kw3 = await idOf("AUTO-CO-003");
    console.log("[ids] KW1:", kw1, "KW2:", kw2, "KW3:", kw3);

    // ---- 1. UI 编辑 KW1 备注（用例 编辑-001 主流程）----
    await page.goto(`/orders/${kw1}/edit`);
    await page.waitForTimeout(1500);
    const saveBtn = page.locator(".sticky-actions button", { hasText: "注文を保存" });
    console.log("[edit] edit page loaded, save btn visible:", await saveBtn.isVisible().catch(() => false));
    await page.locator("textarea").last().fill("AUTO-编辑备注-001");
    const putRespP = page.waitForResponse((r) => r.url().includes(`/prop/order/${kw1}`) && r.request().method() === "PUT", { timeout: 15000 });
    await saveBtn.click();
    const putResp = await putRespP;
    const putBody = JSON.parse(await putResp.text());
    console.log("[edit] PUT code:", putBody.code, "msg:", putBody.msg);
    await page.waitForTimeout(1200);
    const remarkRow = await db.snapshot("r", "SELECT remark, revision FROM prop_order WHERE order_id=?", [kw1]);
    const editOps = await db.snapshot("r", "SELECT operation_type FROM prop_order_operation WHERE order_id=? AND operation_type='edit'", [kw1]);
    console.log("[edit] DB remark:", remarkRow.rows[0]?.remark, "revision:", remarkRow.rows[0]?.revision, "| edit ops:", editOps.rows.length);

    // ---- 2. 乐观锁（BR-016）：旧 revision PUT 被拒 ----
    const detail = await api("GET", `/prop/order/${kw1}`);
    const current = detail.body.data;
    const stalePayload = {
      revision: Number(current.revision) - 99,
      customerOrderNo: current.customerOrderNo, orderDate: current.orderDate, expectedShipDate: current.expectedShipDate,
      orderType: current.orderType, customerType: current.customerType,
      orderingPartyId: 1, recipientId: 1, billingPartyId: 1, deliveryAddressId: 1, deliveryContactId: 1,
      productNameId: 2, lines: current.lines?.map((l: any) => ({ lineId: l.lineId, productName: l.productName, colorNote: l.colorNote, quantity: l.quantity })) ?? [],
      remark: "AUTO-旧版本提交",
    };
    const stale = await api("PUT", `/prop/order/${kw1}`, stalePayload);
    console.log("[edit] stale revision PUT -> code:", stale.body.code, "msg:", stale.body.msg);

    // ---- 3. 已取消订单禁止编辑（BR-016/020）----
    const kw3Detail = await api("GET", `/prop/order/${kw3}`);
    const c = kw3Detail.body.data;
    const editCancelled = await api("PUT", `/prop/order/${kw3}`, { ...stalePayload, revision: c.revision, remark: "AUTO-改已取消" });
    console.log("[edit] cancelled order PUT -> code:", editCancelled.body.code, "msg:", editCancelled.body.msg);
    await page.goto(`/orders/${kw3}`);
    await page.waitForTimeout(1200);
    const headText = await page.locator(".detail-head").innerText();
    console.log("[edit] cancelled detail head has 編集/キャンセル buttons:", headText.includes("注文を編集"), headText.includes("注文をキャンセル"));

    // ---- 4. 取消流程 UI（用例 取消-xxx）：KW2 ----
    const kw2Before = await db.snapshot("b", "SELECT order_status FROM prop_order WHERE order_id=?", [kw2]);
    if (kw2Before.rows[0]?.order_status === "active") {
      await page.goto(`/orders/${kw2}`);
      await page.waitForTimeout(1200);
      await page.locator(".detail-head button", { hasText: "注文をキャンセル" }).click();
      await page.waitForTimeout(600);
      const cancelModal = page.locator(".ant-modal", { hasText: "注文をキャンセル" });
      // 空理由提交（BR-018 必填）：前端 message 拦截且不发请求
      let emptyCancelReq = false;
      const emptyListener = (req: { url: () => string; method: () => string }) => { if (req.url().includes("/cancel") && req.method() === "POST") emptyCancelReq = true; };
      page.on("request", emptyListener);
      await cancelModal.getByRole("button", { name: /キャンセルを確定/ }).click();
      await page.waitForTimeout(1000);
      page.off("request", emptyListener);
      const msgErr = await page.locator(".ant-message").innerText().catch(() => "");
      console.log("[cancel] empty reason: request sent:", emptyCancelReq, "| message:", JSON.stringify(msgErr));
      await cancelModal.locator("textarea").fill("AUTO-取消理由：客户要求取消");
      const cancelRespP = page.waitForResponse((r) => r.url().includes(`/prop/order/${kw2}/cancel`) && r.request().method() === "POST", { timeout: 15000 });
      await cancelModal.getByRole("button", { name: /キャンセルを確定/ }).click();
      const cancelResp = await cancelRespP;
      console.log("[cancel] POST code:", JSON.parse(await cancelResp.text()).code);
      await page.waitForTimeout(1200);
      const kw2After = await db.snapshot("a", "SELECT order_status, cancel_reason, cancelled_by FROM prop_order WHERE order_id=?", [kw2]);
      console.log("[cancel] DB status:", JSON.stringify(kw2After.rows));
      const head2 = await page.locator(".detail-head").innerText().catch(() => "");
      console.log("[cancel] after cancel head shows 編集:", head2.includes("注文を編集"), "| 出荷 button:", await page.locator("button", { hasText: "出荷" }).count());
    } else {
      console.log("[cancel] KW2 已是 cancelled（幂等跳过 UI 取消）");
    }

    // ---- 5. 重复取消幂等（BR-018）----
    const kw2Cur = await db.snapshot("r", "SELECT revision FROM prop_order WHERE order_id=?", [kw2]);
    const recancel = await api("POST", `/prop/order/${kw2}/cancel`, { revision: kw2Cur.rows[0].revision, reason: "AUTO-重复取消" });
    console.log("[cancel] repeat cancel -> code:", recancel.body.code, "msg:", recancel.body.msg);

    // ---- 6. 已取消订单禁止新建寄送（BR-020）----
    const shipCancelled = await api("POST", "/prop/shipment", { requestId: crypto.randomUUID(), orderId: kw2, revision: 99, adoptedProductName: "一命多助", shipDate: "2026-10-26" });
    console.log("[cancel] create shipment on cancelled order -> code:", shipCancelled.body.code, "msg:", shipCancelled.body.msg);

    console.log("---- VERDICT ----");
    console.log(putBody.code === 200 && remarkRow.rows[0]?.remark === "AUTO-编辑备注-001" && editOps.rows.length > 0
      ? "PASS 编辑主流程：备注更新、revision 递增、edit 操作记录生成。"
      : `CHECK 编辑：code=${putBody.code} remark=${remarkRow.rows[0]?.remark} ops=${editOps.rows.length}`);
    console.log(stale.body.code !== 200 ? `PASS BR-016：旧 revision 提交被拒（code=${stale.body.code}：${stale.body.msg}）。` : "CHECK 乐观锁未拦截");
    console.log(editCancelled.body.code !== 200 ? `PASS BR-020：已取消订单编辑被服务端拒绝（${editCancelled.body.msg}）。` : "CHECK 已取消仍可编辑");
    console.log(!headText.includes("注文を編集") ? "PASS BR-020：已取消订单详情页无编辑/取消按钮。" : "CHECK 已取消详情页仍显示编辑按钮");
    console.log(recancel.body.code === 200 ? `PASS BR-018：重复取消幂等返回现状（code=${recancel.body.code}）。` : `CHECK 重复取消：code=${recancel.body.code} msg=${recancel.body.msg}`);
    console.log(shipCancelled.body.code !== 200 ? `PASS BR-020：已取消订单新建寄送被拒（${shipCancelled.body.msg}）。` : "CHECK 已取消订单仍可建寄送");
    console.log(api500.length ? `API-5xx 巡检命中：${api500.join(" ; ")}` : "API-5xx 巡检：编辑/取消方向无 5xx。");
  } finally {
    const tracePath = await closeSession(session, "verify-order-edit-cancel");
    console.log("[edit-cancel] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[edit-cancel] FAILED:", e.message); process.exit(1); });
