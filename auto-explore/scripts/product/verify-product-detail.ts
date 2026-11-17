/**
 * 产品管理·详情页方向运行时验证
 * 来源：REQ-029(业务类型缺失)/REQ-034(更换衣体文案)/REQ-035(生命周期无记录文案)/REQ-036(历史页签5vs6)/REQ-037(存放路径弹窗保存)
 *      用例 产品详情展示-001~012；权限-004(非法ID)
 * 测试数据：AUTO-J002(已质检整机)/AUTO-J001(待质检)/AUTO-J003(在制)；first_shipment_date 临时种数后恢复
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-detail" });
  const page = session.page;
  const api500: string[] = [];
  page.on("response", (r) => { if (r.status() >= 500) api500.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  const waitDetail = () => page.waitForResponse((r) => /\/prop\/production\/products\/\d+$/.test(r.url()) && r.request().method() === "GET", { timeout: 12000 });
  try {
    await login(page);

    // ---- 1. 已质检产品详情加载（用例-001/002/007）----
    let respPromise = waitDetail();
    await page.goto("/products/7");
    let resp = await respPromise;
    const detailStatus = resp.status();
    const detailText = await resp.text();
    console.log("[detail] GET /products/7 status:", detailStatus, "body head:", detailText.slice(0, 300));
    const apiOk = detailStatus === 200 && JSON.parse(detailText).code === 200;
    let labels: string[] = [];
    let tabs: string[] = [];
    if (apiOk) {
      await page.waitForTimeout(1200);
      labels = await page.locator(".ant-descriptions-item-label").allInnerTexts();
      console.log("[detail] 基本信息 labels:", JSON.stringify(labels));
      const mNoShown = await page.locator(".detail-page").innerText();
      console.log("[detail] 页面含 M番号/M000007:", mNoShown.includes("M000007") || mNoShown.includes("M番号"));
      // 当前部件表（用例-007）
      const partSection = page.locator("section", { hasText: "当前部件" }).last();
      const partRows = await partSection.locator(".ant-table-row").allInnerTexts();
      console.log("[detail] 当前部件行:", JSON.stringify(partRows.map((r) => r.replace(/\n/g, "|"))));
      // 已质检无阶段提示条（用例-011c）
      const hintVisible = await page.locator(".detail-page > .ant-alert").first().isVisible().catch(() => false);
      console.log("[detail] 已质检提示条存在:", hintVisible);
      // 历史页签（REQ-036）
      tabs = await page.locator(".ant-tabs-tab").allInnerTexts();
      console.log("[detail] 历史页签:", JSON.stringify(tabs));
      // 生命周期空状态（用例-006）
      const lifeEmpty = await page.locator("section", { hasText: "生命周期" }).last().locator(".ant-empty").innerText().catch(() => "(非空态)");
      console.log("[detail] 生命周期空态:", JSON.stringify(lifeEmpty));
    }

    // ---- 2. 生命周期日程（用例-004/005，REQ-035）：临时种出货日期 ----
    let lifecycleInfo = "(跳过：详情接口异常)";
    if (apiOk) {
      await db.snapshot("seed-ship", "UPDATE prop_product SET first_shipment_date=\x272026-10-20\x27, lifecycle_base_month=\x272026-10\x27 WHERE product_id=7 AND first_shipment_date IS NULL");
      respPromise = waitDetail();
      await page.goto("/products/7");
      await respPromise;
      await page.waitForTimeout(1200);
      const lifeRows = await page.locator("section", { hasText: "生命周期" }).last().locator(".ant-table-row").allInnerTexts();
      lifecycleInfo = JSON.stringify(lifeRows.map((r) => r.replace(/\n/g, "|")));
      console.log("[lifecycle] rows:", lifecycleInfo);
      await db.snapshot("restore-ship", "UPDATE prop_product SET first_shipment_date=NULL, lifecycle_base_month=NULL WHERE product_id=7 AND baseline_shipment_id IS NULL");
      console.log("[lifecycle] first_shipment_date 已恢复 NULL");
    }

    // ---- 3. 存放路径弹窗保存（用例-012，REQ-037）----
    let storageResult = "(跳过)";
    if (apiOk) {
      respPromise = waitDetail();
      await page.goto("/products/7");
      await respPromise;
      await page.waitForTimeout(1000);
      await page.getByRole("button", { name: "编 辑" }).or(page.getByRole("button", { name: "编辑" })).first().click();
      const modal = page.locator(".ant-modal", { hasText: "编辑资料存放路径" });
      await modal.locator("input").fill("\\\\\\\\NAS\\\\share\\\\AUTO-J002");
      const putPromise = page.waitForResponse((r) => r.url().includes("/storage-path") && r.request().method() === "PUT", { timeout: 10000 });
      await modal.getByRole("button", { name: "保 存" }).or(modal.getByRole("button", { name: "保存" })).first().click();
      const putResp = await putPromise;
      console.log("[storage] PUT status:", putResp.status(), (await putResp.text()).slice(0, 200));
      const dbPath = await db.snapshot("path", "SELECT storage_path FROM prop_product WHERE product_id=7");
      console.log("[storage] db storage_path:", JSON.stringify(dbPath.rows));
      respPromise = waitDetail();
      await page.goto("/products/7");
      await respPromise;
      await page.waitForTimeout(800);
      const shown = await page.locator(".storage-path").innerText();
      console.log("[storage] 刷新后展示:", JSON.stringify(shown));
      storageResult = `PUT=${putResp.status()} db=${JSON.stringify(dbPath.rows)} shown=${shown}`;
    }

    // ---- 4. 更换衣体（用例 部件操作-005/013，REQ-034）----
    let bodyResult = "(跳过)";
    if (apiOk) {
      const bindsBefore = await db.snapshot("b0", "SELECT binding_id, slot_type, part_id, ended_time FROM prop_product_binding WHERE product_id=7 ORDER BY binding_id");
      await page.waitForTimeout(600);
      await page.locator("section", { hasText: "当前部件" }).last().getByRole("button", { name: "更换衣体" }).click();
      const confirmModal = page.locator(".ant-modal-confirm");
      const bodyText = await confirmModal.innerText();
      console.log("[body] 确认弹窗文案:", JSON.stringify(bodyText.replace(/\n/g, "|")));
      const postPromise = page.waitForResponse((r) => r.url().includes("/replace-body") && r.request().method() === "POST", { timeout: 10000 });
      await confirmModal.getByRole("button", { name: /确认更换|确\s*认/ }).click();
      const postResp = await postPromise;
      console.log("[body] POST status:", postResp.status(), (await postResp.text()).slice(0, 200));
      await page.waitForTimeout(1200);
      const bindsAfter = await db.snapshot("b1", "SELECT binding_id, slot_type, part_id, ended_time FROM prop_product_binding WHERE product_id=7 ORDER BY binding_id");
      const sameBinds = JSON.stringify(bindsBefore.rows) === JSON.stringify(bindsAfter.rows);
      console.log("[body] 绑定前后一致:", sameBinds);
      const ev = await db.snapshot("ev", "SELECT event_type, event_content, create_by FROM prop_production_event WHERE product_id=7 ORDER BY event_id DESC LIMIT 1");
      console.log("[body] 最新事件:", JSON.stringify(ev.rows));
      const timeline = await page.locator("section", { hasText: "相关业务历史" }).last().innerText();
      console.log("[body] 历史区含「更换衣体」:", timeline.includes("更换衣体"));
      bodyResult = `POST=${postResp.status()} 绑定不变=${sameBinds} 事件=${JSON.stringify(ev.rows)}`;
    }

    // ---- 5. 阶段提示条（用例-011）----
    let hintInfo = "(跳过)";
    if (apiOk) {
      respPromise = waitDetail();
      await page.goto("/products/6");
      await respPromise;
      await page.waitForTimeout(900);
      const hint6 = await page.locator(".detail-page > .ant-alert").first().innerText().catch(() => "(无)");
      respPromise = waitDetail();
      await page.goto("/products/8");
      await respPromise;
      await page.waitForTimeout(900);
      const hint8 = await page.locator(".detail-page > .ant-alert").first().innerText().catch(() => "(无)");
      hintInfo = `J001=${JSON.stringify(hint6.replace(/\n/g, "|"))} J003=${JSON.stringify(hint8.replace(/\n/g, "|"))}`;
      console.log("[hint] J001(ready):", JSON.stringify(hint6.replace(/\n/g, "|")));
      console.log("[hint] J003(in_progress):", JSON.stringify(hint8.replace(/\n/g, "|")));
    }

    // ---- 6. 非法/不存在 ID（权限-004）----
    await page.goto("/products/abc");
    await page.waitForTimeout(2500);
    const abcResult = await page.locator(".detail-state").innerText().catch(() => "(无 detail-state)");
    const abcHasError = await page.locator(".ant-result").isVisible().catch(() => false);
    console.log("[id] /products/abc 展示:", JSON.stringify(abcResult.replace(/\n/g, "|")), "| 有错误结果页:", abcHasError);
    await page.goto("/products/999999");
    await page.waitForTimeout(2500);
    const notFound = await page.locator(".detail-state").innerText().catch(() => "(无 detail-state)");
    console.log("[id] /products/999999 展示:", JSON.stringify(notFound.replace(/\n/g, "|")));

    console.log("---- VERDICT ----");
    if (!apiOk) {
      console.log(`P0 疑点：产品详情接口异常 status=${detailStatus}，详情页功能整体不可用，需排查（body 见日志）。`);
    } else {
      console.log(labels.length === 7 && !labels.some((l) => l.includes("业务类型"))
        ? `冲突确认 REQ-029：详情基本信息为 7 项（${labels.join("/")}），需求八项中的「业务类型」无展示。`
        : `CHECK 基本信息 labels=${JSON.stringify(labels)}`);
      console.log(tabs.length === 5 && !tabs.some((t) => t.includes("部件与版本"))
        ? `冲突确认 REQ-036：历史页签为 5 个（${tabs.join("/")}），缺需求要求的「部件与版本」页签。`
        : `CHECK 历史页签=${JSON.stringify(tabs)}`);
      console.log(`INFO 生命周期：${lifecycleInfo}`);
      console.log(`INFO 存放路径：${storageResult}`);
      console.log(`INFO 更换衣体：${bodyResult}`);
      console.log(`INFO 阶段提示条：${hintInfo}`);
    }
    console.log(`INFO 非法ID：/products/abc → ${abcHasError ? "错误结果页" : "停留加载态"}；/products/999999 → ${notFound.includes("产品不存在") ? "提示产品不存在" : JSON.stringify(notFound)}`);
    console.log(api500.length ? `API-5xx 巡检命中：${api500.join(" ; ")}` : "API-5xx 巡检：详情方向无 5xx。");
  } finally {
    const tracePath = await closeSession(session, "verify-product-detail");
    console.log("[detail] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[detail] FAILED:", e.message); process.exit(1); });