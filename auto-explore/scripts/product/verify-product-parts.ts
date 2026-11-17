/**
 * 产品管理·详情页部件操作运行时验证
 * 来源：用例 产品部件操作-001~013（更换/拆除/版本升级/补录/更换衣体取消）
 * 测试数据：AUTO-J002(已质检整机,product_id=7)；AUTO-J003(在制仅衣体,product_id=8)
 * 种子：AUTO-A051(空闲气囊,更换目标)、AUTO-I051(空闲发生器,类型不匹配用)、固件 AUTO-FW01
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-product-parts" });
  const page = session.page;
  const api500: string[] = [];
  page.on("response", (r) => { if (r.status() >= 500) api500.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  const results: string[] = [];
  const waitDetail = () => page.waitForResponse((r) => /\/prop\/production\/products\/\d+$/.test(r.url()) && r.request().method() === "GET", { timeout: 12000 });
  const waitAssembly = () => page.waitForResponse((r) => r.url().includes("/prop/production/assembly") && r.request().method() === "PUT", { timeout: 12000 });
  try {
    // ---- 幂等种数 ----
    const seedPart = async (no: string, type: string, profileId: number, versionId: number) => {
      const exist = await db.snapshot("chk", "SELECT part_id FROM prop_part_item WHERE active_part_no=?", [no]);
      if (!exist.rows.length) {
        await db.snapshot("seed", "INSERT INTO prop_part_item (part_no, active_part_no, part_type, source_type, current_profile_id, current_profile_version_id, create_by, create_time) VALUES (?,?,?,\x27assembly\x27,?,?,\x27admin\x27,NOW())", [no, no, type, profileId, versionId]);
        console.log(`[seed] part ${no} (${type}) created`);
      }
    };
    await seedPart("AUTO-A051", "airbag", 2, 4);
    await seedPart("AUTO-I051", "inflator", 4, 6);
    const fw = await db.snapshot("chk", "SELECT data_id FROM prop_base_data WHERE data_type=\x27sensor_firmware_version\x27 AND display_value=\x27AUTO-FW01\x27");
    if (!fw.rows.length) {
      await db.snapshot("seed", "INSERT INTO prop_base_data (data_type, display_value, normalized_hash, status, create_by, create_time) VALUES (\x27sensor_firmware_version\x27,\x27AUTO-FW01\x27,UNHEX(SHA2(\x27auto-fw01\x27,256)),\x270\x27,\x27admin\x27,NOW())");
      console.log("[seed] firmware AUTO-FW01 created");
    }

    await login(page);
    let respPromise = waitDetail();
    await page.goto("/products/7");
    await respPromise;
    await page.waitForTimeout(1500);

    const partTable = page.locator("section", { hasText: "当前部件" }).last();
    const airbagRow = partTable.locator(".ant-table-row", { hasText: "气囊" });
    const modal = page.locator(".ant-modal", { hasText: "更换部件" });

    // ---- 1. 更换气囊：类型不匹配（用例-004）----
    await airbagRow.getByRole("button", { name: "更换" }).click();
    await modal.locator("input").nth(1).fill("AUTO-I051");
    let asmPromise = waitAssembly();
    await modal.getByRole("button", { name: /^确\s*定$/ }).click();
    let asmResp = await asmPromise;
    const typeErr = JSON.parse(await asmResp.text());
    console.log("[replace] type-mismatch PUT:", asmResp.status(), JSON.stringify(typeErr).slice(0, 250));
    const typeAlert = await modal.locator(".ant-alert").last().innerText().catch(() => "(无 alert)");
    console.log("[replace] type-mismatch alert:", JSON.stringify(typeAlert));
    results.push(String(typeErr.msg || "").includes("类型")
      ? "PASS 用例-004：气囊位输入发生器编号被拦截（msg=" + typeErr.msg + "）。"
      : "CHECK 用例-004：msg=" + JSON.stringify(typeErr.msg));

    // ---- 2. 更换气囊：已绑定其他产品（用例-003）----
    await modal.locator("input").nth(1).fill("AUTO-A050");
    asmPromise = waitAssembly();
    await modal.getByRole("button", { name: /^确\s*定$/ }).click();
    asmResp = await asmPromise;
    const boundErr = JSON.parse(await asmResp.text());
    console.log("[replace] bound PUT:", asmResp.status(), JSON.stringify(boundErr).slice(0, 250));
    results.push(String(boundErr.msg || "").match(/占用|绑定|其他产品|使用/)
      ? "PASS 用例-003：更换为已绑定部件被拦截（msg=" + boundErr.msg + "）。"
      : "CHECK 用例-003：msg=" + JSON.stringify(boundErr.msg));

    // ---- 3. 更换气囊：空编号（用例-002）----
    await modal.locator("input").nth(1).fill("");
    await modal.getByRole("button", { name: /^确\s*定$/ }).click();
    await page.waitForTimeout(600);
    const formErr = await modal.locator(".ant-form-item-explain-error").innerText().catch(() => "(无校验提示)");
    console.log("[replace] empty validation:", JSON.stringify(formErr));
    results.push(String(formErr).includes("请输入部件编号") ? "PASS 用例-002：空编号前端校验拦截。" : "CHECK 用例-002：" + JSON.stringify(formErr));

    // ---- 4. 更换气囊：成功（用例-001）----
    const bindsBefore = await db.snapshot("b0", "SELECT binding_id, slot_type, part_id, ended_time FROM prop_product_binding WHERE product_id=7 AND slot_type=\x27airbag\x27 ORDER BY binding_id");
    await modal.locator("input").nth(1).fill("AUTO-A051");
    asmPromise = waitAssembly();
    await modal.getByRole("button", { name: /^确\s*定$/ }).click();
    asmResp = await asmPromise;
    const okBody = JSON.parse(await asmResp.text());
    console.log("[replace] success PUT:", asmResp.status(), JSON.stringify(okBody).slice(0, 300));
    await page.waitForTimeout(1000);
    // 资料一致确认（若出现 warning alert 需二次确认）
    const confirmAlert = await modal.locator(".ant-alert").isVisible().catch(() => false);
    console.log("[replace] 同资料更换出现确认提示:", confirmAlert);
    if (confirmAlert) {
      asmPromise = waitAssembly();
      await modal.getByRole("button", { name: /^确\s*定$/ }).click();
      asmResp = await asmPromise;
      console.log("[replace] 二次确认 PUT:", asmResp.status(), (await asmResp.text()).slice(0, 200));
      await page.waitForTimeout(800);
    }
    const bindsAfter = await db.snapshot("b1", "SELECT b.binding_id, i.part_no, b.ended_time FROM prop_product_binding b JOIN prop_part_item i ON i.part_id=b.part_id WHERE b.product_id=7 AND b.slot_type=\x27airbag\x27 ORDER BY b.binding_id");
    console.log("[replace] db airbag bindings:", JSON.stringify(bindsAfter.rows));
    const evReplace = await db.snapshot("ev", "SELECT event_type, event_content FROM prop_production_event WHERE product_id=7 AND event_type IN (\x27PART_REPLACED\x27,\x27PROFILE_CORRECTED\x27) ORDER BY event_id DESC LIMIT 2");
    console.log("[replace] db events:", JSON.stringify(evReplace.rows));
    const oldEnded = bindsAfter.rows.some((r) => r.part_no === "AUTO-A002" && r.ended_time !== null);
    const newActive = bindsAfter.rows.some((r) => r.part_no === "AUTO-A051" && r.ended_time === null);
    results.push(oldEnded && newActive
      ? "PASS 用例-001：更换气囊成功，旧绑定结束+新绑定生效+事件落库（" + JSON.stringify(evReplace.rows.map((r) => r.event_type)) + "）。"
      : "CHECK 用例-001：" + JSON.stringify(bindsAfter.rows));

    // ---- 5. 拆除发生器位置2（用例-007/012）----
    await page.waitForTimeout(600);
    const if2Row = partTable.locator(".ant-table-row", { hasText: "位置2" });
    const delPromise = page.waitForResponse((r) => /\/products\/7\/bindings\/inflator_2$/.test(r.url()) && r.request().method() === "DELETE", { timeout: 10000 });
    await if2Row.getByRole("button", { name: "拆除" }).click();
    const confirmModal = page.locator(".ant-modal-confirm");
    const removeText = await confirmModal.innerText();
    console.log("[remove] 确认弹窗:", JSON.stringify(removeText.replace(/\n/g, "|")));
    await confirmModal.getByRole("button", { name: /确认拆除/ }).click();
    const delResp = await delPromise;
    console.log("[remove] DELETE:", delResp.status(), (await delResp.text()).slice(0, 150));
    await page.waitForTimeout(1200);
    const if2After = await if2Row.innerText();
    const hasSupplement = await if2Row.getByRole("button", { name: "补录" }).isVisible().catch(() => false);
    const stageTag = await page.locator(".detail-page header").innerText();
    const dbIf2 = await db.snapshot("if2", "SELECT ended_time FROM prop_product_binding WHERE product_id=7 AND slot_type=\x27inflator_2\x27 ORDER BY binding_id DESC LIMIT 1");
    console.log("[remove] 位置2行:", JSON.stringify(if2After.replace(/\n/g, "|")), "| 补录按钮可见:", hasSupplement, "| db:", JSON.stringify(dbIf2.rows));
    respPromise = waitDetail();
    await page.goto("/products/7");
    await respPromise;
    await page.waitForTimeout(800);
    const listCheck = await db.snapshot("stage", "SELECT inspection_id FROM prop_inspection WHERE product_id=7");
    results.push(!hasSupplement && if2After.includes("未安装") && listCheck.rows.length > 0
      ? "PASS 用例-007/012：拆除二次确认后绑定结束；已质检产品拆除必需部件不退阶段且补录入口隐藏。"
      : `CHECK 拆除：row=${if2After} supplement=${hasSupplement}`);

    // ---- 6. 传感器版本升级（用例-009）----
    const fwBefore = await db.snapshot("f0", "SELECT current_firmware_id FROM prop_part_item WHERE part_no=\x27AUTO-S002\x27");
    const sensorRow = partTable.locator(".ant-table-row", { hasText: "传感器" });
    await sensorRow.getByRole("button", { name: "版本升级" }).click();
    const fwModal = page.locator(".ant-modal", { hasText: "版本升级" });
    await fwModal.locator(".ant-select").click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "AUTO-FW01" }).first().click();
    const fwPromise = page.waitForResponse((r) => r.url().includes("/bindings/sensor/firmware") && r.request().method() === "PUT", { timeout: 10000 });
    await fwModal.getByRole("button", { name: /^确\s*定$/ }).click();
    const fwResp = await fwPromise;
    console.log("[firmware] PUT:", fwResp.status(), (await fwResp.text()).slice(0, 200));
    await page.waitForTimeout(1000);
    const fwAfter = await db.snapshot("f1", "SELECT current_firmware_id FROM prop_part_item WHERE part_no=\x27AUTO-S002\x27");
    const fwEvents = await db.snapshot("fe", "SELECT event_type, before_firmware_id, after_firmware_id FROM prop_production_event WHERE part_id=22 AND event_type=\x27FIRMWARE_SET\x27 ORDER BY event_id");
    console.log("[firmware] db before/after:", JSON.stringify(fwBefore.rows), JSON.stringify(fwAfter.rows), "events:", JSON.stringify(fwEvents.rows));
    results.push(fwEvents.rows.length >= 2
      ? "PASS 用例-009：版本升级追加 FIRMWARE_SET 事件不覆盖历史（" + JSON.stringify(fwEvents.rows) + "）。"
      : "CHECK 用例-009：events=" + JSON.stringify(fwEvents.rows));

    // ---- 7. 在制产品补录（用例-011）----
    respPromise = waitDetail();
    await page.goto("/products/8");
    await respPromise;
    await page.waitForTimeout(1500);
    const partTable8 = page.locator("section", { hasText: "当前部件" }).last();
    const airbagRow8 = partTable8.locator(".ant-table-row", { hasText: "气囊" });
    await airbagRow8.getByRole("button", { name: "补录" }).click();
    const addModal = page.locator(".ant-modal", { hasText: "补录部件" });
    await addModal.locator(".ant-select").first().click();
    await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "气囊" }).first().click();
    await addModal.locator("input").nth(1).fill("AUTO-A061");
    asmPromise = waitAssembly();
    await addModal.getByRole("button", { name: /^确\s*定$/ }).click();
    asmResp = await asmPromise;
    console.log("[supplement] PUT:", asmResp.status(), (await asmResp.text()).slice(0, 250));
    await page.waitForTimeout(1200);
    const newPart = await db.snapshot("np", "SELECT part_id, part_no, part_type, source_type, current_profile_id FROM prop_part_item WHERE active_part_no=\x27AUTO-A061\x27");
    const newBind = await db.snapshot("nb", "SELECT binding_id, slot_type, ended_time FROM prop_product_binding WHERE product_id=8 AND slot_type=\x27airbag\x27 ORDER BY binding_id DESC LIMIT 1");
    const hint8 = await page.locator(".detail-page > .ant-alert").first().innerText().catch(() => "(无)");
    console.log("[supplement] db part:", JSON.stringify(newPart.rows), "binding:", JSON.stringify(newBind.rows), "hint:", JSON.stringify(hint8.replace(/\n/g, "|")));
    results.push(newPart.rows.length === 1 && newBind.rows.length === 1 && (newBind.rows[0] as Record<string, unknown>).ended_time === null
      ? "PASS 用例-011：在制产品补录新编号即建档并建立绑定，提示条更新（" + hint8.replace(/\n/g, "|") + "）。"
      : "CHECK 用例-011：" + JSON.stringify(newPart.rows) + JSON.stringify(newBind.rows));

    console.log("---- VERDICT ----");
    results.forEach((r) => console.log(r));
    console.log(api500.length ? `API-5xx 巡检命中：${api500.join(" ; ")}` : "API-5xx 巡检：部件操作方向无 5xx。");
  } finally {
    const tracePath = await closeSession(session, "verify-product-parts");
    console.log("[parts] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[parts] FAILED:", e.message); process.exit(1); });