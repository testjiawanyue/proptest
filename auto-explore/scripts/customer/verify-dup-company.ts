/**
 * 冲突复验：公司名称重复是否被拦截（用例 公司维护-007 / BR-041）
 * 静态结论：代码无唯一性检查 → 与用例预期（拦截）冲突。
 * 本脚本获取运行时证据：连续创建两次同名公司，对比 DB 落库数量。
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { createCompany } from "../../src/actions/customer.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

const TARGET_NAME = "AUTO-重名验证公司";

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const countSql = "SELECT subject_id, customer_no, subject_name FROM prop_customer_subject WHERE subject_name = :name";

  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-dup-company" });

  try {
    await login(session.page);

    const before = await db.snapshot("before", countSql.replace(":name", `'${TARGET_NAME}'`));
    console.log(`[verify] before: ${before.rows.length} row(s) named '${TARGET_NAME}'`);

    console.log("[verify] first create...");
    const first = await createCompany(session.page, { name: TARGET_NAME });
    console.log(`[verify] first: dialogClosed=${first.dialogClosed} api=${first.apiStatus} toast='${first.toastText}' resp=${first.apiResponse}`);

    const afterFirst = await db.snapshot("afterFirst", countSql.replace(":name", `'${TARGET_NAME}'`));

    console.log("[verify] second create (duplicate)...");
    const second = await createCompany(session.page, { name: TARGET_NAME });
    console.log(`[verify] second: dialogClosed=${second.dialogClosed} api=${second.apiStatus} toast='${second.toastText}' resp=${second.apiResponse}`);

    const afterSecond = await db.snapshot("afterSecond", countSql.replace(":name", `'${TARGET_NAME}'`));

    const createdFirst = afterFirst.rows.length - before.rows.length;
    const createdSecond = afterSecond.rows.length - afterFirst.rows.length;
    console.log(`[verify] db rows: before=${before.rows.length} afterFirst=${afterFirst.rows.length} afterSecond=${afterSecond.rows.length}`);

    console.log("---- VERDICT ----");
    if (createdFirst >= 1 && createdSecond >= 1) {
      console.log("CONFLICT-CONFIRMED: 同名公司第二次创建成功落库，代码无唯一性检查。与用例 公司维护-007 预期（拦截）冲突，运行时证据与静态分析一致。");
      console.log("rows:", JSON.stringify(afterSecond.rows));
    } else if (createdFirst >= 1 && createdSecond === 0) {
      console.log("NO-CONFLICT: 第二次创建被拦截，用例预期成立。静态分析结论需要修正。");
    } else {
      console.log("UNCONFIRMED: 首次创建未成功落库，需要检查动作脚本或环境。");
    }
  } finally {
    const tracePath = await closeSession(session, "verify-dup-company");
    console.log("[verify] trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("[verify] FAILED:", e.message); process.exit(1); });
