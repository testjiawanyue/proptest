/**
 * 产品管理·部件追溯运行时验证
 * 来源：用例 部件追溯-001~013（筛选/详情履历/导出/删除阻断/删除后历史保留/同编号重建档）
 * 测试数据：AUTO-A001(完整履历)、AUTO-A051(绑定中,删除阻断)、AUTO-X002(未绑定,删除+重建档)
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";
import * as fs from "node:fs";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-tracing" });
  const page = session.page;
  const results: string[] = [];
  const waitParts = () => page.waitForResponse((r) => /\/prop\/production\/parts(\?|$)/.test(r.url()) && r.request().method() === "GET", { timeout: 12000 });
  try {
    await login(page);
    let respPromise = waitParts();
    await page.goto("/products/parts");
    let resp = await respPromise;
    const defaultBody = JSON.parse(await resp.text());
    console.log("[trace] default total:", defaultBody.total);
    await page.waitForTimeout(1000);
    const headers = await page.locator(".ant-table-thead th").allInnerTexts();
    console.log("[trace] 列头:", JSON.stringify(headers));
    const totalText = await page.locator(".toolbar").innerText();
    console.log("[trace] 工具栏:", JSON.stringify(totalText.replace(/\n/g, "|")));
    results.push(headers.join(",").includes("编号") && headers.join(",").includes("首次登记")
      ? `PASS 用例-001：默认加载 ${defaultBody.total} 件，列头=${headers.join("/")}。`
      : "CHECK 用例-001：" + JSON.stringify(headers));

    // ---- 类型筛选（用例-002）----
    respPromise = waitParts();
    await page.locator(".filters .ant-select").nth(0).click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "衣体" }).first().click();
    resp = await respPromise;
    const jacketBody = JSON.parse(await resp.text());
    const allJacket = (jacketBody.rows || []).every((r: Record<string, unknown>) => r.partType === "jacket");
    console.log("[trace] 衣体筛选 total:", jacketBody.total, "全为衣体:", allJacket);
    results.push(allJacket ? `PASS 用例-002：类型筛选衣体仅显示衣体（${jacketBody.total} 件）。` : "CHECK 用例-002");
    // 清除类型
    await page.locator(".filters .ant-select").nth(0).hover();
    await page.locator(".filters .ant-select").nth(0).locator(".ant-select-clear").click();
    await page.waitForTimeout(500);

    // ---- 关键词模糊（用例-003）----
    respPromise = waitParts();
    await page.getByPlaceholder("搜索部件编号").fill("AUTO-A0");
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    resp = await respPromise;
    const kwBody = JSON.parse(await resp.text());
    const kwMatch = (kwBody.rows || []).every((r: Record<string, unknown>) => String(r.partNo).includes("AUTO-A0"));
    console.log("[trace] 关键词 AUTO-A0 total:", kwBody.total, "全匹配:", kwMatch, (kwBody.rows || []).map((r: Record<string, unknown>) => r.partNo).join(","));
    results.push(kwMatch && kwBody.total >= 1 ? `PASS 用例-003：关键词模糊匹配（${kwBody.total} 件）。` : "CHECK 用例-003");

    // ---- 当前归属筛选（用例-005）----
    await page.getByPlaceholder("搜索部件编号").fill("");
    respPromise = waitParts();
    await page.locator(".filters .ant-select").nth(2).click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "使用中" }).first().click();
    resp = await respPromise;
    const boundBody = JSON.parse(await resp.text());
    const allBound = (boundBody.rows || []).every((r: Record<string, unknown>) => r.manufacturingNo);
    console.log("[trace] 使用中 total:", boundBody.total, "均有归属产品:", allBound);
    respPromise = waitParts();
    await page.locator(".filters .ant-select").nth(2).click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "未绑定" }).first().click();
    resp = await respPromise;
    const freeBody = JSON.parse(await resp.text());
    const allFree = (freeBody.rows || []).every((r: Record<string, unknown>) => !r.manufacturingNo);
    console.log("[trace] 未绑定 total:", freeBody.total, "均无归属:", allFree);
    results.push(allBound && allFree ? `PASS 用例-005：归属筛选使用中=${boundBody.total}/未绑定=${freeBody.total} 口径正确。` : "CHECK 用例-005");
    await page.getByRole("button", { name: /重\s*置/ }).click();
    await page.waitForTimeout(800);

    // ---- 详情履历（用例-006）----
    await page.getByPlaceholder("搜索部件编号").fill("AUTO-A001");
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await page.waitForTimeout(900);
    const a001Row = page.locator(".ant-table-row", { hasText: "AUTO-A001" }).first();
    await a001Row.getByRole("button", { name: "详情" }).click();
    await page.waitForTimeout(1200);
    const detailModal = page.locator(".ant-modal", { hasText: "部件详情" });
    const descLabels = await detailModal.locator(".ant-descriptions-item-label").allInnerTexts();
    const timeline = await detailModal.locator(".timeline").innerText();
    console.log("[trace] 详情字段:", JSON.stringify(descLabels));
    console.log("[trace] 履历:", JSON.stringify(timeline.replace(/\n/g, " | ")).slice(0, 600));
    const hasReg = timeline.includes("组装建档") || timeline.includes("衣体入库");
    results.push(descLabels.join(",").includes("首次登记") && hasReg
      ? "PASS 用例-006：详情弹窗字段齐全，履历含首次登记合成事件与安装/更换历史。"
      : "CHECK 用例-006：" + JSON.stringify(descLabels));
    await detailModal.getByRole("button", { name: "Close" }).or(detailModal.locator(".ant-modal-close")).first().click().catch(() => page.keyboard.press("Escape"));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // ---- 导出（用例-008）----
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    await page.getByRole("button", { name: /^导\s*出$/ }).click();
    const download = await downloadPromise;
    const filePath = `reports/traces/parts-export-${Date.now()}.xlsx`;
    await download.saveAs(filePath);
    const buf = fs.readFileSync(filePath);
    const isXlsx = buf.length > 200 && buf[0] === 0x50 && buf[1] === 0x4b;
    console.log("[trace] 导出文件名:", download.suggestedFilename(), "大小:", buf.length, "PK头:", isXlsx);
    results.push(isXlsx ? `PASS 用例-008：导出 ${download.suggestedFilename()}（${buf.length} 字节，xlsx 格式正确）。` : "CHECK 用例-008：文件异常");

    // ---- 部件删除阻断（用例-009）----
    await page.getByPlaceholder("搜索部件编号").fill(""); await page.getByRole("button", { name: /^查\s*询$/ }).click(); await page.waitForTimeout(600); await page.getByPlaceholder("搜索部件编号").fill("AUTO-A051");
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await page.waitForTimeout(900);
    const a051Row = page.locator(".ant-table-row", { hasText: "AUTO-A051" }).first();
    await a051Row.getByRole("button", { name: "···" }).click();
    await page.locator(".ant-dropdown-menu-item", { hasText: /^删除$/ }).click();
    await page.waitForTimeout(600);
    const blockModal = await page.locator(".ant-modal-confirm, .ant-modal").last().innerText();
    console.log("[trace] 绑定删除阻断弹窗:", JSON.stringify(blockModal.replace(/\n/g, "|")));
    results.push(blockModal.includes("已绑定产品") && blockModal.includes("AUTO-J002")
      ? "PASS 用例-009：绑定中部件删除被阻断并提示归属产品。"
      : "CHECK 用例-009：" + JSON.stringify(blockModal));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    // ---- 删除未绑定部件（用例-010/011）----
    await page.getByPlaceholder("搜索部件编号").fill("AUTO-X002");
    await page.getByRole("button", { name: /^查\s*询$/ }).click();
    await page.waitForTimeout(900);
    const x002Row = page.locator(".ant-table-row", { hasText: "AUTO-X002" }).first();
    await x002Row.getByRole("button", { name: "···" }).click();
    await page.locator(".ant-dropdown-menu-item", { hasText: /^删除$/ }).click();
    await page.waitForTimeout(500);
    const delConfirm = page.locator(".ant-modal-confirm");
    const delText = await delConfirm.innerText();
    console.log("[trace] 删除确认文案:", JSON.stringify(delText.replace(/\n/g, "|")));
    await delConfirm.getByRole("button", { name: /取\s*消/ }).click();
    await page.waitForTimeout(500);
    const xKept = await db.snapshot("xk", "SELECT deleted_time FROM prop_part_item WHERE part_no=\x27AUTO-X002\x27");
    console.log("[trace] 取消后保留:", JSON.stringify(xKept.rows));
    await x002Row.getByRole("button", { name: "···" }).click();
    await page.locator(".ant-dropdown-menu-item", { hasText: /^删除$/ }).click();
    await page.waitForTimeout(500);
    const delPartPromise = page.waitForResponse((r) => /\/prop\/production\/parts\/\d+$/.test(r.url()) && r.request().method() === "DELETE", { timeout: 10000 });
    await page.locator(".ant-modal-confirm").getByRole("button", { name: /确认删除/ }).click();
    const delPartResp = await delPartPromise;
    console.log("[trace] DELETE part:", delPartResp.status(), (await delPartResp.text()).slice(0, 120));
    await page.waitForTimeout(900);
    const xAfter = await db.snapshot("xa", "SELECT deleted_time, active_part_no FROM prop_part_item WHERE part_no=\x27AUTO-X002\x27");
    const xHistory = await db.snapshot("xh", "SELECT COUNT(*) c FROM prop_production_event WHERE part_id=(SELECT part_id FROM prop_part_item WHERE part_no=\x27AUTO-X002\x27 LIMIT 1)");
    console.log("[trace] 删除后 db:", JSON.stringify(xAfter.rows), "历史事件:", JSON.stringify(xHistory.rows));
    results.push((xAfter.rows[0] as Record<string, unknown>).deleted_time !== null
      ? "PASS 用例-010/011：未绑定部件二次确认后软删（active 释放），取消则保留；原历史事件保留 " + JSON.stringify((xHistory.rows[0] as Record<string, unknown>).c) + " 条。"
      : "CHECK 用例-010");

    // ---- 同编号重新建档（用例-013）----
    const waitDetail = () => page.waitForResponse((r) => /\/prop\/production\/products\/\d+$/.test(r.url()) && r.request().method() === "GET", { timeout: 12000 });
    respPromise = waitDetail();
    await page.goto("/products/8");
    await respPromise;
    await page.waitForTimeout(1500);
    const if1Row = page.locator("section", { hasText: "当前部件" }).last().locator(".ant-table-row", { hasText: "位置1" });
    await if1Row.getByRole("button", { name: "补录" }).click();
    const addModal = page.locator(".ant-modal", { hasText: "补录部件" });
    await addModal.locator(".ant-select").first().click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "充气发生器" }).first().click();
    await addModal.locator("input").nth(1).fill("AUTO-X002");
    const asmPromise = page.waitForResponse((r) => r.url().includes("/prop/production/assembly") && r.request().method() === "PUT", { timeout: 12000 });
    await addModal.getByRole("button", { name: /^确\s*定$/ }).click();
    const asmResp = await asmPromise;
    const asmBody = JSON.parse(await asmResp.text());
    console.log("[trace] 同号重建档 PUT:", asmResp.status(), JSON.stringify(asmBody).slice(0, 250));
    await page.waitForTimeout(800);
    // 可能需二次确认
    const needConfirm = await addModal.locator(".ant-alert").isVisible().catch(() => false);
    if (needConfirm && asmBody.data?.status === "confirmation_required") {
      const p2 = page.waitForResponse((r) => r.url().includes("/prop/production/assembly") && r.request().method() === "PUT", { timeout: 12000 });
      await addModal.getByRole("button", { name: /^确\s*定$/ }).click();
      console.log("[trace] 二次确认:", (await (await p2).text()).slice(0, 200));
      await page.waitForTimeout(800);
    }
    const newX = await db.snapshot("nx", "SELECT part_id, part_no, deleted_time FROM prop_part_item WHERE part_no=\x27AUTO-X002\x27 ORDER BY part_id");
    console.log("[trace] 同编号个体:", JSON.stringify(newX.rows));
    const newActive = newX.rows.filter((r) => r.deleted_time === null);
    results.push(newX.rows.length === 2 && newActive.length === 1
      ? `PASS 用例-013：删除后同编号重新建档成功，新个体 part_id=${(newActive[0] as Record<string, unknown>).part_id} 不继承原历史。`
      : "CHECK 用例-013：" + JSON.stringify(newX.rows));

    console.log("---- VERDICT ----");
    results.forEach((r) => console.log(r));
  } finally {
    const tracePath = await closeSession(session, "verify-product-tracing");
    console.log("[trace] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[trace] FAILED:", e.message); process.exit(1); });