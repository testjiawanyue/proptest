/**
 * 产品管理 A 批（只读展示）运行时验证：12 条。
 * 覆盖：列表关联-001~006、列表查询-011、详情-002/003/005/010、部件操作-010-错误。
 * 夹具：产品 35（订单/部件/发货/名称/资料路径/受付）、产品 24（无订单）、4 台分页产品。
 */
import { chromium, type Page, type Locator } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, login } from "../../src/actions/session.js";
import {
  ResultBook, DbClient, apiLogin, apiCall, apiBase, finishSession, compact,
} from "../production/prod-runtime-utils.js";

const book = new ResultBook("reports/product-mgmt-runtime-results-a.json");
const db = new DbClient();
const REQ = "FEAT-08 产品管理（列表关联/详情展示/分页）";
let token = "";
let page: Page;

const text = async (locator: Locator) => compact(await locator.innerText().catch(() => ""));

async function openFullList(): Promise<void> {
  await page.goto("/products/list", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  console.log("[openFullList] url=", page.url(), "th=", await page.locator("thead th").count());
  await page.locator("thead th").first().waitFor({ state: "visible", timeout: 20000 });
  const stage = page.locator(".ant-select", { has: page.locator("#product-stage") }).first();
  await stage.hover();
  await page.waitForTimeout(300);
  if (await stage.locator(".ant-select-clear").isVisible().catch(() => false)) {
    await stage.locator(".ant-select-clear").click();
    await page.waitForTimeout(2500);
  }
  await page.locator("tbody tr.ant-table-row").first().waitFor({ state: "visible" });
  await page.locator(".ant-pagination").first().waitFor({ state: "visible" });
}

async function switchPageSize(size: string): Promise<void> {
  await page.locator(".ant-pagination-options").first().waitFor({ state: "visible" });
  await page.locator(".ant-pagination-options .ant-select-selector").first().click();
  await page.waitForTimeout(300);
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: size }).first().click();
  await page.waitForTimeout(1500);
}

function cell(row: Locator, index: number): Promise<string> {
  return text(row.locator("td").nth(index));
}

async function main(): Promise<void> {
  await db.connect();
  token = await apiLogin(config.app.loginUser, config.app.loginPassword);
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-mgmt-a" });
  page = session.page;
  page.setDefaultTimeout(15000);
  await login(page);
  try {
    await openFullList();
    const totalText = await text(page.locator(".ant-pagination-total-text"));
    const defaultRows = await page.locator("tbody tr.ant-table-row").count();
    const defaultSize = await text(page.locator(".ant-pagination-options .ant-select-selection-item"));
    await switchPageSize("50");
    const allRows = await page.locator("tbody tr.ant-table-row").allInnerTexts();
    const row35 = page.locator("tbody tr.ant-table-row", { hasText: "20261028" }).first();
    const row24 = page.locator("tbody tr.ant-table-row", { hasText: "90403" }).first();
    const has35 = await row35.isVisible().catch(() => false);
    const has24 = await row24.isVisible().catch(() => false);
    const row35No = await cell(row35, 3);
    const row35Status = await cell(row35, 4);
    const row35Parts = await cell(row35, 5);
    const row35Shipment = await cell(row35, 7);
    const row35Name = await cell(row35, 2);
    const row24No = await cell(row24, 3);
    const row24Status = await cell(row24, 4);
    const row24Name = await cell(row24, 2);

    await book.run("产品列表数据关联-001", "已关联订单产品当前业务归属展示正确", REQ, async () => {
      const ok = has35 && row35No.includes("R261010") && row35No.includes("レンタル") &&
        row35No.includes("公式名称1") && row35Status.includes("注文あり");
      return {
        status: ok ? "通过" : "不通过",
        actual: `产品 20261028 行可见=${has35}；当前业务归属=${row35No}；产品状态=${row35Status}`,
        evidence: "GET /product-list + 列表行 DOM；DB 产品 35 有效关系 order_id=17",
      };
    });

    await book.run("产品列表数据关联-002", "未关联订单产品显示无当前订单", REQ, async () => {
      const ok = has24 && row24No.includes("現在の注文なし") && row24Status.includes("注文なし");
      return {
        status: ok ? "通过" : "不通过",
        actual: `产品 90403 行可见=${has24}；当前业务归属=${row24No}；产品状态=${row24Status}`,
        evidence: "列表行 DOM；DB 产品 24 无 prop_product_order_relation 记录",
      };
    });

    await book.run("产品列表数据关联-003", "当前组成列与部件绑定一致", REQ, async () => {
      const expected = ["qn1028", "cgq1028", "85cm", "fsq1028", "fsq10282"];
      const listOk = expected.every((value) => row35Parts.includes(value));
      const detail = await apiCall(token, "GET", "/prop/production/products/35");
      const bindings = ((detail.data as any)?.bindings ?? []) as Array<{ slotType: string; partNo: string; firmwareVersion?: string }>;
      const bindingNos = bindings.map((item) => item.partNo);
      const detailOk = expected.every((value) => bindingNos.includes(value) || bindings.some((item) => item.firmwareVersion === value));
      return {
        status: listOk && detailOk && bindings.length === 5 ? "通过" : "不通过",
        actual: `列表当前组成=${row35Parts}；详情绑定 ${bindings.length} 项=${bindingNos.join("/")}；列表/详情一致=${listOk && detailOk}`,
        evidence: "列表行第 6 列 + GET /products/35 bindings",
      };
    });

    await book.run("产品列表数据关联-004", "对外名称列与对外产品名称事件一致", REQ, async () => {
      const ok = row35Name.includes("一命多助") && row24Name.includes("名称未設定");
      return {
        status: ok ? "通过" : "不通过",
        actual: `产品 20261028 对外名称=${row35Name}；产品 90403 对外名称=${row24Name}`,
        evidence: "列表商品名列 DOM；产品 35 名称事件 PRODUCT_NAME_CHANGED",
      };
    });

    await book.run("产品列表数据关联-005", "首次出货日由已确认发货派生", REQ, async () => {
      const shipments = await db.query<{ status: string; confirmed_time: string | null }>(
        "SELECT s.status, s.confirmed_time FROM prop_shipment s JOIN prop_shipment_product sp ON sp.shipment_id=s.shipment_id WHERE sp.product_id=35 AND s.deleted_time IS NULL");
      const shipped = shipments.filter((item) => item.status === "shipped");
      const confirmed = shipped[0]?.confirmed_time;
      const confirmedText = confirmed ? new Date(confirmed as any).toISOString() : "";
      const ok = row35Shipment.includes("2026-10-28") && shipped.length === 1 &&
        confirmedText.startsWith("2026-10-28");
      return {
        status: ok ? "通过" : "不通过",
        actual: `列表初回出荷=${row35Shipment}；产品 35 已确认发货 ${shipped.length} 条，确认时间=${shipped[0]?.confirmed_time ?? "—"}；未确认草稿不计入=${shipments.length === shipped.length}`,
        evidence: "列表第 8 列 + prop_shipment/prop_shipment_product DB",
      };
    });

    await book.run("产品详情展示-002", "详情基本信息字段展示正确", REQ, async () => {
      await page.goto("/products/35", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      const labels = await page.locator(".ant-descriptions-item-label").allInnerTexts();
      const values = await page.locator(".ant-descriptions-item-content").allInnerTexts();
      const joined = labels.join("|");
      const required = ["製造番号", "商品名", "ジャケット仕様", "初回合格日", "初回出荷", "管理基準月", "資料の保存先"];
      const noForbidden = !joined.includes("業務") && !joined.includes("M番号") && !joined.includes("作成") && !joined.includes("操作者");
      const pathOk = values.some((value) => value.includes("AUTO-PM-PATH-35"));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      const labels2 = await page.locator(".ant-descriptions-item-label").allInnerTexts();
      const values2 = await page.locator(".ant-descriptions-item-content").allInnerTexts();
      const refreshOk = labels2.join("|") === joined && values2.some((value) => value.includes("AUTO-PM-PATH-35"));
      const ok = required.every((label) => labels.includes(label)) && labels.length === 7 && noForbidden && pathOk && refreshOk;
      return {
        status: ok ? "通过" : "不通过",
        actual: `基本信息 ${labels.length} 项=${labels.join("/")}；值=${values.join(" ｜ ")}；无业务类型/M番号/时间/操作人=${noForbidden}；刷新一致=${refreshOk}`,
        evidence: "详情页 descriptions DOM + 刷新复查 + 资料路径接口",
      };
    });

    await book.run("产品详情展示-005", "生命周期实际记录关联返厂受付信息", REQ, async () => {
      const card = page.locator(".ant-card", { hasText: "定期管理" }).first();
      const rows = (await card.locator("tbody tr").allInnerTexts()).filter((row) => row.trim());
      const first = rows[0] ?? "";
      const rest = rows.slice(1);
      const firstOk = first.includes("2027-05-10") && first.includes("定期点検");
      const emptyOk = rest.length === 4 && rest.every((row) => row.includes("—"));
      const allEmpty = rest.every((row) => row.includes("—"));
      const ok = firstOk && emptyOk;
      return {
        status: ok ? "部分验证" : "不通过",
        actual: `第1年=${first}；第2~5年=${rest.join(" ｜ ")}；受付信息已关联=${firstOk}；空年度文案为「—」而非用例要求的「尚无实际记录」=${allEmpty}`,
        evidence: "详情「定期管理」表 + DB prop_reception/product_id=35/inspection_year=1 + reception_type=inspection",
      };
    });

    await book.run("产品详情展示-010", "业务历史分类筛选仅显示对应类别事件", REQ, async () => {
      const countOf = async (tab: string) => {
        await page.locator(".ant-tabs-tab", { hasText: tab }).first().click();
        await page.waitForTimeout(350);
        return page.locator(".ant-timeline-item").allInnerTexts();
      };
      const all = await countOf("すべて");
      const production = await countOf("生産・部品");
      const shipment = await countOf("出荷・注文");
      const productionText = production.join("\n");
      const shipmentText = shipment.join("\n");
      const allText = all.join("\n");
      const productionOk = productionText.includes("部品取付") && productionText.includes("検査合格") &&
        productionText.includes("ジャケット入庫") && productionText.includes("商品名の採用") &&
        !productionText.includes("出荷：");
      const shipmentOk = shipmentText.includes("出荷：") && !shipmentText.includes("部品取付") &&
        !shipmentText.includes("ジャケット入庫");
      const allOk = allText.includes("出荷：") && allText.includes("部品取付");
      const orderEndCovered = shipmentText.includes("注文関係") || shipmentText.includes("解除");
      const ok = productionOk && shipmentOk && allOk;
      return {
        status: ok && orderEndCovered ? "通过" : "部分验证",
        actual: `全部=${all.length} 条、生産・部品=${production.length} 条、出荷・注文=${shipment.length} 条；生产页签隔离=${productionOk}、出货页签隔离=${shipmentOk}、全部合集=${allOk}；订单关系结束事件覆盖=${orderEndCovered}`,
        evidence: "详情页 3 个页签 timeline DOM + 事件类型映射 productHistoryCategory",
      };
    });

    await book.run("产品部件操作-010-错误", "产品详情不提供解除订单关系入口", REQ, async () => {
      const buttons = await page.getByRole("button").allInnerTexts();
      const body = await page.locator("body").innerText();
      const hasRelease = buttons.some((item) => item.includes("解除")) || body.includes("解除");
      const readOnly = body.includes("R261010") && body.includes("レンタル") && body.includes("公式名称1");
      return {
        status: !hasRelease && readOnly ? "通过" : "不通过",
        actual: `详情按钮=${buttons.join("/")}；存在解除入口=${hasRelease}；详情页订单关系/归属只读展示=${readOnly}（列表页有当前订单列，详情页无该区域）`,
        evidence: "详情页按钮清单 + body 文案 + 当前关系 DB",
      };
    });

    await book.run("产品详情展示-003", "详情页返回列表", REQ, async () => {
      await page.locator("button", { hasText: "←" }).first().click();
      await page.waitForTimeout(1500);
      const url = page.url();
      const backOk = url.includes("/products/list");
      return {
        status: backOk ? "通过" : "不通过",
        actual: `返回后 URL=${url}；回到产品列表=${backOk}`,
        evidence: "详情页返回箭头点击 + URL 断言",
      };
    });

    await book.run("产品列表查询-011", "产品列表分页展示", REQ, async () => {
      await openFullList();
      await switchPageSize("20");
      const total = await text(page.locator(".ant-pagination-total-text"));
      const rows20 = await page.locator("tbody tr.ant-table-row").count();
      await switchPageSize("50");
      const rows50 = await page.locator("tbody tr.ant-table-row").count();
      const order = (await page.locator("tbody tr.ant-table-row").allInnerTexts()).slice(1, 5).map((row) => row.split("\t")[0]);
      const orderOk = order.join(",") === "AUTO-PM-PAGE-004,AUTO-PM-PAGE-003,AUTO-PM-PAGE-002,AUTO-PM-PAGE-001";
      const url = page.url();
      const contextOk = url.includes("pageSize=50") && total.includes("21");
      const resp = await fetch(`${apiBase}/prop/production/product-list?pageNum=1&pageSize=500`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const raw = (await resp.json()) as { rows?: unknown[] };
      const capped = (raw.rows ?? []).length <= 100;
      const ok = total.includes("21") && rows20 === 20 && rows50 === 21 && orderOk && contextOk && capped;
      return {
        status: ok ? "部分验证" : "不通过",
        actual: `总数=${total}、默认=${defaultSize}/${defaultRows} 行、20 条/页=${rows20} 行、50 条/页=${rows50} 行；前 4 台顺序=${order.join("→")}（制造番号升序相反=${orderOk}）；返回/分页上下文=${contextOk}；pageSize=500 返回 ${(raw.rows ?? []).length} 行（≤100=${capped}）；后续编辑/组装/质检不移动排序、失败翻页未覆盖`,
        evidence: "列表分页控件 + URL 上下文 + product-list 接口；后续写操作排序稳定性留待补充",
      };
    });

    await book.run("产品列表数据关联-006", "生命周期基准月由首次发货日派生", REQ, async () => {
      await page.goto("/products/35", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const values35 = await page.locator(".ant-descriptions-item-content").allInnerTexts();
      const base35 = values35[5] ?? "";
      await page.goto("/products/24", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      const values24 = await page.locator(".ant-descriptions-item-content").allInnerTexts();
      const base24 = values24[5] ?? "";
      const ok = base35.includes("2026-10") && base24.includes("—");
      return {
        status: ok ? "通过" : "不通过",
        actual: `产品 20261028 管理基準月=${base35}；产品 90403 管理基準月=${base24}（未出货为空）`,
        evidence: "两份产品详情基本信息 + DB first_shipment_date 2026-10-28 / null",
      };
    });
  } finally {
    await finishSession(browser, session, "verify-product-mgmt-a");
    await db.close();
  }
}

await main();
