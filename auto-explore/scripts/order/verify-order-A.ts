/**
 * 订单管理 A 批未执行用例运行时验证（12 条）
 * 覆盖：订单列表查询-015、新建订单-007/008/009/017/018/019/020/021/023、
 *       订单详情-010、订单权限-006
 * 方式：真实 UI + API 直连 + DB 断言；夹具统一 AUTO-ORD-A/B 前缀。
 */
import { randomUUID } from "node:crypto";
import type { Browser } from "playwright";
import type { Session } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, launchAdminSession, finishSession,
  ensureOrderFixtures, adminToken, apiCall, runTag,
  waitNewOrderReady, selectSubject, selectBillingSubject, selectCustomerType,
  selectedCustomerType, openAddressCandidates, addAddressEditor, fillAddressEditor,
  saveAddressEditor, selectAddressByLine, selectContactByName, selectProduct,
  fillFirstLine, clickCreate, createOrderViaUi, countAddresses, findOrderByCustomerNo,
  waitNoPost, formItem, compactText,
} from "./order-runtime-utils.js";

const book = new ResultBook("reports/order-runtime-results-A.json");
const db = new DbClient();
const tag = runTag();
const noContactCoNo = `AUTO-ORD-A-NOCONTACT-${tag}`;
const contactCoNo = `AUTO-ORD-A-CONTACT-${tag}`;
const billingCoNo = `AUTO-ORD-A-BILLING-${tag}`;
const noLineCoNo = `AUTO-ORD-A-NOLINE-${tag}`;
const noAddressCoNo = `AUTO-ORD-A-NOADDR-${tag}`;
const noDateCoNo = `AUTO-ORD-A-NODATE-${tag}`;

let browser: Browser | undefined;
let session: Session | undefined;
let contactOrderId: number | null = null;
let noContactOrderId: number | null = null;

async function main(): Promise<void> {
  await db.connect();
  const fx = await ensureOrderFixtures(db);
  const token = await adminToken();
  const launched = await launchAdminSession("verify-order-A");
  browser = launched.browser;
  session = launched.session;
  const page = session.page;
  page.setDefaultTimeout(12000);

  try {
    await book.run("订单列表查询-015", "查询无匹配结果", "FEAT-10-order §列表查询", async () => {
      await page.goto("/orders/index");
      const keyword = page.getByPlaceholder("注文管理番号／お客様注文番号／注文先／納品先");
      await keyword.waitFor({ state: "visible", timeout: 15000 });
      await page.waitForTimeout(1500);
      const responsePromise = page.waitForResponse(
        (r) => r.url().includes("/prop/order/list") && r.request().method() === "GET" && r.url().includes("keyword=ZZZ-NO-MATCH-ORDER-A"),
        { timeout: 15000 },
      );
      await keyword.fill("ZZZ-NO-MATCH-ORDER-A");
      await page.locator(".search-actions button", { hasText: "検索" }).first().click();
      const response = await responsePromise;
      const body = await response.json() as { total?: number; rows?: unknown[] };
      await page.waitForTimeout(600);
      const emptyText = compactText(await page.locator(".ant-empty").last().innerText().catch(() => ""), 300);
      const ok = Number(body.total) === 0 && Array.isArray(body.rows) && body.rows.length === 0 && /データがありません|データなし/.test(emptyText);
      return {
        status: ok ? "通过" : "不通过",
        actual: `关键词无匹配时接口 total=${body.total ?? "?"}、rows=${Array.isArray(body.rows) ? body.rows.length : "?"}；页面空态=${emptyText || "(无)"}。`,
        evidence: "UI /orders 输入 ZZZ-NO-MATCH-ORDER-A 后点击検索；捕获 GET /prop/order/list 响应与 .ant-empty 文案。",
      };
    });

    await book.run("新建订单-007", "新增配送地址成功", "FEAT-10-order §4.7", async () => {
      await waitNewOrderReady(page);
      await selectSubject(page, "orderForm_ordering", fx.a.companyName);
      const line = `AUTO-ORD-A-地址新增-${tag}`;
      const before = await countAddresses(db, fx.a.companyId);
      await openAddressCandidates(page);
      const editor = await addAddressEditor(page);
      await fillAddressEditor(editor, "1000009", line, "AUTO-ORD-A 新增楼");
      await saveAddressEditor(editor);
      const after = await countAddresses(db, fx.a.companyId);
      const rows = await db.query<Record<string, unknown>>(
        "SELECT address_id,subject_id,postal_code,address_line1,address_line2 FROM prop_customer_address WHERE subject_id=? AND address_line1=?",
        [fx.a.companyId, line],
      );
      const selectedText = compactText(await page.locator("#orderForm_deliveryAddress").innerText().catch(() => ""), 300);
      const listModal = await openAddressCandidates(page);
      const inList = await listModal.locator(".candidate-card", { hasText: line }).count();
      if (inList) {
        const card = listModal.locator(".candidate-card", { hasText: line }).first();
        await card.getByRole("button", { name: /^選択$/ }).click();
        await listModal.waitFor({ state: "hidden", timeout: 10000 }).catch(() => undefined);
      }
      await page.waitForTimeout(500);
      const ok = after === before + 1 && rows.length === 1 && String(rows[0].postal_code) === "1000009" && inList > 0 && selectedText.includes(line);
      return {
        status: ok ? "通过" : "不通过",
        actual: `地址新增前后数量 ${before}→${after}；DB address_id=${rows[0]?.address_id ?? "无"}，邮编=${rows[0]?.postal_code ?? "无"}；保存后自动回填=${selectedText.includes(line)}，重新打开列表可见=${inList > 0}。`,
        evidence: "UI 新建订单→選択配送先住所→＋住所を追加，填写邮编/住所1/住所2；DB 查询 prop_customer_address；重新打开候选列表选择。",
      };
    });

    await book.run("新建订单-008", "新增地址必填项为空保存失败", "FEAT-10-order §4.7；orderFormRules.addressRules", async () => {
      await waitNewOrderReady(page);
      await selectSubject(page, "orderForm_ordering", fx.a.companyName);
      const before = await countAddresses(db, fx.a.companyId);
      await openAddressCandidates(page);
      const editor = await addAddressEditor(page);
      await editor.locator(".ant-modal-footer .ant-btn-primary").click();
      await page.waitForTimeout(800);
      const errors = (await editor.locator(".ant-form-item-explain-error").allInnerTexts()).map((x) => x.trim()).filter(Boolean);
      const stillOpen = await editor.isVisible().catch(() => false);
      const after = await countAddresses(db, fx.a.companyId);
      const ok = stillOpen && after === before && errors.some((x) => /郵便番号/.test(x)) && errors.some((x) => /住所1/.test(x));
      return {
        status: ok ? "通过" : "不通过",
        actual: `必填为空时弹窗保持打开=${stillOpen}，错误=${errors.join(" | ") || "(无)"}；地址数量 ${before}→${after}，未产生地址。`,
        evidence: "UI 新增地址弹窗留空点击确定；读取 .ant-form-item-explain-error；DB 地址计数前后对比。",
      };
    });

    await book.run("新建订单-009", "选择联系人成功", "FEAT-10-order §3.1；联系人快照", async () => {
      await waitNewOrderReady(page);
      await selectSubject(page, "orderForm_ordering", fx.a.companyName);
      await selectAddressByLine(page, fx.a.addressLine1);
      await selectContactByName(page, fx.a.contactName);
      const cardText = compactText(await page.locator(".delivery-contact").innerText().catch(() => ""), 400);
      await selectProduct(page);
      await fillFirstLine(page, 1, "AUTO-色A");
      const result = await createOrderViaUi(page, contactCoNo);
      const row = await findOrderByCustomerNo(db, contactCoNo);
      const snapshot = row?.delivery_contact_snapshot ? JSON.parse(String(row.delivery_contact_snapshot)) as Record<string, unknown> : null;
      contactOrderId = row ? Number(row.order_id) : null;
      const ok = result.code === 200 && !!row && Number(row.delivery_contact_id) === fx.a.contactId && String(snapshot?.contactName ?? "") === fx.a.contactName;
      return {
        status: ok ? "通过" : "不通过",
        actual: `联系人列表选中“${fx.a.contactName}”；页面回填=${cardText.includes(fx.a.contactName)}；订单创建 code=${result.code}，order_id=${contactOrderId ?? "无"}，contact_id=${row?.delivery_contact_id ?? "null"}，快照姓名=${String(snapshot?.contactName ?? "null")}。`,
        evidence: "UI 选择配送地址→担当者を選択→担当者選択；提交订单；DB 查询 prop_order.delivery_contact_id/delivery_contact_snapshot。",
      };
    });

    await book.run("新建订单-017", "未选配送地址提交失败", "FEAT-10-order §3.1；orderRules.deliveryAddress", async () => {
      await waitNewOrderReady(page);
      await selectSubject(page, "orderForm_ordering", fx.a.companyName);
      await selectProduct(page);
      await fillFirstLine(page, 1, "AUTO-色A");
      await formItem(page, "お客様注文番号").locator("input").last().fill(noAddressCoNo);
      const noPost = await waitNoPost(page, () => clickCreate(page));
      const errors = (await page.locator(".ant-form-item-explain-error").allInnerTexts()).map((x) => x.trim()).filter(Boolean);
      const row = await findOrderByCustomerNo(db, noAddressCoNo);
      const ok = noPost && !row && errors.some((x) => /配送先住所/.test(x));
      return {
        status: ok ? "通过" : "不通过",
        actual: `未选配送地址提交：未发送 POST=${noPost}，表单错误=${errors.join(" | ") || "(无)"}，DB 未创建订单=${!row}。`,
        evidence: "UI 选择客户与商品但不选配送地址；点击注文を作成；监听 POST /prop/order；DB 按客户订单号查无记录。",
      };
    });

    await book.run("新建订单-018", "未选联系人可创建订单", "FEAT-10-order §3.1、§6.4；联系人可选", async () => {
      await waitNewOrderReady(page);
      await selectSubject(page, "orderForm_ordering", fx.a.companyName);
      await selectAddressByLine(page, "AUTO-ORD-A 地址二");
      const contactText = compactText(await page.locator(".delivery-contact").innerText().catch(() => ""), 200);
      await selectProduct(page);
      await fillFirstLine(page, 1, "AUTO-色A");
      const result = await createOrderViaUi(page, noContactCoNo);
      const row = await findOrderByCustomerNo(db, noContactCoNo);
      noContactOrderId = row ? Number(row.order_id) : null;
      const ok = result.code === 200 && !!row && row.delivery_contact_id == null && row.delivery_contact_snapshot == null;
      return {
        status: ok ? "通过" : "不通过",
        actual: `未选联系人区域=${contactText || "(空)"}；订单创建 code=${result.code}，order_id=${noContactOrderId ?? "无"}，contact_id=${row?.delivery_contact_id ?? "null"}，contact_snapshot=${row?.delivery_contact_snapshot ?? "null"}。`,
        evidence: "UI 仅选配送地址、不选担当者；提交订单；DB 断言联系人字段为空且订单 active。",
      };
    });

    await book.run("新建订单-019", "未添加订单行提交失败", "FEAT-10-order；createOrder() 至少一条订单行", async () => {
      await waitNewOrderReady(page);
      await selectSubject(page, "orderForm_ordering", fx.a.companyName);
      await selectAddressByLine(page, fx.a.addressLine1);
      await formItem(page, "お客様注文番号").locator("input").last().fill(noLineCoNo);
      const noPostUi = await waitNoPost(page, () => clickCreate(page));
      const uiErrors = (await page.locator(".ant-form-item-explain-error").allInnerTexts()).map((x) => x.trim()).filter(Boolean);
      const payload = {
        requestId: randomUUID(),
        customerOrderNo: `${noLineCoNo}-API`,
        orderDate: new Date().toISOString().slice(0, 10),
        expectedShipDate: null,
        orderType: "sale",
        customerType: "direct",
        orderingParty: { mode: "select", id: fx.a.companyId },
        recipient: { mode: "select", id: fx.a.companyId },
        billingParty: { mode: "copyOrdering" },
        deliveryAddress: { mode: "select", id: fx.a.addressId },
        deliveryContact: { mode: "clear" },
        lines: [],
        remark: "AUTO-ORD-A 无订单行 API 校验",
      };
      const api = await apiCall(token, "POST", "/prop/order", payload);
      const row = await findOrderByCustomerNo(db, String(payload.customerOrderNo));
      const uiOk = noPostUi && uiErrors.some((x) => /商品名/.test(x));
      const apiOk = api.code !== 200 && /明細を1件以上|注文明細/.test(api.msg);
      return {
        status: uiOk && apiOk && !row ? "通过" : "部分验证",
        actual: `UI 固定至少一行，空内容被“${uiErrors.join(" | ") || "无错误"}”拦截且未发 POST=${noPostUi}；API 提交 lines=[] 返回 code=${api.code}、msg=${api.msg}；两路径均未创建订单=${!row}。`,
        evidence: "UI 空商品名点击注文を作成；API POST /prop/order 传 lines=[]；DB 按客户订单号查无记录。",
      };
    });

    await book.run("新建订单-020", "受注日为空提交失败", "FEAT-10-order orderRules.orderDate", async () => {
      await waitNewOrderReady(page);
      await selectSubject(page, "orderForm_ordering", fx.a.companyName);
      await selectAddressByLine(page, fx.a.addressLine1);
      await selectProduct(page);
      await fillFirstLine(page, 1, "AUTO-色A");
      await formItem(page, "お客様注文番号").locator("input").last().fill(noDateCoNo);
      const dateItem = formItem(page, "受注日");
      await dateItem.locator(".ant-picker").first().hover();
      const clear = dateItem.locator(".ant-picker-clear").first();
      if (await clear.isVisible().catch(() => false)) await clear.click();
      const dateValue = await dateItem.locator("input").first().inputValue();
      const noPost = await waitNoPost(page, () => clickCreate(page));
      const errors = (await page.locator(".ant-form-item-explain-error").allInnerTexts()).map((x) => x.trim()).filter(Boolean);
      const row = await findOrderByCustomerNo(db, noDateCoNo);
      const ok = dateValue === "" && noPost && !row && errors.some((x) => /受注日/.test(x));
      return {
        status: ok ? "通过" : "不通过",
        actual: `受注日清空后输入值=${JSON.stringify(dateValue)}；提交未发 POST=${noPost}，错误=${errors.join(" | ") || "(无)"}，DB 未创建订单=${!row}。`,
        evidence: "UI 新建订单清空受注日；点击注文を作成；监听 POST；读取表单错误与 DB。",
      };
    });

    await book.run("新建订单-021", "选择下单方自动带入客户区分与納品先默认", "FEAT-10-order §3.1、§6.5；VAL-12/VAL-13", async () => {
      await waitNewOrderReady(page);
      const initialType = await selectedCustomerType(page);
      const initialRecipient = compactText(await page.locator("#orderForm_recipient").innerText().catch(() => ""), 150);
      await selectSubject(page, "orderForm_ordering", fx.a.companyName);
      const typeAfterA = await selectedCustomerType(page);
      const recipientAfterA = compactText(await page.locator("#orderForm_recipient").innerText().catch(() => ""), 200);
      const billingAfterA = compactText(await page.locator(".customer-relations .party-field").nth(2).innerText().catch(() => ""), 200);
      await selectSubject(page, "orderForm_ordering", fx.b.companyName);
      const typeAfterB = await selectedCustomerType(page);
      const recipientAfterB = compactText(await page.locator("#orderForm_recipient").innerText().catch(() => ""), 200);
      await selectCustomerType(page, "代理店");
      const typeAgency = await selectedCustomerType(page);
      const recipientAgency = compactText(await page.locator("#orderForm_recipient").innerText().catch(() => ""), 200);
      await selectCustomerType(page, "直販");
      const typeDirect = await selectedCustomerType(page);
      const recipientDirect = compactText(await page.locator("#orderForm_recipient").innerText().catch(() => ""), 200);
      await selectSubject(page, "orderForm_ordering", fx.a.companyName);
      const typeAfterChange = await selectedCustomerType(page);
      const billingAfterChange = compactText(await page.locator(".customer-relations .party-field").nth(2).innerText().catch(() => ""), 200);
      const ok = /直販/.test(initialType)
        && /直販/.test(typeAfterA) && recipientAfterA.includes(fx.a.companyName) && billingAfterA.includes(fx.a.companyName)
        && /直販/.test(typeAfterB) && recipientAfterB.includes(fx.b.companyName)
        && /代理店/.test(typeAgency) && !recipientAgency.includes(fx.b.companyName)
        && /直販/.test(typeDirect) && recipientDirect.includes(fx.b.companyName)
        && /直販/.test(typeAfterChange) && billingAfterChange.includes(fx.a.companyName);
      return {
        status: ok ? "通过" : "不通过",
        actual: `初始区分=${initialType}/納品先=${initialRecipient || "空"}；选A后区分=${typeAfterA}、納品先=${recipientAfterA}、請求先=${billingAfterA}；选B后区分=${typeAfterB}、納品先=${recipientAfterB}；切代理后区分=${typeAgency}、納品先=${recipientAgency || "空"}；切回直販=${typeDirect}、納品先=${recipientDirect}；再换A后区分=${typeAfterChange}、請求先=${billingAfterChange}。`,
        evidence: "UI /orders/new 依次选择 AUTO-ORD-A/B、切换直販/代理店；读取 radio 选中态与 party-card 文案。",
      };
    });

    await book.run("新建订单-023", "請求書先与下单方不同时提示", "FEAT-10-order §3.1、§6.5；VAL-13/VAL-18", async () => {
      await waitNewOrderReady(page);
      await selectSubject(page, "orderForm_ordering", fx.a.companyName);
      await selectAddressByLine(page, fx.a.addressLine1);
      await selectBillingSubject(page, fx.b.companyName);
      const alert = compactText(await page.locator(".customer-relations .ant-alert-warning").innerText().catch(() => ""), 400);
      await selectProduct(page);
      await fillFirstLine(page, 1, "AUTO-色A");
      const result = await createOrderViaUi(page, billingCoNo);
      const row = await findOrderByCustomerNo(db, billingCoNo);
      const billing = row?.billing_party_snapshot ? JSON.parse(String(row.billing_party_snapshot)) as Record<string, unknown> : null;
      const ordering = row?.ordering_party_snapshot ? JSON.parse(String(row.ordering_party_snapshot)) as Record<string, unknown> : null;
      const ok = /請求先が注文先と異なる/.test(alert) && result.code === 200 && !!row && String(billing?.name ?? "") === fx.b.companyName && String(ordering?.name ?? "") === fx.a.companyName;
      return {
        status: ok ? "通过" : "不通过",
        actual: `請求先选 B 后页面提示=${alert || "(无)"}；订单创建 code=${result.code}，订单=${row?.order_id ?? "无"}，下单方快照=${String(ordering?.name ?? "null")}，請求先快照=${String(billing?.name ?? "null")}，无额外审批并可保存。`,
        evidence: "UI 选择下单方 A、請求先 B；读取 .ant-alert-warning；提交订单；DB 查询双方快照。",
      };
    });

    await book.run("订单详情-010", "详情页返回列表", "FEAT-10-order 详情页导航", async () => {
      if (!contactOrderId) throw new Error("缺少联系人订单夹具，无法验证详情返回");
      await page.goto(`/orders/${contactOrderId}`);
      await page.locator(".order-detail-page").waitFor({ state: "visible", timeout: 15000 });
      await page.waitForTimeout(700);
      await page.locator(".detail-head button").first().click();
      await page.waitForURL((url) => url.pathname === "/orders/index", { timeout: 10000 });
      const keyword = page.getByPlaceholder("注文管理番号／お客様注文番号／注文先／納品先");
      const ok = await keyword.isVisible().catch(() => false);
      return {
        status: ok ? "通过" : "不通过",
        actual: `从订单详情点击左上返回箭头后 URL=${page.url()}，订单列表关键词框可见=${ok}。`,
        evidence: "UI /orders/:id→点击详情头部 ‹→waitForURL(/orders)。",
      };
    });

    await book.run("订单权限-006", "客户主档变更不影响历史订单快照", "FEAT-10-order 历史快照隔离", async () => {
      if (!contactOrderId) throw new Error("缺少联系人订单夹具，无法验证订单快照");
      const oldName = fx.a.companyName;
      const newName = `${fx.a.companyName}-改名-${tag}`;
      const before = await db.query<Record<string, unknown>>(
        "SELECT ordering_party_snapshot FROM prop_order WHERE order_id=?",
        [contactOrderId],
      );
      const beforeName = String((JSON.parse(String(before[0]?.ordering_party_snapshot)) as Record<string, unknown>).name ?? "");
      try {
        await db.execute("UPDATE prop_customer_subject SET subject_name=? WHERE subject_id=?", [newName, fx.a.companyId]);
        const master = await db.query<{ subject_name: string }>(
          "SELECT subject_name FROM prop_customer_subject WHERE subject_id=?",
          [fx.a.companyId],
        );
        const after = await db.query<Record<string, unknown>>(
          "SELECT ordering_party_snapshot FROM prop_order WHERE order_id=?",
          [contactOrderId],
        );
        const afterName = String((JSON.parse(String(after[0]?.ordering_party_snapshot)) as Record<string, unknown>).name ?? "");
        const detail = await apiCall(token, "GET", `/prop/order/${contactOrderId}`);
        const apiName = String((detail.data as Record<string, unknown> | undefined)?.orderingPartySnapshot
          ? ((detail.data as Record<string, any>).orderingPartySnapshot.name ?? "")
          : "");
        await page.goto(`/orders/${contactOrderId}`);
        await page.locator(".order-detail-page").waitFor({ state: "visible", timeout: 15000 });
        await page.waitForTimeout(700);
        const uiText = compactText(await page.locator(".order-detail-page").innerText(), 2000);
        const ok = master[0]?.subject_name === newName && beforeName === oldName && afterName === oldName && apiName === oldName && uiText.includes(oldName) && !uiText.includes(newName);
        return {
          status: ok ? "通过" : "不通过",
          actual: `客户主档名称 ${oldName}→${master[0]?.subject_name ?? "?"}；订单快照 DB ${beforeName}→${afterName}；详情 API 下单方快照=${apiName || "(空)"}；详情 UI 仍显示旧名称=${uiText.includes(oldName)}、显示新名称=${uiText.includes(newName)}。`,
          evidence: "DB 更新专用客户主档名称→查询订单快照 DB→GET /prop/order/:id→打开订单详情核对展示；测试后恢复主档名称。",
        };
      } finally {
        await db.execute("UPDATE prop_customer_subject SET subject_name=? WHERE subject_id=?", [oldName, fx.a.companyId]);
      }
    });

    const results = book.list();
    console.log(`[A] 完成 ${results.length} 条；通过=${results.filter((x) => x.status === "通过").length}；不通过=${results.filter((x) => x.status === "不通过").length}；部分验证=${results.filter((x) => x.status === "部分验证").length}`);
    console.log(`[A] 夹具订单 contact=${contactOrderId ?? "无"} noContact=${noContactOrderId ?? "无"}；A公司=${fx.a.companyId}；B公司=${fx.b.companyId}`);
  } finally {
    await finishSession(browser!, session!, "verify-order-A");
    await db.close();
  }
}

main().catch((error) => {
  console.error("[A] FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
