/**
 * 订单管理·寄送全流程运行时验证
 * 来源：用例 发货管理章节（含高风险 发货管理-017 auto/explicit 无产品口径）、REQ-049~056；BR-027~048
 * 方法：真实 UI 走寄送抽屉全流程 + API 捕获 + DB 快照对比
 * 对象订单：KW1(AUTO-CO-001, qty 2, remaining 2)；合格产品 AUTO-J002(首检通过/无关系)
 * 反向样本：AUTO-J001(首检未过)、111(已有关系)、AUTO-J101(已删除)、AUTO-NONE(不存在)
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-order-shipment" });
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
    const kw1 = Number((await db.snapshot("id", "SELECT order_id FROM prop_order WHERE customer_order_no='AUTO-CO-001'")).rows[0].order_id);
    console.log("[ship] KW1 orderId:", kw1);

    // ---- 清理：删除 KW1 下全部准备中寄送（历史运行遗留，释放产品占用 BR-037）----
    const stalePreps = await db.snapshot("c", "SELECT shipment_id, revision FROM prop_shipment s WHERE s.order_id=? AND s.status='preparing' AND s.deleted_time IS NULL", [kw1]);
    for (const row of stalePreps.rows as any[]) {
      const del = await api("DELETE", `/prop/shipment/${row.shipment_id}?revision=${row.revision}`);
      console.log("[cleanup] delete empty preparing shipment", row.shipment_id, "-> code:", del.body.code);
    }

    // ---- 0. 幂等：若已有本脚本创建的已寄出寄送则跳过主流程 ----
    const doneBefore = await db.snapshot("chk", "SELECT s.shipment_id FROM prop_shipment s JOIN prop_shipment_product sp ON sp.shipment_id=s.shipment_id WHERE s.order_id=? AND s.status='shipped' AND sp.manufacturing_no='AUTO-J002' AND s.deleted_time IS NULL", [kw1]);

    let shipmentId: number | null = null;
    if (!doneBefore.rows.length) {
      // ---- 1. 详情页打开寄送抽屉并创建准备（BR-027/028/029/030）----
      await page.goto(`/orders/${kw1}`);
      await page.waitForTimeout(1500);
      const createRespP = page.waitForResponse((r) => r.url().includes(`/prop/order/${kw1}/shipments`) && r.request().method() === "POST", { timeout: 15000 });
      await page.locator("button", { hasText: /出\s*荷/ }).first().click();
      const drawer = page.locator(".prop-shipment-drawer");
      console.log("[ship] drawer open:", await drawer.isVisible());
      // 单一商品名时抽屉自动采用并自动创建准备（ShipmentDrawer.show:609）
      const createResp = await createRespP;
      const createBody = JSON.parse(await createResp.text());
      console.log("[ship] create(auto, adoptedName=一命多助) code:", createBody.code, "msg:", createBody.msg);
      await page.waitForTimeout(1800);
      const sh = await db.snapshot("s", "SELECT shipment_id, shipment_no, generated_no, status, create_request_id FROM prop_shipment WHERE order_id=? AND deleted_time IS NULL ORDER BY shipment_id DESC", [kw1]);
      shipmentId = Number(sh.rows[0]?.shipment_id);
      console.log("[ship] DB shipment:", JSON.stringify(sh.rows));

      // ---- 2. 发货管理-017a：auto 自动保存允许无产品（BR-031）----
      const autoSaveP = page.waitForResponse((r) => /\/prop\/shipment\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT", { timeout: 15000 });
      await drawer.locator('input[type="date"]').first().fill("2026-10-27");
      const autoSaveResp = await autoSaveP;
      const autoSaveBody = JSON.parse(await autoSaveResp.text());
      console.log("[017] auto save (0 products) -> code:", autoSaveBody.code, "msg:", autoSaveBody.msg);
      await page.waitForTimeout(800);
      const autosavedTag = await drawer.innerText();
      console.log("[017] autosaved hint shown:", autosavedTag.includes("自動保存済"));

      // ---- 3. 发货管理-017b：explicit 保存无产品被拒（BR-031）----
      let explicitReq = false;
      const expListener = (req: { url: () => string; method: () => string }) => { if (/\/prop\/shipment\/\d+$/.test(new URL(req.url()).pathname) && req.method() === "PUT") explicitReq = true; };
      page.on("request", expListener);
      await drawer.locator(".footer button", { hasText: /保\s*存/ }).click();
      await page.waitForTimeout(1200);
      page.off("request", expListener);
      const expMsg = await page.locator(".ant-message").innerText().catch(() => "");
      console.log("[017] explicit save (0 products): request sent:", explicitReq, "| message:", JSON.stringify(expMsg));
      console.log("[017] drawer still open after reject:", await drawer.isVisible());
      // 服务端复核：绕过前端直接 API explicit 保存
      const rev0 = await db.snapshot("r", "SELECT revision FROM prop_shipment WHERE shipment_id=?", [shipmentId]);
      const apiExplicit = await api("PUT", `/prop/shipment/${shipmentId}`, { revision: rev0.rows[0].revision, fields: ["boxCount"], boxCount: 1, saveMode: "explicit" });
      console.log("[017] server explicit save (0 products) -> code:", apiExplicit.body.code, "msg:", apiExplicit.body.msg);

      // ---- 4. 切换单件录入，添加产品（BR-035/036/037）----
      await drawer.locator(".ant-radio-button-wrapper", { hasText: "1件ずつ登録" }).click();
      const scanInput = drawer.getByPlaceholder("製造番号を読み取るか入力して、Enterキーで追加");
      const addOne = async (no: string) => {
        const p = page.waitForResponse((r) => /\/prop\/shipment\/\d+\/products$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 15000 }).catch(() => null);
        await scanInput.fill(no);
        await scanInput.press("Enter");
        const r = await p;
        if (r) { const b = JSON.parse(await r.text()); console.log(`[prod] add ${no} -> code:${b.code} msg:${b.msg ?? ""}`); }
        await page.waitForTimeout(700);
        const alerts = await drawer.locator(".ant-alert-warning").allInnerTexts();
        if (alerts.length) console.log(`[prod] ${no} failure alert:`, JSON.stringify(alerts));
      };
      await addOne("AUTO-J002");   // 合格
      await addOne("AUTO-J001");   // 首检未过 → 失败原因
      await addOne("111");         // 已有关系 → 失败
      await addOne("AUTO-J101");   // 已删除 → 失败
      await addOne("AUTO-NONE");   // 不存在 → 失败
      const failAlerts = await drawer.locator(".ant-alert-warning").allInnerTexts();
      console.log("[prod] failure alerts:", JSON.stringify(failAlerts));
      const prodRows = await drawer.locator(".ant-table-tbody tr").allInnerTexts();
      console.log("[prod] products table rows:", prodRows.length, JSON.stringify(prodRows).slice(0, 300));

      // ---- 5. BR-002：准备中寄送产品可被制造番号反查 ----
      const mnoCheck = await api("GET", "/prop/order/list?pageNum=1&pageSize=10&manufacturingNo=AUTO-J002");
      const mnoNos = (mnoCheck.body.rows || []).map((r: any) => r.orderNo);
      console.log("[mno] preparing product AUTO-J002 search ->", mnoNos.join(","));

      // ---- 6. 物流字段（BR-032/034）----
      await drawer.locator(".ant-select", { hasText: "配送業者を選択" }).first().click().catch(async () => {
        await drawer.locator(".panel", { hasText: "配送業者・発送設定" }).locator(".ant-select").click();
      });
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "ヤマト運輸" }).first().click();
      await page.waitForTimeout(900);
      const boxInput = drawer.locator(".ant-form-item", { hasText: "箱数" }).locator("input");
      await boxInput.fill("2");
      await boxInput.press("Enter");
      await page.waitForTimeout(900);
      const shipRow = await db.snapshot("s", "SELECT carrier, ship_date, box_count FROM prop_shipment WHERE shipment_id=?", [shipmentId]);
      console.log("[ship] fields saved:", JSON.stringify(shipRow.rows));

      // ---- 7. 生成面单（BR-045/046/047）----
      await drawer.locator("button", { hasText: /送り状を生成/ }).click();
      await page.waitForTimeout(1200);
      const docModal = page.locator(".ant-modal", { hasText: "発送書類の生成" });
      console.log("[doc] modal open:", await docModal.isVisible().catch(() => false));
      const genRespP = page.waitForResponse((r) => /\/documents$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 20000 }).catch(() => null);
      await docModal.getByRole("button", { name: /生\s*成/ }).click();
      const genResp = await genRespP;
      if (genResp) console.log("[doc] generate -> status:", genResp.status());
      await page.waitForTimeout(2500);
      const files = await db.snapshot("f", "SELECT file_type, version, template_version FROM prop_shipment_file WHERE shipment_id=? ORDER BY file_id", [shipmentId]);
      console.log("[doc] files:", JSON.stringify(files.rows));
      await docModal.getByRole("button", { name: /閉じる|戻る|キャンセル/ }).first().click().catch(() => page.keyboard.press("Escape"));
      await page.waitForTimeout(600);

      // ---- 8. 确认寄出（BR-040/041/042/043）----
      const prodBefore = await db.snapshot("p", "SELECT first_shipment_date, lifecycle_base_month, baseline_shipment_id FROM prop_product WHERE manufacturing_no='AUTO-J002'");
      await drawer.locator(".footer button", { hasText: /発送を確定/ }).click();
      await page.waitForTimeout(800);
      const confirmModal = page.locator(".ant-modal", { hasText: "送り状ナンバーを追加して発送を確定" });
      await confirmModal.getByRole("button", { name: "送り状ナンバーを追加" }).click();
      await confirmModal.locator(".tracking-row input").first().fill("AUTO-TRK-001");
      const confirmRespP = page.waitForResponse((r) => r.url().includes("/confirm") && r.request().method() === "POST", { timeout: 20000 });
      await confirmModal.getByRole("button", { name: /発送を確定してメールを生成/ }).click();
      const confirmResp = await confirmRespP;
      const confirmBody = JSON.parse(await confirmResp.text());
      console.log("[confirm] code:", confirmBody.code, "msg:", confirmBody.msg);
      await page.waitForTimeout(2000);
      const after = await db.snapshot("a", "SELECT status, carrier, tracking_numbers, confirmed_by, confirmed_time FROM prop_shipment WHERE shipment_id=?", [shipmentId]);
      const rel = await db.snapshot("a", "SELECT relation_id, product_id, delivery_valid FROM prop_product_order_relation WHERE shipment_id=?", [shipmentId]);
      const prodAfter = await db.snapshot("a", "SELECT first_shipment_date, lifecycle_base_month, baseline_shipment_id FROM prop_product WHERE manufacturing_no='AUTO-J002'");
      const mail = await db.snapshot("a", "SELECT file_type, version FROM prop_shipment_file WHERE shipment_id=? AND file_type='mail'", [shipmentId]);
      console.log("[confirm] shipment:", JSON.stringify(after.rows));
      console.log("[confirm] relation:", JSON.stringify(rel.rows));
      console.log("[confirm] product baseline before:", JSON.stringify(prodBefore.rows), "after:", JSON.stringify(prodAfter.rows));
      console.log("[confirm] mail v1:", JSON.stringify(mail.rows));

      // ---- 9. 确认幂等（BR-041）----
      const cur = await db.snapshot("r", "SELECT revision FROM prop_shipment WHERE shipment_id=?", [shipmentId]);
      const reconfirm = await api("POST", `/prop/shipment/${shipmentId}/confirm`, { revision: cur.rows[0].revision, trackingNumbers: ["AUTO-TRK-001"] });
      console.log("[confirm] repeat confirm -> code:", reconfirm.body.code, "msg:", reconfirm.body.msg);
    } else {
      shipmentId = Number(doneBefore.rows[0].shipment_id);
      console.log("[ship] 主流程已完成过（幂等跳过），shipmentId:", shipmentId);
    }

    // ---- 10. BR-029：已发足订单拒建寄送（order5 remaining=0）----
    const o5 = await api("GET", "/prop/order/5");
    const shipFull = await api("POST", "/prop/order/5/shipments", { requestId: crypto.randomUUID(), revision: o5.body.data?.revision ?? 1, adoptedProductName: "一命多助", shipDate: "2026-10-26" });
    console.log("[full] create shipment on fulfilled order5 -> code:", shipFull.body.code, "msg:", shipFull.body.msg);
    await page.goto("/orders/5");
    await page.waitForTimeout(1200);
    const shipBtnCount = await page.locator("button", { hasText: /出\s*荷/ }).count();
    console.log("[full] order5 detail 出荷 button count:", shipBtnCount);

    // ---- 11. 已寄出维护（BR-031/033/034）：改运单号重复拦截 + 改日期更正基准 ----
    const shippedId = shipmentId;
    if (shippedId) {
      const cur2 = await db.snapshot("r", "SELECT revision FROM prop_shipment WHERE shipment_id=?", [shippedId]);
      const dup = await api("PUT", `/prop/shipment/${shippedId}`, { revision: cur2.rows[0].revision, fields: ["trackingNumbers"], trackingNumbers: ["AUTO-TRK-001", "AUTO-TRK-001"], saveMode: "explicit" });
      console.log("[shipped] duplicate tracking -> code:", dup.body.code, "msg:", dup.body.msg);
      const cur3 = await db.snapshot("r", "SELECT revision, ship_date FROM prop_shipment WHERE shipment_id=?", [shippedId]);
      const newDate = "2026-10-26";
      const changeDate = await api("PUT", `/prop/shipment/${shippedId}`, { revision: cur3.rows[0].revision, fields: ["shipDate"], shipDate: newDate, saveMode: "explicit" });
      console.log("[shipped] change shipDate -> code:", changeDate.body.code, "msg:", changeDate.body.msg, "| old:", cur3.rows[0].ship_date);
      const baseAfter = await db.snapshot("b", "SELECT first_shipment_date, lifecycle_base_month FROM prop_product WHERE manufacturing_no='AUTO-J002'");
      console.log("[shipped] product baseline after date change:", JSON.stringify(baseAfter.rows));
    }

    console.log("---- VERDICT ----");
    console.log(api500.length ? `API-5xx 巡检命中：${api500.join(" ; ")}` : "API-5xx 巡检：寄送方向无 5xx。");
  } finally {
    const tracePath = await closeSession(session, "verify-order-shipment");
    console.log("[shipment] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[shipment] FAILED:", e.message); process.exit(1); });
