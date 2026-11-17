/**
 * 订单管理·解除产品关联方向运行时验证
 * 来源：REQ-047（P2：代码强制 baselineAction=keep/clear vs Spec「不要求选择原因」，无对应用例——建议补充）
 *      解除关联效果（BR-024/025/026）；REQ-050 剩余可发显示
 * 方法：真实 UI 打开解除弹窗（不选直接确定→前端校验）+ API 复核 + keep/clear 两路径 DB 对比
 * 对象：order5/relation(product 111) 走 keep；KW1(AUTO-CO-001)/relation(AUTO-J002) 走 clear
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-order-relation" });
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

    // ---- 当前有效关系 ----
    const rel5 = await db.snapshot("r", "SELECT relation_id, product_id, delivery_valid FROM prop_product_order_relation WHERE order_id=5 AND delivery_valid=1");
    const kw1 = Number((await db.snapshot("id", "SELECT order_id FROM prop_order WHERE customer_order_no='AUTO-CO-001'")).rows[0].order_id);
    const relKw1 = await db.snapshot("r", "SELECT relation_id, product_id, delivery_valid FROM prop_product_order_relation WHERE order_id=? AND delivery_valid=1", [kw1]);
    console.log("[rel] order5 current:", JSON.stringify(rel5.rows), "| KW1 current:", JSON.stringify(relKw1.rows));

    // ---- 1. UI：解除弹窗交互（REQ-047 复验）----
    let uiConfirmed = false, noReasonOption = false, frontendBlocked = false, keepDone = false;
    if (rel5.rows.length) {
      await page.goto("/orders/5");
      await page.waitForTimeout(1500);
      await page.locator("button", { hasText: /関連付けを解除/ }).first().click();
      await page.waitForTimeout(800);
      const modal = page.locator(".ant-modal", { hasText: "製品の関連付けを解除" });
      const modalText = await modal.innerText();
      console.log("[rel] modal text head:", modalText.slice(0, 300).replace(/\n/g, " | "));
      const radios = await modal.locator(".ant-radio-wrapper").allInnerTexts();
      console.log("[rel] radio options:", JSON.stringify(radios));
      noReasonOption = radios.some((t) => /理由|不要|選択しない/.test(t));
      // 不选直接确定 → 前端校验
      let releaseReq = false;
      const l = (req: { url: () => string }) => { if (req.url().includes("/release")) releaseReq = true; };
      page.on("request", l);
      await modal.getByRole("button", { name: /解除を確定/ }).click();
      await page.waitForTimeout(1000);
      page.off("request", l);
      const errText = await modal.locator(".ant-form-item-explain-error").allInnerTexts().catch(() => []);
      frontendBlocked = !releaseReq && errText.some((t) => t.includes("基準を保持するかクリアするかを選択する"));
      console.log("[rel] no-select confirm: request sent:", releaseReq, "| errors:", JSON.stringify(errText));
      // 选择 keep 并确认
      await modal.locator(".ant-radio-wrapper", { hasText: "基準月を保持" }).click();
      const relRespP = page.waitForResponse((r) => r.url().includes("/release") && r.request().method() === "POST", { timeout: 15000 });
      await modal.getByRole("button", { name: /解除を確定/ }).click();
      const relResp = await relRespP;
      console.log("[rel] keep release -> code:", JSON.parse(await relResp.text()).code);
      await page.waitForTimeout(1500);
      keepDone = true;
      uiConfirmed = true;
    } else {
      console.log("[rel] order5 无当前有效关系（此前已解除），跳过 UI keep 路径");
    }

    // order5 keep 效果 DB 验证
    const rel5After = await db.snapshot("a", "SELECT relation_id, delivery_valid, ended_reason, baseline_action, ended_by FROM prop_product_order_relation WHERE order_id=5 ORDER BY relation_id DESC");
    const prod1 = await db.snapshot("a", "SELECT first_shipment_date, lifecycle_base_month, baseline_shipment_id FROM prop_product WHERE product_id=1");
    console.log("[rel] order5 relations after:", JSON.stringify(rel5After.rows));
    console.log("[rel] product 111 baseline after keep-release:", JSON.stringify(prod1.rows));

    // ---- 2. API：缺 baselineAction 拒绝（BR-024）----
    if (relKw1.rows.length) {
      const relId = Number(relKw1.rows[0].relation_id);
      const noAction = await api("POST", `/prop/order/${kw1}/relations/${relId}/release`, {});
      console.log("[rel] API release w/o baselineAction -> code:", noAction.body.code, "msg:", noAction.body.msg);
      // ---- 3. clear 路径（BR-026）----
      const prod7Before = await db.snapshot("b", "SELECT first_shipment_date, lifecycle_base_month, baseline_shipment_id FROM prop_product WHERE product_id=7");
      const cleared = await api("POST", `/prop/order/${kw1}/relations/${relId}/release`, { baselineAction: "clear" });
      console.log("[rel] API release clear -> code:", cleared.body.code, "msg:", cleared.body.msg);
      const prod7After = await db.snapshot("a", "SELECT first_shipment_date, lifecycle_base_month, baseline_shipment_id FROM prop_product WHERE product_id=7");
      const relKw1After = await db.snapshot("a", "SELECT delivery_valid, ended_reason, baseline_action FROM prop_product_order_relation WHERE relation_id=?", [relId]);
      console.log("[rel] product AUTO-J002 baseline before:", JSON.stringify(prod7Before.rows), "after clear:", JSON.stringify(prod7After.rows));
      console.log("[rel] relation after clear:", JSON.stringify(relKw1After.rows));
      // ---- 4. 重复解除（BR-025 已结束→4601）----
      const again = await api("POST", `/prop/order/${kw1}/relations/${relId}/release`, { baselineAction: "keep" });
      console.log("[rel] repeat release -> code:", again.body.code, "msg:", again.body.msg);
      // ---- 5. 解除后履约回退（REQ-042/045：KW1 回到未出货）----
      const kw1Detail = await api("GET", `/prop/order/${kw1}`);
      console.log("[rel] KW1 after release: fulfilled:", kw1Detail.body.data?.fulfilledQuantity, "remaining:", kw1Detail.body.data?.remainingQuantity);
    } else {
      console.log("[rel] KW1 无当前有效关系，跳过 clear 路径");
    }

    console.log("---- VERDICT ----");
    if (uiConfirmed) {
      console.log(!noReasonOption ? "INFO REQ-047：解除弹窗仅「基準月を保持/クリア」两项，无「不要求选择原因」类选项。" : "CHECK REQ-047：存在免选选项？");
      console.log(frontendBlocked
        ? "冲突确认 REQ-047(P2)：不选基准处理直接确定被前端拦截（基準を保持するかクリアするかを選択する。）且不发请求——代码强制必选，Spec 口径为「不要求选择原因」且无基准处理选项定义。"
        : "CHECK REQ-047 前端拦截未生效");
      console.log(keepDone ? "PASS 解除(keep)主流程：UI 确认成功。" : "CHECK keep 解除未执行");
    }
    const keepRel = rel5After.rows[0] as any;
    if (keepRel) {
      console.log(Number(keepRel.delivery_valid) === 0 && keepRel.ended_reason === "unlink"
        ? `PASS BR-026(keep)：关系结束 delivery_valid=0/ended_reason=unlink/baseline_action=${keepRel.baseline_action}。`
        : `CHECK keep 关系状态：${JSON.stringify(keepRel)}`);
      console.log(prod1.rows[0] && (prod1.rows[0] as any).first_shipment_date
        ? "PASS BR-026(keep)：产品 111 首次出货日/基准月保留。"
        : "CHECK keep 后产品基准被清除？");
    }
    console.log(api500.length ? `API-5xx 巡检命中：${api500.join(" ; ")}` : "API-5xx 巡检：解除关联方向无 5xx。");
  } finally {
    const tracePath = await closeSession(session, "verify-order-relation");
    console.log("[relation] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[relation] FAILED:", e.message); process.exit(1); });
