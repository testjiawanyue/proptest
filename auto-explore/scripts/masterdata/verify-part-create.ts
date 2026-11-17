/**
 * 冲突复验（基础设置-部件资料）：
 *  V5-CONFLICT-001 部件资料-004：传感器规格留空是否可保存（代码要求规格非空）
 *  V5-CONFLICT-002 部件资料-017：同类型名称重复是否可保存（代码无重复检查）
 */
import { chromium, type Page } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";
import { DbProbe } from "../../src/probes/dbProbe.js";

interface CreateResult {
  dialogClosed: boolean;
  fieldErrors: string[];
  toast: string;
  apiStatus?: number;
  apiBody?: string;
}

async function createPartProfile(page: Page, input: { type: string; name: string; spec?: string; maker?: string }): Promise<CreateResult> {
  let apiStatus: number | undefined;
  let apiBody: string | undefined;
  const onResponse = async (response: import("playwright").Response): Promise<void> => {
    if (response.request().method() === "POST" && response.url().includes("/prop/part-profile")) {
      apiStatus = response.status();
      apiBody = (await response.text().catch(() => "")).slice(0, 300);
    }
  };
  page.on("response", (r) => void onResponse(r));

  await page.goto("/prop-settings/part-profile");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "新建部件资料" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });

  await dialog.getByRole("combobox", { name: /部件类型/ }).click();
  await page.locator(".ant-select-item-option", { hasText: input.type }).first().click();

  await dialog.getByRole("textbox", { name: /部件名称/ }).fill(input.name);
  if (input.spec !== undefined) await dialog.getByRole("textbox", { name: /规格/ }).fill(input.spec);
  if (input.maker) await dialog.getByRole("textbox", { name: /厂商/ }).fill(input.maker);

  await dialog.getByRole("button", { name: /确\s*定/ }).click();
  await page.waitForTimeout(2000);

  const dialogClosed = !(await dialog.isVisible().catch(() => false));
  const fieldErrors = await page.locator(".ant-form-item-explain-error").allInnerTexts().catch(() => [] as string[]);
  const toast = await page.locator(".ant-message span").allInnerTexts().then((t) => t.join(" | ")).catch(() => "");
  page.off("response", (r) => void onResponse(r));
  return { dialogClosed, fieldErrors, toast, apiStatus, apiBody };
}

async function main(): Promise<void> {
  const db = new DbProbe();
  await db.connect();
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName: "verify-part-create" });
  const page = session.page;
  try {
    await login(page);

    console.log("== CONFLICT-001 传感器规格留空 ==");
    const emptySpec = await createPartProfile(page, { type: "传感器", name: "AUTO-传感器规格留空验证" });
    console.log(`result: dialogClosed=${emptySpec.dialogClosed} errors=${JSON.stringify(emptySpec.fieldErrors)} toast='${emptySpec.toast}' api=${emptySpec.apiStatus} body='${emptySpec.apiBody}'`);
    const specCheck = await db.snapshot("s", "SELECT COUNT(*) AS cnt FROM prop_part_profile_version WHERE part_name = 'AUTO-传感器规格留空验证'");
    console.log(`db rows with that name: ${JSON.stringify(specCheck.rows)}`);
    if (!emptySpec.dialogClosed && Number(specCheck.rows[0].cnt) === 0) {
      console.log("VERDICT-001: CONFLICT-CONFIRMED —— 规格留空被拒绝保存（用例预期可保存与代码行为相反，应修正用例）");
    } else {
      console.log("VERDICT-001: 需复核（可能允许留空，与静态结论相反）");
    }

    console.log("== CONFLICT-002 同类型名称重复 ==");
    const dupName = "AUTO-重名验证部件";
    const before = await db.snapshot("b", `SELECT COUNT(*) AS cnt FROM prop_part_profile_version WHERE part_name = '${dupName}'`);
    const first = await createPartProfile(page, { type: "衣体", name: dupName, spec: "AUTO-规格X" });
    console.log(`first: dialogClosed=${first.dialogClosed} toast='${first.toast}' api=${first.apiStatus}`);
    const second = await createPartProfile(page, { type: "衣体", name: dupName, spec: "AUTO-规格Y" });
    console.log(`second: dialogClosed=${second.dialogClosed} toast='${second.toast}' api=${second.apiStatus} body='${second.apiBody}'`);
    const after = await db.snapshot("a", `SELECT COUNT(*) AS cnt FROM prop_part_profile_version WHERE part_name = '${dupName}'`);
    console.log(`db version rows named '${dupName}': before=${JSON.stringify(before.rows)} after=${JSON.stringify(after.rows)}`);
    if (first.dialogClosed && second.dialogClosed && Number(after.rows[0].cnt) >= Number(before.rows[0].cnt) + 2) {
      console.log("VERDICT-002: CONFLICT-CONFIRMED —— 同类型同名两次创建均成功，代码无重复检查（用例预期保存失败与代码行为相反）");
    } else if (!second.dialogClosed) {
      console.log("VERDICT-002: NO-CONFLICT —— 第二次被拦截，用例预期成立，静态结论需修正");
    } else {
      console.log("VERDICT-002: UNCONFIRMED —— 需人工查看 Trace");
    }
  } finally {
    const tracePath = await closeSession(session, "verify-part-create");
    console.log("trace:", tracePath);
    await db.close();
    await browser.close();
  }
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });

