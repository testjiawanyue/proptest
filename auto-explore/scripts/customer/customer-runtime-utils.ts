import { chromium, type Browser, type Locator, type Page } from "playwright";
import mysql from "mysql2/promise";
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "../../src/config/index.js";
import { createSession, closeSession, login } from "../../src/actions/session.js";

export type CaseStatus = "通过" | "不通过" | "部分验证" | "阻塞";

export interface CaseResult {
  caseId: string;
  title: string;
  status: CaseStatus;
  actual: string;
  evidence: string;
  requirement: string;
}

export interface ContactInput {
  contactName: string;
  jobTitle?: string;
  phone?: string;
  fax?: string;
  email?: string;
  note?: string;
}

export interface AddressInput {
  postalCode: string;
  addressLine1: string;
  addressLine2?: string;
  contacts?: ContactInput[];
}

export interface SubjectInput {
  subjectName: string;
  defaultCustomerType?: "direct" | "agency";
  storagePath?: string;
  addresses?: AddressInput[];
}

export class DbClient {
  private conn: mysql.Connection | null = null;

  async connect(): Promise<void> {
    this.conn = await mysql.createConnection({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      namedPlaceholders: true,
    });
  }

  async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.conn) throw new Error("DbClient not connected");
    const [rows] = await this.conn.query(sql, params);
    return rows as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<mysql.ResultSetHeader> {
    if (!this.conn) throw new Error("DbClient not connected");
    const [result] = await this.conn.execute(sql, params);
    return result as mysql.ResultSetHeader;
  }

  async close(): Promise<void> {
    await this.conn?.end();
    this.conn = null;
  }
}

export class ResultBook {
  private results: CaseResult[] = [];

  constructor(private readonly outputPath: string) {}

  async record(result: CaseResult): Promise<void> {
    this.results.push(result);
    console.log(`[${result.caseId}] ${result.status} - ${result.actual}`);
    await this.save();
  }

  async run(
    caseId: string,
    title: string,
    requirement: string,
    check: () => Promise<{ status?: CaseStatus; actual: string; evidence: string }>,
  ): Promise<void> {
    try {
      const outcome = await check();
      await this.record({
        caseId,
        title,
        status: outcome.status ?? "通过",
        actual: outcome.actual,
        evidence: outcome.evidence,
        requirement,
      });
    } catch (error) {
      await this.record({
        caseId,
        title,
        status: "不通过",
        actual: `执行脚本或页面操作异常：${error instanceof Error ? error.message : String(error)}`,
        evidence: "脚本异常；需查看对应 Trace",
        requirement,
      });
    }
  }

  list(): CaseResult[] {
    return [...this.results];
  }

  async save(): Promise<void> {
    await mkdir(this.outputPath.split("/").slice(0, -1).join("/"), { recursive: true });
    await writeFile(this.outputPath, JSON.stringify(this.results, null, 2), "utf-8");
  }
}

export async function launchAdminSession(traceName: string): Promise<{
  browser: Browser;
  session: Awaited<ReturnType<typeof createSession>>;
}> {
  const browser = await chromium.launch({ headless: config.run.headless });
  const session = await createSession(browser, { traceName });
  await login(session.page);
  return { browser, session };
}

export async function finishSession(
  browser: Browser,
  session: Awaited<ReturnType<typeof createSession>>,
  traceName: string,
): Promise<string> {
  const trace = await closeSession(session, traceName);
  await browser.close();
  return trace;
}

export async function openCustomerList(page: Page): Promise<void> {
  await page.goto("/customer");
  await page.locator(".customer-page .ant-table").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
}

export function field(scope: Page | Locator, label: string): Locator {
  return scope.locator(".ant-form-item").filter({ hasText: label }).last();
}

export async function fillField(scope: Page | Locator, label: string, value: string): Promise<void> {
  const item = field(scope, label);
  const control = item.locator("textarea, input").last();
  await control.fill(value);
}

export async function selectField(scope: Page | Locator, label: string, option: string): Promise<void> {
  const item = field(scope, label);
  await item.locator(".ant-select").click();
  const root: Page | Locator = typeof (scope as any).page === "function" ? (scope as Locator).page() : scope;
  const dropdown = root.locator(".ant-select-dropdown:visible").last();
  await dropdown.locator(".ant-select-item-option").filter({ hasText: option }).first().click();
}

export async function searchList(
  page: Page,
  criteria: { keyword?: string; address?: string; contact?: string; customerType?: string },
  trigger: "click" | "enter" = "click",
): Promise<void> {
  await openCustomerList(page);
  if (criteria.keyword !== undefined) await page.getByPlaceholder("顧客番号・会社名・支店／現場名").fill(criteria.keyword);
  if (criteria.address !== undefined) await page.getByPlaceholder("郵便番号・住所").fill(criteria.address);
  if (criteria.contact !== undefined) await page.getByPlaceholder("氏名・電話番号・メール").fill(criteria.contact);
  if (criteria.customerType !== undefined) await selectField(page, "顧客区分", criteria.customerType);
  const response = page.waitForResponse(
    (res) => res.url().includes("/prop/customer/list") && res.request().method() === "GET",
    { timeout: 15000 },
  );
  if (trigger === "enter") await page.getByPlaceholder("顧客番号・会社名・支店／現場名").press("Enter");
  else await page.locator("button").filter({ hasText: "検索" }).first().click();
  await response;
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
}

export async function resetList(page: Page): Promise<void> {
  const response = page.waitForResponse(
    (res) => res.url().includes("/prop/customer/list") && res.request().method() === "GET",
    { timeout: 15000 },
  );
  await page.locator("button").filter({ hasText: "リセット" }).first().click();
  await response;
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
}

export async function tableText(page: Page): Promise<string> {
  return page.locator(".customer-page .ant-table").innerText();
}

export async function tableRowTexts(page: Page): Promise<string[]> {
  return page.locator(".customer-page .ant-table-tbody tr.ant-table-row").allInnerTexts();
}

export async function listToolbarText(page: Page): Promise<string> {
  return page.locator(".customer-page .toolbar").innerText();
}

export async function apiFetch(
  page: Page,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: any; text: string }> {
  const cookies = await page.context().cookies();
  const token = cookies.find((cookie) => cookie.name === "Admin-Token")?.value;
  if (!token) throw new Error("未找到 Admin-Token");
  return page.evaluate(
    async ({ path: requestPath, method, body, token: authToken, apiPrefix }) => {
      const response = await fetch(`${apiPrefix}${requestPath}`, {
        method,
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json;charset=utf-8",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed, text };
    },
    {
      path,
      method: options.method ?? "GET",
      body: options.body,
      token,
      apiPrefix: config.app.apiPrefix,
    },
  );
}

export async function apiListCustomers(
  page: Page,
  criteria: { keyword?: string; address?: string; contact?: string; customerType?: string; pageNum?: number } = {},
): Promise<{ rows: any[]; total: number; rowTotal: number }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(criteria)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  params.set("pageSize", "10");
  const result = await apiFetch(page, `/prop/customer/list?${params.toString()}`);
  return {
    rows: result.body?.rows ?? [],
    total: Number(result.body?.total ?? 0),
    rowTotal: Number(result.body?.rowTotal ?? 0),
  };
}

export function visibleModal(page: Page): Locator {
  return page.locator(".ant-modal:visible").last();
}

export async function saveModal(page: Page): Promise<void> {
  const modal = visibleModal(page);
  await modal.locator(".ant-modal-footer .ant-btn-primary").click();
}

export async function cancelModal(page: Page): Promise<void> {
  const modal = visibleModal(page);
  await modal.locator(".ant-modal-footer button").filter({ hasText: "キャンセル" }).click();
}

export async function formErrors(page: Page): Promise<string> {
  return (await page.locator(".ant-form-item-explain-error:visible").allInnerTexts()).join(" | ");
}

export async function addAddressBlock(modal: Locator): Promise<Locator> {
  await modal.locator("button").filter({ hasText: "住所を追加" }).first().click();
  return modal.locator(".address-block").last();
}

export async function fillAddress(block: Locator, address: AddressInput): Promise<void> {
  await fillField(block, "郵便番号", address.postalCode);
  await fillField(block, "住所1", address.addressLine1);
  if (address.addressLine2 !== undefined) await fillField(block, "住所2", address.addressLine2);
  for (const contact of address.contacts ?? []) {
    await block.locator("button").filter({ hasText: "担当者を追加" }).click();
    const contactBlock = block.locator(".contact-block").last();
    await fillField(contactBlock, "氏名", contact.contactName);
    if (contact.jobTitle !== undefined) await fillField(contactBlock, "役職", contact.jobTitle);
    if (contact.phone !== undefined) await fillField(contactBlock, "電話番号", contact.phone);
    if (contact.fax !== undefined) await fillField(contactBlock, "ファックス", contact.fax);
    if (contact.email !== undefined) await fillField(contactBlock, "メール", contact.email);
    if (contact.note !== undefined) await fillField(contactBlock, "備考", contact.note);
  }
}

export async function fillSubjectForm(modal: Locator, input: SubjectInput): Promise<void> {
  const nameLabel = (await modal.locator(".ant-form-item").filter({ hasText: "会社名" }).count())
    ? "会社名"
    : "支店／現場名";
  await fillField(modal, nameLabel, input.subjectName);
  if (input.defaultCustomerType) await selectField(modal, "標準の顧客区分", input.defaultCustomerType === "agency" ? "代理店" : "直販");
  if (input.storagePath !== undefined) await fillField(modal, "資料の保存先", input.storagePath);
  for (const address of input.addresses ?? []) {
    await fillAddress(await addAddressBlock(modal), address);
  }
}

export async function createCompanyViaUi(page: Page, db: DbClient, input: SubjectInput): Promise<any> {
  await openCustomerList(page);
  await page.locator("button").filter({ hasText: "会社を追加" }).first().click();
  const modal = visibleModal(page);
  await fillSubjectForm(modal, input);
  await saveModal(page);
  await page.waitForURL(/\/customer\/detail\/\d+/, { timeout: 15000 });
  const rows = await db.query<any>(
    "SELECT * FROM prop_customer_subject WHERE subject_name=? ORDER BY subject_id DESC LIMIT 1",
    [input.subjectName],
  );
  return rows[0];
}

export async function openCompanyDetail(page: Page, companyId: number): Promise<void> {
  await page.goto(`/customer/detail/${companyId}`);
  await page.locator(".detail-page").waitFor({ state: "visible", timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
}

export async function createSiteViaUi(page: Page, db: DbClient, companyId: number, input: SubjectInput): Promise<any> {
  await openCompanyDetail(page, companyId);
  await page.locator("button").filter({ hasText: "支店／現場を追加" }).first().click();
  const modal = visibleModal(page);
  await fillSubjectForm(modal, input);
  await saveModal(page);
  await modal.waitFor({ state: "hidden", timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  const rows = await db.query<any>(
    "SELECT * FROM prop_customer_subject WHERE company_id=? AND subject_name=? ORDER BY subject_id DESC LIMIT 1",
    [companyId, input.subjectName],
  );
  return rows[0];
}

export async function insertSubject(db: DbClient, input: SubjectInput & {
  subjectType: "company" | "site";
  companyId?: number;
  customerNo: string;
  createTime: string;
}): Promise<number> {
  const result = await db.execute(
    `INSERT INTO prop_customer_subject
     (subject_type,company_id,customer_no,subject_name,default_customer_type,storage_path,create_by,create_time,remark)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.subjectType,
      input.companyId ?? null,
      input.customerNo,
      input.subjectName,
      input.subjectType === "company" ? input.defaultCustomerType ?? "direct" : null,
      input.storagePath ?? null,
      "AI自动探索",
      input.createTime,
      "客户管理未执行用例运行时验证夹具",
    ],
  );
  return Number(result.insertId);
}

export async function insertAddress(db: DbClient, subjectId: number, input: AddressInput, sortOrder: number, createTime: string): Promise<number> {
  const result = await db.execute(
    `INSERT INTO prop_customer_address
     (subject_id,postal_code,address_line1,address_line2,sort_order,create_by,create_time,remark)
     VALUES (?,?,?,?,?,?,?,?)`,
    [subjectId, input.postalCode, input.addressLine1, input.addressLine2 ?? null, sortOrder, "AI自动探索", createTime, "客户管理未执行用例运行时验证夹具"],
  );
  return Number(result.insertId);
}

export async function insertContact(db: DbClient, addressId: number, input: ContactInput, sortOrder: number, createTime: string, updated = false): Promise<number> {
  const result = await db.execute(
    `INSERT INTO prop_customer_contact
     (address_id,contact_name,job_title,phone,fax,email,note,sort_order,create_by,create_time,update_by,update_time,remark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      addressId,
      input.contactName,
      input.jobTitle ?? null,
      input.phone ?? null,
      input.fax ?? null,
      input.email ?? null,
      input.note ?? null,
      sortOrder,
      "AI自动探索",
      createTime,
      updated ? "AI自动探索" : "",
      updated ? createTime : null,
      "客户管理未执行用例运行时验证夹具",
    ],
  );
  return Number(result.insertId);
}

export function safeText(text: string, max = 300): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

