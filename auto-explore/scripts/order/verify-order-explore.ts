/**
 * 订单管理·自主探索与批量打印方向运行时验证
 * 覆盖：非法ID/注入/枚举与日期非法（BR-004/007）、地址归属409（BR-011，用例 新建订单-006 异常）、
 *      禁用字典复核（BR-012，用例-010）、数量分类报错（BR-014，用例-012）、服务端 explicit 无产品复核（发货管理-017）、
 *      批量打印 REQ-103（候选/勾选/张数钳制/汇总/生成回写）+ 订打补充-012（超长省略+tooltip）
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-order-explore" });
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
    const baseOrder = {
      customerOrderNo: null, orderDate: "2026-10-26", expectedShipDate: null,
      orderType: "sale", customerType: "direct",
      orderingParty: { mode: "select", id: 1 }, recipient: { mode: "select", id: 1 }, billingParty: { mode: "select", id: 1 },
      deliveryAddress: { mode: "select", id: 1 }, deliveryContact: { mode: "select", id: 1 },
      productNameId: 2, lines: [{ productNameId: 2, productName: "一命多助", colorNote: "AUTO-规则矩阵", quantity: 1 }], remark: null,
    };

    // ---- 1. 非法订单 ID 详情（BR-007 + 前端 404）----
    await page.goto("/orders/999999");
    await page.waitForSelector(".ant-result, .ant-alert, .detail-head", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    const notFound = await page.locator(".detail-page").innerText().catch(() => "");
    console.log("[explore] /orders/999999 shows missing:", notFound.includes("注文が見つからない"), "| head:", notFound.slice(0, 120).replace(/\n/g, " | "));
    const nfApi = await api("GET", "/prop/order/999999");
    console.log("[explore] GET order 999999 -> code:", nfApi.body.code, "msg:", nfApi.body.msg);

    // ---- 2. 注入式关键词（安全性巡检）----
    const inj1 = await api("GET", "/prop/order/list?pageNum=1&pageSize=10&keyword=' OR 1=1 --");
    const inj2 = await api("GET", "/prop/order/list?pageNum=1&pageSize=10&keyword=<script>alert(1)</script>");
    console.log("[explore] inject SQL -> code:", inj1.body.code, "total:", inj1.body.total, "| XSS -> code:", inj2.body.code, "total:", inj2.body.total);

    // ---- 3. 非法枚举/日期（BR-004）----
    const badEnum = await api("GET", "/prop/order/list?pageNum=1&pageSize=10&orderType=foo");
    console.log("[explore] orderType=foo -> code:", badEnum.body.code, "msg:", badEnum.body.msg);
    const badDate = await api("GET", "/prop/order/list?orderDateFrom=2026-10-31&orderDateTo=2026-10-01");
    console.log("[explore] orderDateFrom>To -> code:", badDate.body.code, "msg:", badDate.body.msg);

    // ---- 4. 地址归属校验（BR-011，用例 新建订单-006 异常）----
    const mismatch = await api("POST", "/prop/order", { ...baseOrder, requestId: crypto.randomUUID(), deliveryAddress: { mode: "select", id: 2 } });
    console.log("[explore] address not of recipient -> code:", mismatch.body.code, "msg:", mismatch.body.msg);

    // ---- 5. 禁用字典项复核（BR-012，用例 新建订单-010 服务端侧）----
    const disabledDict = await api("POST", "/prop/order", { ...baseOrder, requestId: crypto.randomUUID(), productNameId: 1, lines: [{ productNameId: 1, productName: "1", colorNote: "x", quantity: 1 }] });
    console.log("[explore] disabled productNameId=1 -> code:", disabledDict.body.code, "msg:", disabledDict.body.msg);

    // ---- 6. 数量分类报错（BR-014，用例 新建订单-012）----
    const qtyText = await api("POST", "/prop/order", { ...baseOrder, requestId: crypto.randomUUID(), lines: [{ productNameId: 2, productName: "一命多助", colorNote: "x", quantity: "abc" }] });
    const qtyDecimal = await api("POST", "/prop/order", { ...baseOrder, requestId: crypto.randomUUID(), lines: [{ productNameId: 2, productName: "一命多助", colorNote: "x", quantity: 1.5 }] });
    const qtyZero = await api("POST", "/prop/order", { ...baseOrder, requestId: crypto.randomUUID(), lines: [{ productNameId: 2, productName: "一命多助", colorNote: "x", quantity: 0 }] });
    console.log("[explore] qty abc ->", qtyText.body.code, qtyText.body.msg);
    console.log("[explore] qty 1.5 ->", qtyDecimal.body.code, qtyDecimal.body.msg);
    console.log("[explore] qty 0 ->", qtyZero.body.code, qtyZero.body.msg);

    // ---- 7. 服务端 explicit 保存无产品复核（发货管理-017 服务端口径，BR-031）----
    const kw1 = Number((await db.snapshot("id", "SELECT order_id FROM prop_order WHERE customer_order_no='AUTO-CO-001'")).rows[0].order_id);
    const kw1Detail = await api("GET", `/prop/order/${kw1}`);
    const prep = await api("POST", `/prop/order/${kw1}/shipments`, { requestId: crypto.randomUUID(), orderRevision: kw1Detail.body.data.revision, adoptedProductName: "一命多助", shipDate: "2026-10-26" });
    const prepId = prep.body.data?.shipmentId ?? prep.body.data;
    console.log("[explore] create preparation -> code:", prep.body.code, "shipmentId:", JSON.stringify(prepId));
    const prepIdNum = typeof prepId === "object" ? Number(prepId?.shipmentId) : Number(prepId);
    const prepRow = await db.snapshot("p", "SELECT revision FROM prop_shipment WHERE shipment_id=?", [prepIdNum]);
    const explicitEmpty = await api("PUT", `/prop/shipment/${prepIdNum}`, { revision: prepRow.rows[0].revision, fields: ["boxCount"], boxCount: 1, saveMode: "explicit" });
    console.log("[explore] server explicit save 0 products -> code:", explicitEmpty.body.code, "msg:", explicitEmpty.body.msg);
    const autoEmpty = await api("PUT", `/prop/shipment/${prepIdNum}`, { revision: (await db.snapshot("p", "SELECT revision FROM prop_shipment WHERE shipment_id=?", [prepIdNum])).rows[0].revision, fields: ["boxCount"], boxCount: 1, saveMode: "auto" });
    console.log("[explore] server auto save 0 products -> code:", autoEmpty.body.code, "msg:", autoEmpty.body.msg);
    // 加入合格产品（批量生成要求清单非空 BR-045）
    const prepRev2 = (await db.snapshot("p", "SELECT revision FROM prop_shipment WHERE shipment_id=?", [prepIdNum])).rows[0].revision;
    const addProd = await api("POST", `/prop/shipment/${prepIdNum}/products`, { revision: prepRev2, manufacturingNo: "AUTO-J002" });
    console.log("[explore] add AUTO-J002 -> code:", addProd.body.code, "data:", JSON.stringify(addProd.body.data ?? null));
    const prepProdCnt = await db.snapshot("p", "SELECT COUNT(*) c FROM prop_shipment_product WHERE shipment_id=?", [prepIdNum]);
    console.log("[explore] preparation products count:", prepProdCnt.rows[0].c);

    const prepNo = String((await db.snapshot("p", "SELECT shipment_no FROM prop_shipment WHERE shipment_id=?", [prepIdNum])).rows[0]?.shipment_no || "");
    console.log("[explore] current preparation no:", prepNo);
    // ---- 8. 批量打印页（REQ-103 + 订打补充-012/016/017/018/025）----
    await page.goto("/orders/batch-print");
    await page.waitForSelector(".batch-page", { timeout: 20000 });
    await page.waitForTimeout(1200);
    const batchText = await page.locator(".batch-page").innerText();
    console.log("[batch] page loaded, has carrier select:", batchText.includes("配送業者"), "| summary:", batchText.includes("選択"));
    const candRows = await page.locator(".ant-table-tbody tr.ant-table-row").allInnerTexts();
    console.log("[batch] candidate rows:", candRows.length, JSON.stringify(candRows).slice(0, 400));
    // 生成按钮未勾选不可用（订打补充-025）
    const genBtn = page.locator(".batch-footer button", { hasText: /送り状を生成/ });
    console.log("[batch] generate disabled w/o selection:", await genBtn.isDisabled());
    // 勾选候选行
    if (candRows.length) {
      const targetRow = page.locator(".ant-table-tbody tr.ant-table-row", { hasText: prepNo });
      await targetRow.locator(".ant-checkbox-wrapper").click();
      await page.waitForTimeout(600);
      console.log("[batch] generate enabled after select:", !(await genBtn.isDisabled()));
      // 张数钳制 1-99（订打补充-017/018/019）
      const copiesInput = page.locator(".ant-table-tbody tr.ant-table-row", { hasText: prepNo }).locator(".ant-input-number input");
      await copiesInput.fill("120");
      await copiesInput.press("Enter");
      await page.waitForTimeout(400);
      const clamped = await copiesInput.inputValue();
      console.log("[batch] copies input 120 -> clamped:", clamped);
      await copiesInput.fill("2");
      await copiesInput.press("Enter");
      // 汇总栏（订打补充-021）
      const footer = await page.locator(".batch-footer").innerText();
      console.log("[batch] footer summary:", footer.replace(/\n/g, " | "));
      // 选快递公司并生成（REQ-103 主流程）
      await page.locator(".carrier-select").click();
      await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "ヤマト運輸" }).first().click();
      const prepareP = page.waitForResponse((r) => r.url().includes("/batch-labels/prepare") && r.request().method() === "POST", { timeout: 20000 }).catch(() => null);
      await genBtn.click();
      const prepareResp = await prepareP;
      console.log("[batch] prepare -> status:", prepareResp?.status());
      await page.waitForTimeout(1500);
      const docModal2 = page.locator(".ant-modal", { hasText: "発送書類の生成" });
      console.log("[batch] doc modal open:", await docModal2.isVisible().catch(() => false));
      const genBtn2 = docModal2.getByRole("button", { name: /生\s*成/ });
      const enabled = await genBtn2.isEnabled({ timeout: 30000 }).catch(() => false);
      if (!enabled) {
        console.log("[batch] generate button stayed disabled; modal text:", (await docModal2.innerText()).slice(0, 500).replace(/\n/g, " | "));
      }
      const createP = page.waitForResponse((r) => /\/batch-labels$/.test(new URL(r.url()).pathname) && r.request().method() === "POST", { timeout: 20000 }).catch(() => null);
      if (enabled) await genBtn2.click();
      const createResp = await createP;
      if (createResp) console.log("[batch] batchCreate -> status:", createResp.status(), "body:", (await createResp.text()).slice(0, 200));
      await page.waitForTimeout(2500);
      await docModal2.getByRole("button", { name: /閉じる/ }).first().click().catch(() => page.keyboard.press("Escape"));
      await page.waitForTimeout(600);
      const filesNow = await db.snapshot("f", "SELECT file_type, version, batch_request_manifest IS NULL manifest_null FROM prop_shipment_file WHERE shipment_id=?", [prepIdNum]);
      const shipNow = await db.snapshot("f", "SELECT carrier, status FROM prop_shipment WHERE shipment_id=?", [prepIdNum]);
      console.log("[batch] files after batch:", JSON.stringify(filesNow.rows), "| shipment:", JSON.stringify(shipNow.rows));
    }
    // 订打补充-012：产品摘要超长省略（ellipsis + tooltip）
    const ellipsis = await page.locator(".ant-table-tbody .ellipsis").first();
    const hasEllipsis = await ellipsis.count();
    console.log("[batch] products ellipsis cell exists:", hasEllipsis > 0);

    // ---- 9. 清理：删除 KW1 全部准备中寄送（BR-039 级联删除随验）----
    const allPrep = await db.snapshot("p", "SELECT shipment_id, revision FROM prop_shipment WHERE order_id=? AND status='preparing' AND deleted_time IS NULL", [kw1]);
    for (const row of allPrep.rows as any[]) {
      const filesBefore = await db.snapshot("f", "SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?", [row.shipment_id]);
      const del = await api("DELETE", `/prop/shipment/${row.shipment_id}?revision=${row.revision}`);
      const filesAfter = await db.snapshot("f", "SELECT COUNT(*) c FROM prop_shipment_file WHERE shipment_id=?", [row.shipment_id]);
      const delRow = await db.snapshot("f", "SELECT deleted_time FROM prop_shipment WHERE shipment_id=?", [row.shipment_id]);
      console.log(`[cleanup] delete preparation ${row.shipment_id} -> code:${del.body.code} files:${filesBefore.rows[0].c}->${filesAfter.rows[0].c} deleted:${!!(delRow.rows[0] as any)?.deleted_time}`);
    }

    console.log("---- VERDICT ----");
    console.log(notFound.includes("注文が見つからない") && nfApi.body.code !== 200 ? "PASS BR-007：非法订单 ID 接口 404 + 前端 missing 页。" : `CHECK 非法ID处理：api=${nfApi.body.code} ui=${notFound.slice(0, 60)}`);
    console.log(inj1.body.total === 0 && inj2.body.total === 0 ? "PASS 安全巡检：注入式关键词 0 命中无异常。" : `CHECK 注入：${inj1.body.total}/${inj2.body.total}`);
    console.log(badEnum.body.code !== 200 ? `PASS BR-004：非法枚举被拒（${badEnum.body.msg}）。` : "CHECK 非法枚举被接受");
    console.log(badDate.body.code !== 200 ? `PASS BR-004：日期起>止被拒（${badDate.body.msg}）。` : "CHECK 日期倒置被接受");
    console.log(mismatch.body.code === 409 ? `PASS BR-011：地址不属納品先被拒（${mismatch.body.msg}）。` : `CHECK 地址归属：code=${mismatch.body.code} ${mismatch.body.msg}`);
    console.log(disabledDict.body.code !== 200 ? `PASS BR-012：禁用字典项服务端复核拒绝（${disabledDict.body.msg}）。` : "CHECK 禁用字典被接受");
    console.log(qtyText.body.code !== 200 && qtyDecimal.body.code !== 200 && qtyZero.body.code !== 200 ? "PASS BR-014：非数字/小数/0 数量分类拒绝。" : `CHECK 数量：${qtyText.body.code}/${qtyDecimal.body.code}/${qtyZero.body.code}`);
    console.log(explicitEmpty.body.code !== 200 ? `PASS 发货管理-017(服务端)：explicit 保存无产品被拒（${explicitEmpty.body.msg}）。` : "CHECK 服务端 explicit 无产品被接受");
    console.log(autoEmpty.body.code === 200 ? "PASS 发货管理-017(服务端)：auto 保存允许无产品。" : `CHECK 服务端 auto 无产品被拒：${autoEmpty.body.msg}`);
    console.log(api500.length ? `API-5xx 巡检命中：${api500.join(" ; ")}` : "API-5xx 巡检：探索方向无 5xx。");
  } finally {
    const tracePath = await closeSession(session, "verify-order-explore");
    console.log("[explore] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[explore] FAILED:", e.message); process.exit(1); });
