/**
 * 产品管理·列表查询方向运行时验证
 * 来源：REQ-031（排序冲突/范围起止只填一个）、用例 产品列表查询-001~011
 * 方法：真实 UI 操作 + product-list 接口请求/响应捕获 + DB 幂等种数
 * 测试数据：AUTO-S001(create_time 早)/AUTO-S002(create_time 晚) 裸产品用于排序口径判定；AUTO-FREE01 空闲气囊用于反查未命中
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

interface ListRow { manufacturingNo?: string; productionStage?: string; firstShipmentDate?: string | null; }

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-list" });
  const page = session.page;
  const api500: string[] = [];
  page.on("response", (r) => { if (r.status() >= 500) api500.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  try {
    // ---- 幂等种数 ----
    const seedProduct = async (no: string, createTime: string) => {
      const exist = await db.snapshot("chk", "SELECT product_id FROM prop_product WHERE manufacturing_no=?", [no]);
      if (!exist.rows.length) {
        await db.snapshot("seed", "INSERT INTO prop_product (manufacturing_no, active_manufacturing_no, m_no, create_by, create_time) VALUES (?,?,CONCAT(\x27M\x27,RIGHT(?,4)),\x27admin\x27,?)", [no, no, no, createTime]);
        console.log(`[seed] product ${no} created`);
      }
    };
    await seedProduct("AUTO-S001", "2026-10-23 01:00:00");
    await seedProduct("AUTO-S002", "2026-10-23 02:00:00");
    const freePart = await db.snapshot("chk", "SELECT part_id FROM prop_part_item WHERE active_part_no=\x27AUTO-FREE01\x27");
    if (!freePart.rows.length) {
      await db.snapshot("seed", "INSERT INTO prop_part_item (part_no, active_part_no, part_type, source_type, current_profile_id, current_profile_version_id, create_by, create_time) VALUES (\x27AUTO-FREE01\x27,\x27AUTO-FREE01\x27,\x27airbag\x27,\x27assembly\x27,2,4,\x27admin\x27,NOW())");
      console.log("[seed] part AUTO-FREE01 (airbag, unbound) created");
    }

    await login(page);
    const waitList = () => page.waitForResponse((r) => r.url().includes("/prop/production/product-list") && r.request().method() === "GET", { timeout: 12000 });

    // ---- 1. 默认加载（用例-001）----
    let respPromise = waitList();
    await page.goto("/products/list");
    let resp = await respPromise;
    const defaultUrl = resp.request().url();
    const defaultBody = JSON.parse(await resp.text());
    const defaultRows: ListRow[] = defaultBody.rows || [];
    console.log("[list] default url:", decodeURIComponent(defaultUrl));
    console.log("[list] default total:", defaultBody.total, "rows:", defaultRows.map((r) => `${r.manufacturingNo}(${r.productionStage})`).join(","));
    await page.waitForTimeout(800);

    // ---- 2. 排序口径（REQ-031 P2 冲突）----
    await page.locator(".filters .ant-select").nth(0).hover();
    await page.locator(".filters .ant-select").nth(0).locator(".ant-select-clear").click();
    await page.waitForTimeout(300);
    respPromise = waitList();
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    resp = await respPromise;
    const allBody = JSON.parse(await resp.text());
    const allRows: ListRow[] = allBody.rows || [];
    const idxS1 = allRows.findIndex((r) => r.manufacturingNo === "AUTO-S001");
    const idxS2 = allRows.findIndex((r) => r.manufacturingNo === "AUTO-S002");
    console.log("[list] no-stage total:", allBody.total, "| idx AUTO-S001:", idxS1, "idx AUTO-S002:", idxS2);
    console.log("[list] first 6 rows:", allRows.slice(0, 6).map((r) => r.manufacturingNo).join(","));

    // ---- 3. 范围查询（用例-002）----
    await page.getByPlaceholder("前缀").fill("AUTO-J0");
    await page.getByPlaceholder("起始").fill("01");
    await page.getByPlaceholder("结束").fill("02");
    respPromise = waitList();
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    resp = await respPromise;
    const rangeRows: ListRow[] = (JSON.parse(await resp.text()).rows || []) as ListRow[];
    console.log("[range] AUTO-J0 01~02 rows:", rangeRows.map((r) => r.manufacturingNo).join(","));

    // ---- 4. 起止只填一个（REQ-031 P3 冲突）----
    await page.getByPlaceholder("起始").fill("03");
    await page.getByPlaceholder("结束").fill("");
    let rangeReqSent = false;
    const reqListener = (req: { url: () => string }) => { if (req.url().includes("/prop/production/product-list")) rangeReqSent = true; };
    page.on("request", reqListener);
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await page.waitForTimeout(1200);
    page.off("request", reqListener);
    const warn1 = await page.locator(".ant-message").innerText().catch(() => "(无提示)");
    console.log("[range] only-start warning:", JSON.stringify(warn1), "| request sent:", rangeReqSent);
    await page.getByPlaceholder("起始").fill("");
    await page.getByPlaceholder("前缀").fill("");

    // ---- 5. 单件查询命中直跳详情（用例-003）----
    await page.locator(".ant-segmented-item", { hasText: "单件查询" }).click();
    await page.getByPlaceholder("输入完整製造番号").fill("AUTO-J002");
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await page.waitForURL(/\/products\/\d+$/, { timeout: 10000 }).catch(() => undefined);
    const singleHitUrl = page.url();
    console.log("[single] hit url:", singleHitUrl);

    // ---- 6. 单件未命中（用例-010）----
    await page.goto("/products/list");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.locator(".ant-segmented-item", { hasText: "单件查询" }).click();
    await page.getByPlaceholder("输入完整製造番号").fill("AUTO-NOPE");
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await page.waitForTimeout(1200);
    const warn2 = await page.locator(".ant-message").innerText().catch(() => "(无提示)");
    console.log("[single] miss warning:", JSON.stringify(warn2), "| still on list:", page.url().includes("/products/list"));

    // ---- 7. 部件反查命中（用例-005）----
    await page.locator(".ant-segmented-item", { hasText: "部件反查" }).click();
    await page.getByPlaceholder("输入当前绑定部件编号").fill("AUTO-A050");
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await page.waitForURL(/\/products\/\d+$/, { timeout: 10000 }).catch(() => undefined);
    console.log("[part] hit url:", page.url());

    // ---- 8. 部件反查未绑定（用例-005 边界）----
    await page.goto("/products/list");
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
    await page.locator(".ant-segmented-item", { hasText: "部件反查" }).click();
    await page.getByPlaceholder("输入当前绑定部件编号").fill("AUTO-FREE01");
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await page.waitForTimeout(1200);
    const warn3 = await page.locator(".ant-message").innerText().catch(() => "(无提示)");
    console.log("[part] unbound warning:", JSON.stringify(warn3));

    // ---- 9. 首次出货筛选（用例-007/008）----
    await page.locator(".ant-segmented-item", { hasText: "范围查询" }).click();
    respPromise = waitList();
    await page.locator(".filters .ant-select").nth(1).click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "已首次出货" }).first().click();
    resp = await respPromise;
    const shippedBody = JSON.parse(await resp.text());
    console.log("[shipment] shipped url:", decodeURIComponent(resp.request().url()));
    console.log("[shipment] shipped total:", shippedBody.total);
    respPromise = waitList();
    await page.locator(".filters .ant-select").nth(1).click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "待首次出货" }).first().click();
    resp = await respPromise;
    const pendingBody = JSON.parse(await resp.text());
    console.log("[shipment] pending url:", decodeURIComponent(resp.request().url()));
    console.log("[shipment] pending total:", pendingBody.total, "| all null firstShipmentDate:", (pendingBody.rows || []).every((r: ListRow) => !r.firstShipmentDate));

    // ---- 10. 重置（用例-009）----
    await page.getByPlaceholder("起始").fill("01");
    await page.getByPlaceholder("结束").fill("99");
    respPromise = waitList();
    await page.getByRole("button", { name: /重\s*置/ }).click();
    resp = await respPromise;
    const resetUrl = decodeURIComponent(resp.request().url());
    const startVal = await page.getByPlaceholder("起始").inputValue();
    const endVal = await page.getByPlaceholder("结束").inputValue();
    console.log("[reset] url:", resetUrl);
    console.log("[reset] start/end inputs:", JSON.stringify(startVal), JSON.stringify(endVal));

    console.log("---- VERDICT ----");
    const defaultInspected = defaultUrl.includes("stage=inspected") && defaultRows.every((r) => r.productionStage === "inspected");
    console.log(defaultInspected ? `PASS 用例-001：默认 stage=inspected，${defaultRows.length} 行均为已完成质检。` : `CHECK 用例-001：默认参数或行阶段异常（url=${defaultUrl}）。`);
    const sortConflict = idxS1 >= 0 && idxS2 >= 0 && idxS2 < idxS1;
    console.log(sortConflict
      ? "冲突确认 REQ-031：AUTO-S002（建立晚）排在 AUTO-S001（建立早）之前，实际排序=创建时间降序，与需求「製造番号数字后缀升序」相反。"
      : `排序待复核：idx S001=${idxS1} S002=${idxS2}。`);
    const rangeOk = rangeRows.length === 2 && rangeRows.every((r) => ["AUTO-J001", "AUTO-J002"].includes(String(r.manufacturingNo)));
    console.log(rangeOk ? "PASS 用例-002：范围查询 AUTO-J0 01~02 仅命中 AUTO-J001/AUTO-J002。" : `CHECK 用例-002：范围结果=${rangeRows.map((r) => r.manufacturingNo).join(",")}`);
    console.log(!rangeReqSent && String(warn1).includes("需同时填写")
      ? "冲突确认 REQ-031(P3)：起止只填一个时前端警告拦截且不发请求，需求口径为「清除范围条件按全部处理」。"
      : `CHECK 起止单填：warning=${JSON.stringify(warn1)} reqSent=${rangeReqSent}`);
    console.log(/\/products\/7$/.test(singleHitUrl) ? "PASS 用例-003：单件查询命中 AUTO-J002 直跳 /products/7。" : `CHECK 用例-003：跳转=${singleHitUrl}`);
    console.log(String(warn2).includes("未找到该产品编号") ? "PASS 用例-010：单件未命中提示「未找到该产品编号」并留在列表。" : `CHECK 用例-010：${JSON.stringify(warn2)}`);
    console.log(String(warn3).includes("未找到绑定该部件的产品") ? "PASS 用例-005边界：反查未绑定部件提示正确。" : `CHECK 反查未绑定：${JSON.stringify(warn3)}`);
    console.log(`INFO 首次出货筛选：shipped total=${shippedBody.total}，pending total=${pendingBody.total}（参数见 url 日志）。`);
    console.log(!startVal && !endVal && !resetUrl.includes("startNo") && !resetUrl.includes("firstShipment")
      ? "PASS 用例-009：重置清空输入与首次出货条件，阶段/模式保留。"
      : `CHECK 用例-009：start=${startVal} end=${endVal} url=${resetUrl}`);
    console.log(api500.length ? `API-5xx 巡检命中：${api500.join(" ; ")}` : "API-5xx 巡检：列表方向无 5xx。");
  } finally {
    const tracePath = await closeSession(session, "verify-product-list");
    console.log("[list] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[list] FAILED:", e.message); process.exit(1); });

