/**
 * 客户管理未执行用例运行时验证 - 第三批：详情跳转(8) + 联动(2) + 权限(5) + 主体选择(4) + 回归(4)
 * 依据：测试用例汇总_V5.xlsx 客户管理工作表；静态结论 BR-019~BR-025、BR-069~BR-076
 * 运行：npx tsx scripts/verify-customer-cross-permission.ts
 */
import { chromium } from "playwright";
import { config } from "../../src/config/index.js";
import { createSession, closeSession } from "../../src/actions/session.js";
import {
  DbClient, ResultBook, launchAdminSession, finishSession, openCustomerList, openCompanyDetail,
  searchList, apiFetch, insertAddress, insertContact, createCompanyViaUi, createSiteViaUi,
  visibleModal, saveModal, fillField, safeText,
} from "./customer-runtime-utils.js";

const REQ = "FEAT-01-customer / spec 顧客管理";
const book = new ResultBook("reports/customer-runtime-results-cross-permission.json");
const db = new DbClient();

let compA = 0, compB = 0, compC = 0, siteA1 = 0;
let ryUserId = 0;

async function resolveFixtures(): Promise<void> {
  const by = async (no: string) => Number((await db.query<any>("SELECT subject_id FROM prop_customer_subject WHERE customer_no=?", [no]))[0]?.subject_id ?? 0);
  compA = await by("NS-0001"); compB = await by("NS-0002"); compC = await by("NS-0003"); siteA1 = await by("NS-9001");
  if (!compA || !compB || !compC || !siteA1) throw new Error("FX 夹具缺失，请先运行 verify-customer-query-maintenance.ts");
  // 联系人更新时间尾夹具：给西日本地址追加一个“已更新”联系人
  const addrB = (await db.query<any>("SELECT address_id FROM prop_customer_address WHERE subject_id=? LIMIT 1", [compB]))[0].address_id;
  const dupRg = await db.query<any>("SELECT contact_id FROM prop_customer_contact WHERE contact_name='RG 連絡' AND address_id=?", [addrB]);
  if (!dupRg.length) await insertContact(db, addrB, { contactName: "RG 連絡", phone: "06-1111-2222" }, 9, "2026-10-21 12:00:00");
  // 高崎現場：无联系人地址 + 时间尾对照联系人（新規=登録日 / 更新=最終更新日）
  const siteA2 = await by("NS-9002");
  const emptyAddr = (await db.query<any>("SELECT address_id FROM prop_customer_address WHERE subject_id=? AND postal_code='3730001'", [siteA2]))[0]?.address_id;
  if (!emptyAddr) await insertAddress(db, siteA2, { postalCode: "3730001", addressLine1: "群馬県高崎市空連絡先住所" }, 0, "2026-10-20 12:30:00");
  let dtAddr = (await db.query<any>("SELECT address_id FROM prop_customer_address WHERE subject_id=? AND postal_code='3730002'", [siteA2]))[0]?.address_id;
  if (!dtAddr) dtAddr = await insertAddress(db, siteA2, { postalCode: "3730002", addressLine1: "群馬県高崎市DT対照住所" }, 1, "2026-10-20 12:40:00");
  const dupNew = await db.query<any>("SELECT contact_id FROM prop_customer_contact WHERE contact_name='DT 新規' AND address_id=?", [dtAddr]);
  if (!dupNew.length) await insertContact(db, dtAddr, { contactName: "DT 新規", phone: "027-000-0001" }, 1, "2026-10-20 13:00:00");
  const dupUpd = await db.query<any>("SELECT contact_id FROM prop_customer_contact WHERE contact_name='DT 更新' AND address_id=?", [dtAddr]);
  if (!dupUpd.length) await insertContact(db, dtAddr, { contactName: "DT 更新", phone: "027-000-0002" }, 2, "2026-10-20 13:00:00", true);
  console.log("[夹具] DT 夹具就绪", JSON.stringify({ compA, compB, compC, siteA1 }));
}

async function ensureLimitedUser(page: any): Promise<void> {
  const existing = await db.query<any>("SELECT user_id FROM sys_user WHERE user_name='autocust'");
  if (existing.length) { ryUserId = existing[0].user_id; return; }
  const r = await apiFetch(page, "/system/user", { method: "POST", body: {
    userName: "autocust", nickName: "自动权限验证", password: "Auto@123456",
    deptId: 105, roleIds: [2], status: "0", phonenumber: "15800000099", email: "autocust@test.local",
  }});
  const after = await db.query<any>("SELECT user_id FROM sys_user WHERE user_name='autocust'");
  ryUserId = after[0]?.user_id ?? 0;
  console.log("[用户] autocust 创建结果 code=", r.body?.code, "userId=", ryUserId);
}

async function loginAs(page: any, user: string, pass: string): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder(/账号|用户名|user|アカウント/i).first().fill(user);
  await page.getByPlaceholder(/密码|password|パスワード/i).first().fill(pass);
  await page.getByRole("button", { name: /登\s*录|登录|login|ログイン/i }).first().click();
  await page.waitForURL((url: URL) => !url.pathname.includes("/login"), { timeout: 15000 });
}

async function main(): Promise<void> {
  await db.connect();
  const { browser, session } = await launchAdminSession("customer-cross-permission");
  const page = session.page;
  try {
    await resolveFixtures();
    await ensureLimitedUser(page);

    // ============ 六、客户详情与跳转 ============
    await book.run("客户详情跳转-001", "从列表查看详情跳转正确", REQ, async () => {
      await openCustomerList(page);
      await searchList(page, { keyword: "NS-9001" });
      const siteRow = page.locator("tr.ant-table-row").filter({ hasText: "群馬営業所" }).first();
      await siteRow.locator("button").filter({ hasText: "表示" }).click();
      await page.waitForURL(/\/customer\/detail\/\d+/, { timeout: 10000 });
      const url1 = page.url();
      await openCustomerList(page);
      await searchList(page, { keyword: "NSロジ東日本" });
      const companyRow = page.locator("tr.ant-table-row").filter({ hasText: "NSロジ東日本" }).first();
      await companyRow.locator("button").filter({ hasText: "表示" }).click();
      await page.waitForURL(/\/customer\/detail\/\d+/, { timeout: 10000 });
      const url2 = page.url();
      const ok = url1.includes(`/customer/detail/${compA}`) && url2.includes(`/customer/detail/${compA}`);
      return { status: ok ? "通过" : "不通过", actual: `支店行「表示」跳转所属公司详情（${url1}）；公司行「表示」跳转公司详情（${url2}）`, evidence: "BR-017 支店跳父公司" };
    });

    await book.run("客户详情跳转-002", "详情页返回列表位置正确", REQ, async () => {
      await openCompanyDetail(page, compA);
      await page.locator('button[aria-label="顧客一覧に戻る"]').first().click();
      await page.waitForURL(/\/customer$/, { timeout: 10000 });
      await page.locator(".customer-page .ant-table").waitFor({ state: "visible", timeout: 10000 });
      const ok = page.url().endsWith("/customer");
      return { status: ok ? "通过" : "不通过", actual: `详情页「顧客一覧に戻る」返回客户列表页（${page.url()}），列表正常渲染`, evidence: "detail.vue back" };
    });

    await book.run("客户详情跳转-003", "详情页公司信息展示正确", REQ, async () => {
      await openCompanyDetail(page, compA);
      const text = (await page.locator(".detail-page").innerText()).replace(/\s+/g, "");
      const ok = text.includes("NS-0001") && text.includes("株式会社NSロジ東日本") && text.includes("直販");
      const pathOk = text.includes("fileserver") && text.includes("nslogi-east");
      return { status: ok && pathOk ? "通过" : "不通过", actual: "公司信息卡展示顧客番号/会社名/標準の顧客区分(直販)/資料の保存先，与DB一致", evidence: "detail.vue SubjectCard" };
    });

    await book.run("客户详情跳转-004", "详情页地址与联系人展示正确", REQ, async () => {
      await openCompanyDetail(page, compA);
      const text = (await page.locator(".detail-page").innerText()).replace(/\s+/g, "");
      const ok = text.includes("〒371-0817") && text.includes("群馬県前橋市文京町1-1AUTO") && text.includes("NSロジビル3F") && text.includes("松井健太") && text.includes("部長");
      return { status: ok ? "通过" : "不通过", actual: "地址卡展示〒371-0817+地址1+地址2，联系人卡展示松井健太/部長", evidence: "Addresses/ContactView组件" };
    });

    await book.run("客户详情跳转-005", "详情页支店卡片展示正确", REQ, async () => {
      await openCompanyDetail(page, compA);
      const cards = page.locator(".subject-card");
      const count = await cards.count();
      const siteCard = cards.filter({ hasText: "群馬営業所" }).first();
      const siteText = (await siteCard.innerText()).replace(/\s+/g, "");
      const ok = count >= 3 && siteText.includes("支店／現場") && siteText.includes("NS-9001") && !siteText.includes("直販") && !siteText.includes("代理店");
      return { status: ok ? "通过" : "不通过", actual: `详情页共${count}张主体卡（公司1+支店2），支店卡展示编号NS-9001且无客户区分标签`, evidence: "BR-022 支店不显示区分" };
    });

    await book.run("客户详情跳转-006", "联系人描述表格六字段常显", REQ, async () => {
      await openCompanyDetail(page, compA);
      const contact = page.locator(".contact-view").filter({ hasText: "松井 健太" }).first();
      const text = (await contact.innerText()).replace(/\s+/g, "");
      const fields = ["役職", "電話番号", "ファックス", "メール", "備考"];
      const hasAll = fields.every((f) => text.includes(f));
      const hasDate = text.includes("登録日") || text.includes("最終更新日");
      return { status: hasAll && hasDate ? "通过" : "不通过", actual: `联系人描述表常显6字段：役職/電話番号/ファックス/メール/備考/日期标签（空值以—占位）`, evidence: "ContactView Descriptions" };
    });

    await book.run("客户详情跳转-007", "联系人时间尾按创建或更新展示", REQ, async () => {
      await openCompanyDetail(page, compA);
      const siteCard = page.locator(".subject-card").filter({ hasText: "高崎現場" }).first();
      const createdText = (await siteCard.locator(".contact-view").filter({ hasText: "DT 新規" }).first().innerText()).replace(/\s+/g, "");
      const updatedText = (await siteCard.locator(".contact-view").filter({ hasText: "DT 更新" }).first().innerText()).replace(/\s+/g, "");
      const ok = createdText.includes("登録日") && !createdText.includes("最終更新日") && updatedText.includes("最終更新日");
      return { status: ok ? "通过" : "不通过", actual: `未更新联系人(DT 新規)显示「登録日」；有更新的(DT 更新)显示「最終更新日」`, evidence: "detail.vue ContactView updateTime优先" };
    });

    await book.run("客户详情跳转-008", "空地址与空联系人状态", REQ, async () => {
      await openCompanyDetail(page, compC);
      const emptyText = (await page.locator(".detail-page").innerText()).replace(/\s+/g, "");
      const emptyOk = emptyText.includes("住所の登録なし");
      await openCompanyDetail(page, compA);
      const siteCard = page.locator(".subject-card").filter({ hasText: "高崎現場" }).first();
      const siteText = (await siteCard.innerText()).replace(/\s+/g, "");
      const noContactOk = siteText.includes("担当者の登録なし");
      return { status: emptyOk && noContactOk ? "通过" : "不通过", actual: `无地址主体显示「住所の登録なし」；有地址无联系人显示「担当者の登録なし」`, evidence: "empty.addresses/empty.contacts" };
    });

    // ============ 七、关联业务联动 ============
    await book.run("客户联动跳转-001", "从详情页跳转订单管理并自动搜索", REQ, async () => {
      await openCompanyDetail(page, compA);
      const row = page.locator(".related-row").filter({ hasText: "注文管理" }).first();
      await row.locator("a,button,span").filter({ hasText: "表示" }).first().click();
      await page.waitForURL(/\/orders\/index/, { timeout: 10000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
      const url = decodeURIComponent(page.url());
      const ok = url.includes("/orders/index") && url.includes("keyword=") && url.includes("NSロジ東日本");
      return { status: ok ? "通过" : "不通过", actual: `点击注文管理「表示」跳转 ${safeText(url, 120)}，自动携带公司名关键词搜索`, evidence: "detail.vue openRelated" };
    });

    await book.run("客户联动跳转-004", "无关联业务数据时跳转结果正确", REQ, async () => {
      await openCompanyDetail(page, compC);
      const row = page.locator(".related-row").filter({ hasText: "注文管理" }).first();
      await row.locator("a,button,span").filter({ hasText: "表示" }).first().click();
      await page.waitForURL(/\/orders\/index/, { timeout: 10000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
      await page.waitForTimeout(1500);
      const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, "");
      const url = decodeURIComponent(page.url());
      const ok = url.includes("keyword=") && url.includes("空会社") && bodyText.includes("データがありません");
      return { status: ok ? "通过" : "不通过", actual: `无业务的空会社跳转订单管理：URL自动携带公司名关键词（${safeText(url, 110)}），列表显示「データがありません」空结果`, evidence: "orders list empty state" };
    });

    // ============ 九、权限与异常访问 ============
    await book.run("客户权限-001", "未登录直接访问客户列表页", REQ, async () => {
      const ctx = await browser.newContext({ baseURL: config.app.baseUrl });
      const p2 = await ctx.newPage();
      await p2.goto("/customer");
      await p2.waitForTimeout(2000);
      const url = p2.url();
      await ctx.close();
      const ok = url.includes("/login");
      return { status: ok ? "通过" : "不通过", actual: `未登录访问 /customer 被重定向到登录页（${url}）`, evidence: "路由守卫" };
    });

    await book.run("客户权限-002", "未登录直接访问客户详情页", REQ, async () => {
      const ctx = await browser.newContext({ baseURL: config.app.baseUrl });
      const p2 = await ctx.newPage();
      await p2.goto(`/customer/detail/${compA}`);
      await p2.waitForTimeout(2000);
      const url = p2.url();
      await ctx.close();
      const ok = url.includes("/login");
      return { status: ok ? "通过" : "不通过", actual: `未登录访问详情页被重定向到登录页（${url}）`, evidence: "路由守卫" };
    });

    await book.run("客户权限-003", "无客户管理权限角色访问被拒绝", REQ, async () => {
      const ctx = await browser.newContext({ baseURL: config.app.baseUrl, locale: "zh-CN" });
      const p2 = await ctx.newPage();
      await loginAs(p2, "autocust", "Auto@123456");
      await p2.waitForTimeout(1500);
      const menuText = await p2.locator("body").innerText();
      const noMenu = !menuText.includes("顧客管理");
      await p2.goto("/customer");
      await p2.waitForTimeout(2500);
      const afterText = await p2.locator("body").innerText();
      const denied = afterText.includes("401") || afterText.includes("403") || afterText.includes("権限") || afterText.includes("権限がありません") || !afterText.includes("番号・名称");
      await ctx.close();
      const ok = noMenu && denied;
      return { status: ok ? "通过" : "不通过", actual: `无权限用户(普通角色)：菜单不显示顧客管理=${noMenu}；直接访问/customer 被拒=${denied}`, evidence: "role_id=2 无 menu 2000/2001" };
    });

    await book.run("客户权限-004", "无权限用户不能新建编辑删除客户数据", REQ, async () => {
      const ctx = await browser.newContext({ baseURL: config.app.baseUrl, locale: "zh-CN" });
      const p2 = await ctx.newPage();
      await loginAs(p2, "autocust", "Auto@123456");
      const list = await apiFetch(p2, "/prop/customer/list?pageNum=1&pageSize=10");
      const create = await apiFetch(p2, "/prop/customer/company", { method: "POST", body: { subjectName: "AUTO-CUST-HACK 越权会社", defaultCustomerType: "direct", addresses: [] } });
      const update = await apiFetch(p2, `/prop/customer/${compA}`, { method: "PUT", body: { subjectName: "HACK" } });
      const del = await apiFetch(p2, `/prop/customer/site/${siteA1}`, { method: "DELETE" });
      await ctx.close();
      const codes = [list.body?.code, create.body?.code, update.body?.code, del.body?.code];
      const ok = codes.every((c) => c === 403);
      const hack = await db.query<any>("SELECT * FROM prop_customer_subject WHERE subject_name LIKE 'AUTO-CUST-HACK%'");
      return { status: ok && hack.length === 0 ? "通过" : "不通过", actual: `无权限用户调用 列表/新建/编辑/删除 接口均返回403（${codes.join(",")}），DB无越权写入`, evidence: "BR-001/026/044/064 @PreAuthorize" };
    });

    await book.run("客户权限-005", "非法客户ID访问详情页", REQ, async () => {
      await page.goto("/customer/detail/999999");
      await page.waitForTimeout(2500);
      const t1 = await page.locator("body").innerText();
      const notFound = t1.includes("顧客情報を読み込めない") || t1.includes("顧客情報を確認できない");
      let apiCalls = 0;
      const listener = (req: any) => { if (req.url().includes("/dev-api/prop/customer/") && req.method() === "GET") apiCalls++; };
      page.on("request", listener);
      await page.goto("/customer/detail/abc");
      await page.waitForTimeout(2000);
      page.off("request", listener);
      const t2 = await page.locator("body").innerText();
      const invalid = t2.includes("顧客情報を読み込めない") || t2.includes("顧客情報を表示できない");
      const ok = notFound && invalid && apiCalls === 0;
      return { status: ok ? "通过" : "不通过", actual: `不存在ID：显示读取失败提示；非数字ID：前端直接提示「顧客情報を表示できない」且未调用后端（API=${apiCalls}次）`, evidence: "BR-020/023" };
    });

    // ============ 十、客户主体选择 ============
    await book.run("客户主体选择-001", "选择公司主体", REQ, async () => {
      await page.goto("/orders/new");
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
      await page.locator("#orderForm_ordering").click();
      const modal = visibleModal(page);
      await modal.waitFor({ state: "visible" });
      await modal.locator(".ant-tree-title").filter({ hasText: "NSロジ東日本" }).first().click();
      await page.waitForTimeout(1200);
      const preview = (await modal.locator(".preview-panel").innerText()).replace(/\s+/g, "");
      const okBtn = modal.locator(".ant-modal-footer .ant-btn-primary");
      const okText = (await okBtn.innerText()).replace(/\s+/g, "");
      await okBtn.click();
      await page.waitForTimeout(800);
      const fieldVal = (await page.locator("#orderForm_ordering").innerText()).replace(/\s+/g, "");
      const ok = preview.includes("会社") && preview.includes("NS-0001") && okText.includes("NSロジ東日本") && fieldVal.includes("NSロジ東日本");
      return { status: ok ? "通过" : "不通过", actual: `选择公司主体：预览显示会社/NS-0001，确认后注文者字段回填「${safeText(fieldVal, 40)}」`, evidence: "BR-073/075" };
    });

    await book.run("客户主体选择-002", "选择支店主体", REQ, async () => {
      await page.goto("/orders/new");
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
      await page.locator("#orderForm_ordering").click();
      const modal = visibleModal(page);
      await modal.locator(".ant-tree-title").filter({ hasText: "群馬営業所" }).first().click();
      await page.waitForTimeout(1200);
      const preview = (await modal.locator(".preview-panel").innerText()).replace(/\s+/g, "");
      await modal.locator(".ant-modal-footer .ant-btn-primary").click();
      await page.waitForTimeout(800);
      const fieldVal = (await page.locator("#orderForm_ordering").innerText()).replace(/\s+/g, "");
      const ok = preview.includes("支店／現場") && preview.includes("所属会社") && fieldVal.includes("群馬営業所");
      return { status: ok ? "通过" : "不通过", actual: `选择支店主体：预览显示支店／現場与所属会社，确认后回填「${safeText(fieldVal, 50)}」`, evidence: "selector preview site" };
    });

    await book.run("客户主体选择-003", "主体选择器搜索", REQ, async () => {
      await page.goto("/orders/new");
      await page.locator("#orderForm_ordering").click();
      const modal = visibleModal(page);
      await modal.getByPlaceholder("会社名・支店名・番号で検索").fill("西日本");
      await modal.locator(".ant-input-search button").click();
      await page.waitForTimeout(1200);
      const treeText = (await modal.locator(".tree-scroll").innerText()).replace(/\s+/g, "");
      const ok = treeText.includes("西日本") && !treeText.includes("東日本") && !treeText.includes("空会社");
      await modal.locator(".ant-modal-footer button").filter({ hasText: "キャンセル" }).click();
      return { status: ok ? "通过" : "不通过", actual: `选择器搜索「西日本」：树仅保留命中公司（${safeText(treeText, 60)}）`, evidence: "BR-070" };
    });

    await book.run("客户主体选择-004", "选择动作不修改客户主档", REQ, async () => {
      const snap = async () => {
        const s = await db.query<any>("SELECT COUNT(*) c, COALESCE(SUM(COALESCE(update_time, create_time) > '2026-10-27'),0) u FROM prop_customer_subject");
        const a = await db.query<any>("SELECT COUNT(*) c FROM prop_customer_address");
        const ct = await db.query<any>("SELECT COUNT(*) c FROM prop_customer_contact");
        return `${s[0].c}/${a[0].c}/${ct[0].c}`;
      };
      const before = await snap();
      await page.goto("/orders/new");
      await page.locator("#orderForm_ordering").click();
      const modal = visibleModal(page);
      await modal.locator(".ant-tree-title").filter({ hasText: "NSロジ西日本" }).first().click();
      await page.waitForTimeout(1200);
      await modal.locator(".ant-modal-footer .ant-btn-primary").click();
      await page.waitForTimeout(800);
      const after = await snap();
      const ok = before === after;
      return { status: ok ? "通过" : "不通过", actual: `选择主体前后主档三表行数不变（${before}→${after}），选择只发事件不写主档`, evidence: "BR-075" };
    });

    // ============ 十一、跨页面回归与边界 ============
    await book.run("客户回归-001", "主档维护完整闭环", REQ, async () => {
      const company = await createCompanyViaUi(page, db, { subjectName: "AUTO-CUST-RG 闭环会社" });
      const site = await createSiteViaUi(page, db, company.subject_id, { subjectName: "AUTO-CUST-RG 闭环支店" });
      await openCompanyDetail(page, company.subject_id);
      const card = page.locator(".subject-card").filter({ hasText: "AUTO-CUST-RG 闭环支店" }).first();
      await card.locator("button").filter({ hasText: "編集" }).click();
      const modal = visibleModal(page);
      await fillField(modal, "支店／現場名", "AUTO-CUST-RG 闭环支店-改");
      await saveModal(page);
      await page.locator(".ant-modal:visible").waitFor({ state: "hidden", timeout: 15000 }).catch(() => undefined);
      const renamed = (await db.query<any>("SELECT subject_name FROM prop_customer_subject WHERE subject_id=?", [site.subject_id]))[0].subject_name;
      await openCompanyDetail(page, company.subject_id);
      const card2 = page.locator(".subject-card").filter({ hasText: "闭环支店-改" }).first();
      await card2.locator("button").filter({ hasText: "削除" }).click();
      const confirm = page.locator(".ant-modal-confirm:visible");
      await confirm.waitFor({ state: "visible", timeout: 8000 });
      await confirm.locator(".ant-modal-confirm-btns button").last().click();
      await page.waitForTimeout(1200);
      const deleted = (await db.query<any>("SELECT COUNT(*) c FROM prop_customer_subject WHERE subject_id=?", [site.subject_id]))[0].c;
      await openCustomerList(page);
      await searchList(page, { keyword: "闭环会社" });
      const texts = await page.locator(".customer-page .ant-table").innerText();
      const ok = renamed.includes("改") && Number(deleted) === 0 && texts.includes("AUTO-CUST-RG 闭环会社");
      return { status: ok ? "通过" : "不通过", actual: "完整闭环验证：新建公司→新建支店→编辑支店→删除支店→返回列表公司仍在，全链路无异常", evidence: `company=${company.subject_id} site=${site.subject_id}` };
    });

    await book.run("客户回归-002", "主档更正不影响历史业务", REQ, async () => {
      const prod = (await db.query<any>("SELECT data_id, display_value FROM prop_base_data WHERE data_type='external_product_name' AND status='0' LIMIT 1"))[0];
      const addr = (await db.query<any>("SELECT address_id FROM prop_customer_address WHERE subject_id=? LIMIT 1", [compB]))[0];
      const contact = (await db.query<any>("SELECT contact_id, contact_name FROM prop_customer_contact WHERE address_id=? AND contact_name='RG 連絡'", [addr.address_id]))[0];
      const orderNo = "AUTO-CUST-RG-ORD-" + Date.now();
      const order = await apiFetch(page, "/prop/order", { method: "POST", body: {
        requestId: crypto.randomUUID(), customerOrderNo: orderNo, orderDate: "2026-10-27",
        orderType: "sale", customerType: "agency",
        orderingParty: { mode: "select", id: compB }, recipient: { mode: "select", id: compB },
        billingParty: { mode: "select", id: compB },
        deliveryAddress: { mode: "select", id: addr.address_id },
        deliveryContact: { mode: "select", id: contact.contact_id },
        lines: [{ productNameId: prod.data_id, productName: prod.display_value, colorNote: "RG-SNAPSHOT", quantity: 1, sortOrder: 0 }],
      }});
      if ((order.body?.code ?? 0) !== 200) return { status: "阻塞", actual: `订单创建失败：${safeText(order.body?.msg || "", 100)}`, evidence: "" };
      const before = (await db.query<any>("SELECT delivery_contact_snapshot FROM prop_order WHERE customer_order_no=?", [orderNo]))[0];
      const detail = await apiFetch(page, `/prop/customer/${compB}`);
      const payload = detail.body.data;
      payload.addresses[0].contacts.find((c: any) => c.contactName === "RG 連絡").contactName = "RG 連絡-更名後";
      await apiFetch(page, `/prop/customer/${compB}`, { method: "PUT", body: payload });
      const after = (await db.query<any>("SELECT delivery_contact_snapshot FROM prop_order WHERE customer_order_no=?", [orderNo]))[0];
      const ok = JSON.stringify(before) === JSON.stringify(after) && String(after.delivery_contact_snapshot).includes("RG 連絡");
      return { status: ok ? "通过" : "不通过", actual: `联系人更名后，历史订单 ${orderNo} 的配送担当者快照保持「RG 連絡」不变`, evidence: "与编辑-009互证" };
    });

    await book.run("客户回归-003", "无启用停用状态", REQ, async () => {
      await openCustomerList(page);
      const listText = await page.locator(".customer-page").innerText();
      const uiNoStatus = !listText.includes("ステータス") && !listText.includes("启用") && !listText.includes("停用");
      const cols = await db.query<any>("SHOW COLUMNS FROM prop_customer_subject");
      const dbNoStatus = !cols.some((c: any) => String(c.Field).includes("status"));
      return { status: uiNoStatus && dbNoStatus ? "通过" : "不通过", actual: "客户主档无启用/停用状态概念：列表无状态列，主档表无status字段，与设计一致", evidence: "prop_customer_subject DDL" };
    });

    await book.run("客户回归-004", "不提供地址和联系人转移", REQ, async () => {
      const modal = await openCompanyDetail(page, compC);
      await page.locator("button").filter({ hasText: "会社情報を編集" }).first().click();
      const editModal = visibleModal(page);
      const text = await editModal.innerText();
      const noMove = !text.includes("移動") && !text.includes("转移");
      await editModal.locator(".ant-modal-footer button").filter({ hasText: "キャンセル" }).click();
      const detail = await apiFetch(page, `/prop/customer/${compC}`);
      const payload = detail.body.data;
      const foreignAddr = (await db.query<any>("SELECT * FROM prop_customer_address WHERE subject_id=? LIMIT 1", [compA]))[0];
      payload.addresses = [{ addressId: foreignAddr.address_id, postalCode: foreignAddr.postal_code, addressLine1: foreignAddr.address_line1, contacts: [] }];
      const r = await apiFetch(page, `/prop/customer/${compC}`, { method: "PUT", body: payload });
      const rejected = (r.body?.code ?? 0) !== 200;
      const stillMine = await db.query<any>("SELECT subject_id FROM prop_customer_address WHERE address_id=?", [foreignAddr.address_id]);
      const ok = noMove && rejected && Number(stillMine[0].subject_id) === compA;
      return { status: ok ? "通过" : "不通过", actual: `编辑界面无转移功能；API将他人地址ID挂到空会社被拒绝（${safeText(r.body?.msg || "", 60)}），地址归属不变`, evidence: "BR-051 地址ID必须属于当前主体" };
    });
  } finally {
    const trace = await finishSession(browser, session, "customer-cross-permission");
    console.log("[trace]", trace);
    await book.save();
    await db.close();
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });




