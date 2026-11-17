import type { Page } from "playwright";
import { assertActionAllowed } from "../guardrails/guardrails.js";

export interface CreateCompanyInput {
  name: string;
  customerType?: "direct" | "agency";
  profilePath?: string;
}

export interface CreateCompanyResult {
  submitted: boolean;
  dialogClosed: boolean;
  toastText?: string;
  apiStatus?: number;
  apiResponse?: string;
}

/** Customer module: create a company via the real UI. Verified against the
 *  running app on 2026-10-19 (dialog 新建公司资料, fields 公司名称/默认客户区分/资料存放路径). */
export async function createCompany(page: Page, input: CreateCompanyInput): Promise<CreateCompanyResult> {
  assertActionAllowed({ kind: "navigate", url: "/customer" });

  let apiStatus: number | undefined;
  let apiResponse: string | undefined;
  const onResponse = async (response: import("playwright").Response): Promise<void> => {
    if (response.request().method() === "POST" && response.url().includes("/prop/customer/company")) {
      apiStatus = response.status();
      apiResponse = (await response.text().catch(() => "")).slice(0, 500);
    }
  };
  page.on("response", (r) => void onResponse(r));

  await page.goto("/customer");
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);

  await page.getByRole("button", { name: "新建公司" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 5000 });

  await dialog.getByRole("textbox", { name: /公司名称/ }).fill(input.name);

  if (input.customerType) {
    const typeText = input.customerType === "direct" ? "直販" : "代理";
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: typeText }).first().click().catch(() => undefined);
  }
  if (input.profilePath) {
    await dialog.getByRole("textbox", { name: "" }).last().fill(input.profilePath).catch(() => undefined);
  }

  await dialog.getByRole("button", { name: /确\s*定/ }).click();
  await page.waitForTimeout(1500);

  const toastText = await page.locator(".ant-message span, .el-message").allInnerTexts()
    .then((texts) => texts.join(" | ").slice(0, 200))
    .catch(() => "");
  const dialogClosed = !(await dialog.isVisible().catch(() => false));

  page.off("response", (r) => void onResponse(r));
  return { submitted: true, dialogClosed, toastText, apiStatus, apiResponse };
}
