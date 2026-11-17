/** 订单批量打印补充：基础显示、数据范围、张数与汇总（10 条）。 */
import {
  ResultBook, DbClient, launchAdminSession, finishSession, apiLogin, apiBase,
  runTag, compactText,
} from "./order-runtime-utils.js";
import {
  createBatchFixture, batchRow, selectBatchRow, unselectBatchRow,
  setBatchCopies, chooseBatchCarrier, batchSummary,
} from "./order-batch-utils.js";
import { ensureOrderFixtures } from "./order-runtime-utils.js";
import { confirmShipment } from "./order-shipment-utils.js";

const book = new ResultBook("reports/order-runtime-results-batch-base.json");
const db = new DbClient();
const tag = runTag();
const prefix = `AUTO-ORD-BS-${tag}`;
let browser: any;
let session: any;

async function tableApi(token: string, path: string): Promise<any> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json() as any;
  return { http: response.status, ...body };
}

async function ensurePreparingReturnFixture(): Promise<{ returnId: number; returnNo: string; batchId: number }> {
  const existing = await db.query<{ return_id: number; return_no: string; batch_id: number }>(
    "SELECT return_id,return_no,batch_id FROM prop_return WHERE create_by='AI自动探索' AND status='preparing' ORDER BY return_id DESC LIMIT 1",
  );
  if (existing.length) {
    return {
      returnId: Number(existing[0].return_id),
      returnNo: String(existing[0].return_no),
      batchId: Number(existing[0].batch_id),
    };
  }
  const maxBatch = await db.query<{ id: number }>("SELECT COALESCE(MAX(batch_id),0)+1 id FROM prop_reception_batch");
  const batchId = Number(maxBatch[0]?.id ?? 1);
  const maxSeq = await db.query<{ n: number }>(
    "SELECT COALESCE(MAX(batch_seq),0)+1 n FROM prop_reception_batch WHERE number_year=2026",
  );
  const batchSeq = Number(maxSeq[0]?.n ?? 1);
  const batchNo = `AUTO-RB-${tag.slice(-8)}`;
  await db.execute(
    `INSERT INTO prop_reception_batch
      (batch_id,number_year,batch_seq,batch_no,received_at,company_name,recipient_name,postal_text,
       postal_search,address,address_extra,contact_name,phone,note,first_product_id,source_order_id,
       source_order_no,create_by,create_time)
     VALUES (?,2026,?,?,NOW(),'AUTO返送会社','AUTO返送先','〒999-0001','9990001',
       'AUTO返送住所','AUTO返送建物','AUTO返送担当','03-0000-0000','007返送排除夹具',
       NULL,NULL,NULL,'AI自动探索',NOW())`,
    [batchId, batchSeq, batchNo],
  );
  const maxReturn = await db.query<{ id: number }>("SELECT COALESCE(MAX(return_id),0)+1 id FROM prop_return");
  const returnId = Number(maxReturn[0]?.id ?? 1);
  const returnNo = `AUTO-R${tag.slice(-7)}`;
  await db.execute(
    `INSERT INTO prop_return
      (return_id,return_no,number_year,batch_id,status,revision,address_snapshot,carrier,ship_date,
       box_count,tracking_numbers,confirmed_at,confirmed_by,create_by,create_time)
     VALUES (?,?,2026,?,'preparing',1,?,'yamato','2026-10-29',1,'[]',NULL,NULL,'AI自动探索',NOW())`,
    [returnId, returnNo, batchId, JSON.stringify({
      postalCode: "9990001", addressLine1: "AUTO返送住所", addressLine2: "AUTO返送建物",
    })],
  );
  return { returnId, returnNo, batchId };
}

async function main(): Promise<void> {
  await db.connect();
  const token = await apiLogin("admin", "admin123");
  const customers = await ensureOrderFixtures(db);
  const two = await createBatchFixture(db, token, customers.a, {
    prefix, label: "TWO", productCount: 2, carrier: "yamato",
  });
  const three = await createBatchFixture(db, token, customers.a, {
    prefix, label: "THREE", productCount: 3, carrier: "yamato",
  });
  const shipped = await createBatchFixture(db, token, customers.a, {
    prefix, label: "SHIPPED", productCount: 1, carrier: "yamato",
  });
  const shippedResult = await confirmShipment(token, shipped.shipmentId, []);
  if (shippedResult.code !== 200) throw new Error(`已寄出夹具确认失败：${shippedResult.msg}`);
  const returnFixture = await ensurePreparingReturnFixture();

  const launcher = await launchAdminSession("verify-order-batch-base");
  browser = launcher.browser;
  session = launcher.session;
  const page = session.page;
  page.setDefaultTimeout(20000);

  try {
    await page.goto("http://localhost:8090/home/workbench");
    await page.waitForTimeout(1200);
    await page.locator(".top-menu .ant-menu-submenu-title", { hasText: "订单管理" }).first().hover();
    await page.waitForTimeout(600);
    const orderSubmenu = page.locator(".ant-menu-submenu-popup:visible").last();
    const orderSubmenuText = compactText(await orderSubmenu.innerText());
    const hasBatchMenu = orderSubmenuText.includes("送り状一括生成") && orderSubmenuText.includes("订单列表");
    await orderSubmenu.getByText("送り状一括生成", { exact: true }).click();
    await page.locator("h2", { hasText: "送り状一括生成" }).waitFor({ state: "visible", timeout: 15000 });
    await page.locator("tr.ant-table-row").first().waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(900);
    const main = page.locator(".batch-page");
    const title = compactText(await main.locator("h2").innerText());
    const mainButtons = (await main.locator("button").allInnerTexts()).map(compactText).filter(Boolean);
    const hasBackButton = mainButtons.some((text) => /注文一覧|一覧へ戻|戻る|返回订单/.test(text));
    const initialCarrier = compactText(await page.locator(".carrier-select .ant-select-selection-item").innerText());
    const initialRows = await page.locator("tr.ant-table-row").count();
    const initialRowTexts = await page.locator("tr.ant-table-row").allInnerTexts();

    const twoRow = batchRow(page, two);
    const threeRow = batchRow(page, three);
    await twoRow.waitFor({ state: "visible" });
    await threeRow.waitFor({ state: "visible" });
    const defaultCopies = await twoRow.locator(".ant-input-number-input").first().inputValue();
    const stepperCount = await twoRow.locator(".ant-input-number-handler").count();
    const twoCells = (await twoRow.locator("td").allInnerTexts()).map(compactText);
    const threeCells = (await threeRow.locator("td").allInnerTexts()).map(compactText);

    await page.locator(".carrier-select").click();
    const carrierOptions = (await page.locator(".ant-select-dropdown:visible .ant-select-item-option").allInnerTexts())
      .map(compactText);
    await page.keyboard.press("Escape");
    await chooseBatchCarrier(page, "佐川急便");
    const sagawaValue = compactText(await page.locator(".carrier-select .ant-select-selection-item").innerText());
    const afterCarrierRows = await page.locator("tr.ant-table-row").count();
    const afterCarrierRowTexts = await page.locator("tr.ant-table-row").allInnerTexts();
    await chooseBatchCarrier(page, "ヤマト運輸");

    const batchApi = await tableApi(token, "/prop/shipment/batch-preparations?pageNum=1&pageSize=100");
    const expected = await db.query<{ c: number }>(
      `SELECT COUNT(*) c FROM prop_shipment s JOIN prop_order o ON o.order_id=s.order_id
       WHERE s.deleted_time IS NULL AND s.status='preparing' AND o.order_status='active'`,
    );
    const returnCount = await db.query<{ c: number }>(
      "SELECT COUNT(*) c FROM prop_return WHERE status='preparing'",
    );
    const shippedInApi = (batchApi.rows || []).some((row: any) => Number(row.shipmentId) === shipped.shipmentId);
    const returnNoInApi = JSON.stringify(batchApi.rows || []).includes(returnFixture.returnNo);

    await selectBatchRow(page, two, 1);
    await setBatchCopies(page, two, 0);
    const zeroValue = await batchRow(page, two).locator(".ant-input-number-input").first().inputValue();
    const zeroSummary = await batchSummary(page);

    await setBatchCopies(page, two, 3);
    const threeCopiesSummary = await batchSummary(page);
    await setBatchCopies(page, two, null);
    const emptyValue = await batchRow(page, two).locator(".ant-input-number-input").first().inputValue();
    const emptySummary = await batchSummary(page);

    await selectBatchRow(page, two, 1);
    await selectBatchRow(page, three, 1);
    await page.waitForTimeout(400);
    const twoSummary = await batchSummary(page);
    const twoRowAfter = (await batchRow(page, two).locator("td").allInnerTexts()).map(compactText);
    const threeRowAfter = (await batchRow(page, three).locator("td").allInnerTexts()).map(compactText);

    await unselectBatchRow(page, two);
    const remainingSummary = await batchSummary(page);
    await unselectBatchRow(page, three);

    await page.route("**/prop/shipment/batch-preparations**", async (route: any) => {
      if (route.request().method() !== "GET") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 200, msg: "", rows: [], total: 0 }),
      });
    });
    await page.reload();
    await page.locator(".batch-page").waitFor({ state: "visible" });
    await page.waitForTimeout(1200);
    const emptyText = compactText(await page.locator(".batch-page .ant-empty-description").innerText());
    const emptyRows = await page.locator("tr.ant-table-row").count();
    await page.unroute("**/prop/shipment/batch-preparations**");
    await page.reload();
    await page.locator("tr.ant-table-row").first().waitFor({ state: "visible" });

    await book.run("订打补充-001", "批量打印页标题和返回", "FEAT-19 §4.2", async () => ({
      status: title === "送り状一括生成" && !hasBackButton && hasBatchMenu ? "通过" : "不通过",
      actual: `页面标题=“${title}”（需求中文“批量打印面单”的日文界面文案）；批量页内按钮=${JSON.stringify(mainButtons.slice(0, 20))}，返回订单列表按钮=${hasBackButton}；订单管理同级菜单=“${orderSubmenuText}”，存在订单列表与送り状一括生成=${hasBatchMenu}。`,
      evidence: "从顶部“订单管理”同级菜单点击“送り状一括生成”进入，读取页面 h2、批量页全部按钮及菜单项；确认无返回订单列表入口。",
    }));

    await book.run("订打补充-002", "快递公司默认大和运输", "FEAT-19 §4.4", async () => ({
      status: initialCarrier === "ヤマト運輸" ? "通过" : "不通过",
      actual: `首次进入时快递公司控件值=“${initialCarrier}”，下拉选项=${JSON.stringify(carrierOptions)}，默认值为 ヤマト運輸=${initialCarrier === "ヤマト運輸"}。`,
      evidence: "进入批量页后读取 .carrier-select 当前值，并展开下拉核对两个承运商选项。",
    }));

    await book.run("订打补充-003", "快递公司可选佐川急便", "FEAT-19 §3、§4.4", async () => {
      const stable = initialRows === afterCarrierRows
        && JSON.stringify(initialRowTexts) === JSON.stringify(afterCarrierRowTexts);
      return {
        status: sagawaValue === "佐川急便" && stable ? "通过" : "不通过",
        actual: `切换后控件值=“${sagawaValue}”；切换前/后表格行数=${initialRows}/${afterCarrierRows}，行文本完全一致=${JSON.stringify(initialRowTexts) === JSON.stringify(afterCarrierRowTexts)}。`,
        evidence: "在真实批量页展开承运商下拉，选择佐川急便；对比切换前后表格行数与全部行文本，确认不发生筛选或重查。",
      };
    });

    await book.run("订打补充-007", "返送寄送不进入订单批量打印", "FEAT-19 VAL-15、VAL-22", async () => {
      const countMatches = Number(batchApi.total) === Number(expected[0]?.c ?? -1);
      const passed = returnCount[0].c > 0 && countMatches && !shippedInApi && !returnNoInApi;
      return {
        status: passed ? "通过" : "不通过",
        actual: `已构造准备中返送 returnNo=${returnFixture.returnNo}（returnId=${returnFixture.returnId}，batchId=${returnFixture.batchId}）；准备中返送数=${returnCount[0].c}；批量 API total=${batchApi.total}，与数据库订单准备中寄送数 ${expected[0]?.c} 一致=${countMatches}；API 含已寄出夹具=${shippedInApi}，含返送号=${returnNoInApi}。`,
        evidence: "向独立 prop_return/prop_reception_batch 写入准备中返送夹具；核对页面只读取 prop_shipment 关联有效订单，接口 total 与订单准备中寄送数据库计数一致，且不包含返送号或已寄出夹具。",
      };
    });

    await book.run("订打补充-015", "面单张数默认一张", "FEAT-19 §4.4", async () => ({
      status: defaultCopies === "1" && stepperCount === 2 ? "通过" : "不通过",
      actual: `寄送 ${two.shipmentNo} 的张数输入值=“${defaultCopies}”，增减控件数=${stepperCount}。`,
      evidence: "读取新建准备中寄送行的面单张数输入框初始值及 InputNumber 上下增减按钮数量。",
    }));

    await book.run("订打补充-016", "无准备中寄送显示空态", "FEAT-19 §4.4", async () => {
      const correct = emptyText === "準備中の注文発送はない" && emptyRows === 0;
      return {
        status: correct ? "部分验证" : "不通过",
        actual: `测试环境仍有 ${initialRows} 行其他准备中寄送，无法自然形成全局空数据；定向将 batch-preparations 响应置为 rows=[]/total=0 后，页面表格行数=${emptyRows}，空态文案=“${emptyText}”（对应需求“当前没有准备中的订单寄送”）。已寄出夹具 ${shipped.shipmentNo} 不在真实批量 API 返回中=${!shippedInApi}。`,
        evidence: "Playwright 仅拦截页面列表 GET 返回空 rows/total，验证前端空态渲染；同时以真实接口和 DB 验证已寄出寄送被排除。因非自然空库，标为部分验证。",
      };
    });

    await book.run("订打补充-017", "张数最小值为一", "FEAT-19 §3、§4.6", async () => ({
      status: zeroValue === "1" ? "通过" : "不通过",
      actual: `对寄送 ${two.shipmentNo} 输入 0 并失焦后，输入值=“${zeroValue}”，汇总=“${zeroSummary.text}”，生成按钮=“${zeroSummary.button}”。`,
      evidence: "在 UI 真实张数控件输入 0、按 Tab 触发 change/blur，再读取控件与实际汇总。",
    }));

    await book.run("订打补充-020", "张数空值按一处理", "FEAT-19 §4.6", async () => {
      const emptyToOne = emptyValue === "1" && /送り状 1 枚/.test(emptySummary.text)
        && /（1 枚）/.test(emptySummary.button);
      return {
        status: emptyToOne ? "通过" : "不通过",
        actual: `原张数 3 时汇总=“${threeCopiesSummary.text}”/按钮“${threeCopiesSummary.button}”；清空并失焦后输入值=“${emptyValue}”，汇总=“${emptySummary.text}”，按钮=“${emptySummary.button}”。`,
        evidence: "UI 先设置张数 3，再清空输入框并失焦，读取张数控件、汇总栏与生成按钮文案。",
      };
    });

    await book.run("订打补充-022", "多笔寄送合计产品台数", "FEAT-19 VAL-17", async () => {
      const quantities = [Number(twoRowAfter[4]), Number(threeRowAfter[4])];
      const passed = quantities[0] === 2 && quantities[1] === 3 && /選択 2 件/.test(twoSummary.text)
        && /製品 5 台/.test(twoSummary.text);
      return {
        status: passed ? "通过" : "不通过",
        actual: `勾选 ${two.shipmentNo}/${three.shipmentNo} 后汇总=“${twoSummary.text}”，按钮=“${twoSummary.button}”；两行台数列=${JSON.stringify(quantities)}，产品摘要分别为“${twoRowAfter[3]}”“${threeRowAfter[3]}”。`,
        evidence: "UI 勾选分别含 2 台、3 台的两笔准备中寄送，读取台数列、产品摘要和底部汇总。",
      };
    });

    await book.run("订打补充-024", "取消勾选更新汇总栏", "FEAT-19 VAL-17", async () => {
      const passed = /選択 1 件/.test(remainingSummary.text) && /製品 3 台/.test(remainingSummary.text)
        && /送り状 1 枚/.test(remainingSummary.text) && /（1 枚）/.test(remainingSummary.button);
      return {
        status: passed ? "通过" : "不通过",
        actual: `取消勾选 2 台寄送 ${two.shipmentNo} 后，汇总=“${remainingSummary.text}”，按钮=“${remainingSummary.button}”，按钮禁用=${remainingSummary.disabled}。`,
        evidence: "UI 从已勾选两笔中取消 2 台寄送，核对汇总笔数、产品台数和张数只保留 3 台寄送。",
      };
    });

    console.log(`[BATCH-BASE] 完成 10 条；通过=${book.list().filter((x) => x.status === "通过").length}；部分验证=${book.list().filter((x) => x.status === "部分验证").length}；不通过=${book.list().filter((x) => x.status === "不通过").length}`);
    console.log(`[BATCH-BASE] 两笔=${two.orderNo}/${two.shipmentNo}，三笔=${three.orderNo}/${three.shipmentNo}，已寄出=${shipped.shipmentNo}，返送=${returnFixture.returnNo}`);
  } finally {
    if (browser && session) await finishSession(browser, session, "verify-order-batch-base");
    await db.close();
  }
}

main().catch((error) => {
  console.error("[BATCH-BASE] FAILED:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
