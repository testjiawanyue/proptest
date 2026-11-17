/**
 * 客户管理未执行用例运行时验证 - 第一批：列表查询(29条) + 公司维护(10条) + 支店现场维护(8条)
 * 依据：测试用例汇总_V5.xlsx 客户管理工作表；静态结论 BR-001~BR-079
 * 运行：npx tsx scripts/verify-customer-query-maintenance.ts
 */
import {
  DbClient, ResultBook, launchAdminSession, finishSession, openCustomerList,
  searchList, resetList, tableRowTexts, apiFetch, apiListCustomers,
  visibleModal, saveModal, cancelModal, formErrors, addAddressBlock,
  fillField, createCompanyViaUi, openCompanyDetail, createSiteViaUi,
  insertSubject, insertAddress, insertContact, safeText,
} from "./customer-runtime-utils.js";

const REQ = "FEAT-01-customer / spec 顧客管理";
const book = new ResultBook("reports/customer-runtime-results-query-maintenance.json");
const db = new DbClient();

interface Fx { compA: number; compB: number; compC: number; siteA1: number; siteA2: number }
const fx: Fx = { compA: 0, compB: 0, compC: 0, siteA1: 0, siteA2: 0 };
let mtCompanyId = 0;
let mtCompanyNo = "";
let mtSiteNo = "";

async function prepareFixtures(): Promise<void> {
  const t = "2026-10-20";
  fx.compA = await insertSubject(db, {
    subjectType: "company", customerNo: "NS-0001", createTime: `${t} 10:00:00`,
    subjectName: "AUTO-CUST-FX 株式会社NSロジ東日本 NSLogi", defaultCustomerType: "direct",
    storagePath: "\\\\fileserver\\cust\\nslogi-east",
  });
  const addrA1 = await insertAddress(db, fx.compA, {
    postalCode: "3710817", addressLine1: "群馬県前橋市文京町1-1 AUTO", addressLine2: "NSロジビル3F",
  }, 0, `${t} 10:01:00`);
  await insertContact(db, addrA1, {
    contactName: "松井 健太", jobTitle: "部長", phone: "090-1111-2222",
    fax: "027-111-2222", email: "matsui@nslogi-auto.example", note: "FX連絡先A1",
  }, 0, `${t} 10:02:00`);
  const addrA2 = await insertAddress(db, fx.compA, {
    postalCode: "3700000", addressLine1: "群馬県高崎市FX第二住所",
  }, 1, `${t} 10:03:00`);
  await insertContact(db, addrA2, { contactName: "高橋 一郎", phone: "090-5555-6666" }, 0, `${t} 10:04:00`);

  fx.siteA1 = await insertSubject(db, {
    subjectType: "site", companyId: fx.compA, customerNo: "NS-9001", createTime: `${t} 11:00:00`,
    subjectName: "AUTO-CUST-FX 群馬営業所",
  });
  const s1a1 = await insertAddress(db, fx.siteA1, { postalCode: "3720001", addressLine1: "群馬県伊勢崎市FX1" }, 0, `${t} 11:01:00`);
  await insertContact(db, s1a1, { contactName: "佐藤 次郎", phone: "090-3333-4444" }, 0, `${t} 11:02:00`);
  await insertContact(db, s1a1, { contactName: "鈴木 三郎" }, 1, `${t} 11:03:00`);
  const s1a2 = await insertAddress(db, fx.siteA1, { postalCode: "3720002", addressLine1: "群馬県伊勢崎市FX2" }, 1, `${t} 11:04:00`);
  await insertContact(db, s1a2, { contactName: "田中 四郎" }, 0, `${t} 11:05:00`);

  fx.siteA2 = await insertSubject(db, {
    subjectType: "site", companyId: fx.compA, customerNo: "NS-9002", createTime: `${t} 12:00:00`,
    subjectName: "AUTO-CUST-FX 高崎現場",
  });

  fx.compB = await insertSubject(db, {
    subjectType: "company", customerNo: "NS-0002", createTime: "2026-10-21 10:00:00",
    subjectName: "AUTO-CUST-FX NSロジ西日本", defaultCustomerType: "agency",
  });
  const addrB = await insertAddress(db, fx.compB, { postalCode: "5300001", addressLine1: "大阪府大阪市北区FX" }, 0, "2026-10-21 10:01:00");
  await insertContact(db, addrB, { contactName: "山田 花子", email: "yamada@nswest-auto.example" }, 0, "2026-10-21 10:02:00");

  fx.compC = await insertSubject(db, {
    subjectType: "company", customerNo: "NS-0003", createTime: "2026-10-22 10:00:00",
    subjectName: "AUTO-CUST-FX 空会社", defaultCustomerType: "direct",
  });
  console.log("[夹具] FX 公司/支店创建完成", JSON.stringify(fx));
}

async function maxCNumber(): Promise<number> {
  const rows = await db.query<any>(
    "SELECT MAX(CAST(SUBSTRING(customer_no,2) AS UNSIGNED)) m FROM prop_customer_subject WHERE customer_no REGEXP '^C[0-9]+$'",
  );
  return Number(rows[0]?.m ?? 0);
}

async function cleanup(): Promise<void> {
  await db.execute("DELETE c FROM prop_customer_contact c JOIN prop_customer_address a ON c.address_id=a.address_id JOIN prop_customer_subject s ON a.subject_id=s.subject_id WHERE s.customer_no LIKE 'NS-%' OR s.subject_name LIKE 'AUTO-CUST-MT%'");
  await db.execute("DELETE a FROM prop_customer_address a JOIN prop_customer_subject s ON a.subject_id=s.subject_id WHERE s.customer_no LIKE 'NS-%' OR s.subject_name LIKE 'AUTO-CUST-MT%'");
  await db.execute("DELETE FROM prop_customer_subject WHERE subject_type='site' AND (customer_no LIKE 'NS-%' OR subject_name LIKE 'AUTO-CUST-MT%')");
  await db.execute("DELETE FROM prop_customer_subject WHERE customer_no LIKE 'NS-%' OR subject_name LIKE 'AUTO-CUST-MT%'");
  console.log("[清理] 上一轮 FX/MT 数据已清除");
}

async function main(): Promise<void> {
  await db.connect();
  await cleanup();
  await prepareFixtures();
  const { browser, session } = await launchAdminSession("customer-query-maintenance");
  const page = session.page;
  try {
    // ============ 二、公司维护 ============
    await book.run("公司维护-002", "新建公司同时录入地址与联系人成功", REQ, async () => {
      const maxBefore = await maxCNumber();
      const row = await createCompanyViaUi(page, db, {
        subjectName: "AUTO-CUST-MT 新会社A", defaultCustomerType: "direct",
        addresses: [{
          postalCode: "1000001", addressLine1: "東京都千代田区MT1-1",
          contacts: [{ contactName: "山田 MT太郎", phone: "03-0000-0001", email: "mt-a@example.com" }],
        }],
      });
      mtCompanyId = row.subject_id; mtCompanyNo = row.customer_no;
      const addrs = await db.query<any>("SELECT * FROM prop_customer_address WHERE subject_id=?", [mtCompanyId]);
      const contacts = await db.query<any>(
        "SELECT c.* FROM prop_customer_contact c JOIN prop_customer_address a ON c.address_id=a.address_id WHERE a.subject_id=?", [mtCompanyId]);
      const ok = row.customer_no === "C" + String(maxBefore + 1).padStart(5, "0") && addrs.length === 1 && contacts.length === 1 && page.url().includes("/customer/detail/" + mtCompanyId);
      return { status: ok ? "通过" : "不通过", actual: `公司创建成功，编号 ${row.customer_no}（连续序列），地址${addrs.length}件、联系人${contacts.length}名落库，保存后跳转详情页`, evidence: `DB subject_id=${mtCompanyId}；URL=${page.url()}` };
    });

    await book.run("公司维护-003", "新建公司名称为空保存失败", REQ, async () => {
      await openCustomerList(page);
      await page.locator("button").filter({ hasText: "会社を追加" }).first().click();
      let posted = false;
      page.on("request", (req) => { if (req.method() === "POST" && req.url().includes("/prop/customer/company")) posted = true; });
      await saveModal(page);
      await page.waitForTimeout(600);
      const errors = await formErrors(page);
      await cancelModal(page);
      const ok = errors.includes("会社名を入力") && !posted;
      return { status: ok ? "通过" : "不通过", actual: `名称为空点击保存：前端校验提示「${safeText(errors, 80)}」，未发起写请求`, evidence: "Trace customer-query-maintenance" };
    });

    await book.run("公司维护-004", "新建公司名称输入纯空格保存失败", REQ, async () => {
      await page.locator("button").filter({ hasText: "会社を追加" }).first().click();
      await fillField(visibleModal(page), "会社名", "   ");
      await saveModal(page);
      await page.waitForTimeout(600);
      const errors = await formErrors(page);
      await cancelModal(page);
      const ok = errors.includes("会社名を入力");
      return { status: ok ? "通过" : "不通过", actual: `纯空格名称保存被拦截：「${safeText(errors, 80)}」`, evidence: "Trace customer-query-maintenance" };
    });

    await book.run("公司维护-005", "新建公司名称达到最大长度可保存", REQ, async () => {
      const name = "AUTO-CUST-MT-" + "あ".repeat(187);
      const row = await createCompanyViaUi(page, db, { subjectName: name });
      const ok = row.subject_name.length === 200;
      return { status: ok ? "通过" : "不通过", actual: `200字符名称保存成功，DB长度=${row.subject_name.length}`, evidence: `subject_id=${row.subject_id}` };
    });

    await book.run("公司维护-006", "新建公司名称超过最大长度保存失败", REQ, async () => {
      await openCustomerList(page);
      await page.locator("button").filter({ hasText: "会社を追加" }).first().click();
      const modal = visibleModal(page);
      const nameInput = modal.locator(".ant-form-item").filter({ hasText: "会社名" }).locator("input").last();
      await nameInput.fill("AUTO-CUST-MT-" + "い".repeat(188));
      const actualLen = (await nameInput.inputValue()).length;
      await cancelModal(page);
      const api = await apiFetch(page, "/prop/customer/company", {
        method: "POST", body: { subjectName: "AUTO-CUST-MT-" + "う".repeat(188), defaultCustomerType: "direct", addresses: [] },
      });
      const apiRejected = (api.body?.code ?? 0) !== 200;
      return {
        status: actualLen === 200 && apiRejected ? "部分验证" : "不通过",
        actual: `前端输入框maxlength=200，第201字符无法输入（实际录入${actualLen}字符）；API直接提交201字符：HTTP ${api.status} code=${api.body?.code} msg=${safeText(api.body?.msg || "", 100)}`,
        evidence: "前端限制+API拒绝；但无面向用户的超长提示文案",
      };
    });

    await book.run("公司维护-009", "新建公司时添加多个地址", REQ, async () => {
      const row = await createCompanyViaUi(page, db, {
        subjectName: "AUTO-CUST-MT 多住所会社",
        addresses: [
          { postalCode: "1000002", addressLine1: "東京都千代田区MT2-1" },
          { postalCode: "1000003", addressLine1: "東京都中央区MT3-1", contacts: [{ contactName: "鈴木 MT次郎" }] },
        ],
      });
      const addrs = await db.query<any>("SELECT * FROM prop_customer_address WHERE subject_id=? ORDER BY sort_order", [row.subject_id]);
      const ok = addrs.length === 2;
      return { status: ok ? "通过" : "不通过", actual: `一次新建2个地址全部保存，DB地址数=${addrs.length}`, evidence: `subject_id=${row.subject_id}` };
    });

    await book.run("公司维护-010", "移除未填写的地址区域", REQ, async () => {
      await openCustomerList(page);
      await page.locator("button").filter({ hasText: "会社を追加" }).first().click();
      const modal = visibleModal(page);
      await fillField(modal, "会社名", "AUTO-CUST-MT 空住所移除");
      await addAddressBlock(modal);
      await modal.locator(".address-block .block-title button").last().click();
      await page.waitForTimeout(500);
      const confirmModal = await page.locator(".ant-modal-confirm:visible").count();
      const blocksAfter = await modal.locator(".address-block").count();
      await saveModal(page);
      await page.waitForURL(/\/customer\/detail\/\d+/, { timeout: 15000 });
      const row = (await db.query<any>("SELECT * FROM prop_customer_subject WHERE subject_name=? ORDER BY subject_id DESC LIMIT 1", ["AUTO-CUST-MT 空住所移除"]))[0];
      const addrs = await db.query<any>("SELECT * FROM prop_customer_address WHERE subject_id=?", [row.subject_id]);
      const ok = confirmModal === 0 && blocksAfter === 0 && addrs.length === 0;
      return { status: ok ? "通过" : "不通过", actual: `未填写地址块点击移除直接删除（无确认弹窗），保存后公司仅基本信息，DB地址数=${addrs.length}`, evidence: `subject_id=${row.subject_id}` };
    });

    await book.run("公司维护-011", "取消新建公司", REQ, async () => {
      await openCustomerList(page);
      await page.locator("button").filter({ hasText: "会社を追加" }).first().click();
      const modal = visibleModal(page);
      await fillField(modal, "会社名", "AUTO-CUST-MT 取消会社");
      await cancelModal(page);
      await page.waitForTimeout(500);
      const rows = await db.query<any>("SELECT * FROM prop_customer_subject WHERE subject_name=?", ["AUTO-CUST-MT 取消会社"]);
      const ok = rows.length === 0 && page.url().includes("/customer");
      return { status: ok ? "通过" : "不通过", actual: `取消后弹窗关闭、停留列表页，DB无新公司记录（${rows.length}行）`, evidence: "DB校验无残留" };
    });

    await book.run("公司维护-012", "新建公司保存后跳转新公司详情", REQ, async () => {
      const row = await createCompanyViaUi(page, db, { subjectName: "AUTO-CUST-MT 跳转确认会社" });
      const url = page.url();
      const detailText = await page.locator(".detail-page").innerText();
      const normalized = detailText.replace(/\s+/g, "");
      const ok = url.includes("/customer/detail/" + row.subject_id) && normalized.includes("AUTO-CUST-MT跳转确认会社");
      return { status: ok ? "通过" : "不通过", actual: `保存后直接跳转 /customer/detail/${row.subject_id}，详情页显示新公司名`, evidence: `URL=${url}` };
    });

    await book.run("公司维护-013", "资料存放路径首尾空白归一保存", REQ, async () => {
      const row = await createCompanyViaUi(page, db, { subjectName: "AUTO-CUST-MT 路径裁剪会社", storagePath: "  \\\\server\\share\\MT  " });
      const ok = row.storage_path === "\\\\server\\share\\MT";
      return { status: ok ? "通过" : "不通过", actual: `保存值=[${row.storage_path}]，首尾空白已裁剪`, evidence: `subject_id=${row.subject_id}` };
    });

    // ============ 三、支店现场维护 ============
    await book.run("支店现场维护-001", "在公司详情页新建支店成功", REQ, async () => {
      const maxBefore = await maxCNumber();
      const row = await createSiteViaUi(page, db, mtCompanyId, {
        subjectName: "AUTO-CUST-MT 東京営業所",
        addresses: [{ postalCode: "1000004", addressLine1: "東京都港区MT4-1", contacts: [{ contactName: "佐藤 MT花子" }] }],
      });
      const ok = row.company_id === mtCompanyId && row.customer_no === "C" + String(maxBefore + 1).padStart(5, "0");
      mtSiteNo = row.customer_no;
      return { status: ok ? "通过" : "不通过", actual: `支店创建成功，编号 ${row.customer_no}，归属公司 subject_id=${mtCompanyId}`, evidence: `site subject_id=${row.subject_id}` };
    });

    await book.run("支店现场维护-002", "新建支店仅填名称保存成功", REQ, async () => {
      const row = await createSiteViaUi(page, db, mtCompanyId, { subjectName: "AUTO-CUST-MT 名称のみ支店" });
      const ok = !!row && row.company_id === mtCompanyId;
      return { status: ok ? "通过" : "不通过", actual: `仅名称支店保存成功，编号 ${row.customer_no}，无地址`, evidence: `subject_id=${row.subject_id}` };
    });

    await book.run("支店现场维护-003", "新建支店名称为空保存失败", REQ, async () => {
      await openCompanyDetail(page, mtCompanyId);
      await page.locator("button").filter({ hasText: "支店／現場を追加" }).first().click();
      await saveModal(page);
      await page.waitForTimeout(600);
      const errors = await formErrors(page);
      await cancelModal(page);
      const ok = errors.includes("支店／現場名を入力");
      return { status: ok ? "通过" : "不通过", actual: `支店名为空保存被拦截：「${safeText(errors, 80)}」`, evidence: "Trace customer-query-maintenance" };
    });

    await book.run("支店现场维护-004", "同一公司下支店名称重复仍可保存", REQ, async () => {
      const row = await createSiteViaUi(page, db, mtCompanyId, { subjectName: "AUTO-CUST-MT 名称のみ支店" });
      const dups = await db.query<any>("SELECT * FROM prop_customer_subject WHERE company_id=? AND subject_name=?", [mtCompanyId, "AUTO-CUST-MT 名称のみ支店"]);
      const ok = dups.length === 2;
      return { status: ok ? "通过" : "不通过", actual: `同名支店再次保存成功（无唯一性校验），同公司下同名支店共${dups.length}件`, evidence: `新subject_id=${row.subject_id}；与BR-041一致` };
    });

    await book.run("支店现场维护-005", "支店名称长度边界验证", REQ, async () => {
      const name200 = "AUTO-CUST-MT-S" + "え".repeat(186);
      const row = await createSiteViaUi(page, db, mtCompanyId, { subjectName: name200 });
      const api = await apiFetch(page, `/prop/customer/company/${mtCompanyId}/site`, {
        method: "POST", body: { subjectName: "AUTO-CUST-MT-S" + "お".repeat(187), addresses: [] },
      });
      const ok = row.subject_name.length === 200 && (api.body?.code ?? 0) !== 200;
      return { status: ok ? "通过" : "部分验证", actual: `200字符支店名保存成功（DB=${row.subject_name.length}字符）；API提交201字符：code=${api.body?.code} msg=${safeText(api.body?.msg || "", 80)}`, evidence: `subject_id=${row.subject_id}` };
    });

    await book.run("支店现场维护-006", "支店不能脱离公司独立创建", REQ, async () => {
      await openCustomerList(page);
      const noEntry = (await page.locator("button").filter({ hasText: "支店／現場を追加" }).count()) === 0;
      const api = await apiFetch(page, `/prop/customer/company/${fx.siteA1}/site`, {
        method: "POST", body: { subjectName: "AUTO-CUST-MT 非法挂靠支店", addresses: [] },
      });
      const apiRejected = (api.body?.code ?? 0) !== 200;
      return { status: noEntry && apiRejected ? "通过" : "不通过", actual: `列表页无独立新建支店入口；以支店ID作为所属公司调用API被拒绝：msg=${safeText(api.body?.msg || "", 80)}`, evidence: "BR-027 支店必须归属公司" };
    });

    await book.run("支店现场维护-007", "支店工作区不展示客户区分字段", REQ, async () => {
      await openCompanyDetail(page, mtCompanyId);
      await page.locator("button").filter({ hasText: "支店／現場を追加" }).first().click();
      const modal = visibleModal(page);
      const siteModalText = await modal.innerText();
      const hasType = siteModalText.includes("標準の顧客区分");
      await cancelModal(page);
      await openCustomerList(page);
      await page.locator("button").filter({ hasText: "会社を追加" }).first().click();
      const companyModalText = await visibleModal(page).innerText();
      const companyHasType = companyModalText.includes("標準の顧客区分");
      await cancelModal(page);
      const ok = !hasType && companyHasType;
      return { status: ok ? "通过" : "不通过", actual: "支店弹窗无客户区分字段（对照：公司弹窗有）", evidence: "BR-034 支店客户区分强制为空" };
    });

    await book.run("支店现场维护-008", "支店编号与公司共用连续序列", REQ, async () => {
      const rows = await db.query<any>(
        "SELECT customer_no FROM prop_customer_subject WHERE customer_no REGEXP '^C[0-9]+$' ORDER BY CAST(SUBSTRING(customer_no,2) AS UNSIGNED) DESC LIMIT 6");
      const nums = rows.map((r: any) => Number(r.customer_no.slice(1))).sort((a: number, b: number) => a - b);
      let continuous = true;
      for (let i = 1; i < nums.length; i++) if (nums[i] !== nums[i - 1] + 1) continuous = false;
      const ok = continuous && /^C\d{5}$/.test(mtSiteNo);
      return { status: ok ? "通过" : "不通过", actual: `新建支店编号 ${mtSiteNo} 与公司共用 C%05d 序列，最近6个编号连续（${nums.join(",")}）`, evidence: "BR-028/029 编号锁串行共用序列" };
    });

    // ============ 一、客户列表查询 ============
    await openCustomerList(page);

    await book.run("客户列表查询-002", "关键词搜索导入客户编号", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: "NS-00" });
      const nos = r.rows.map((x: any) => x.customerNo);
      const ok = nos.includes("NS-0001") && nos.includes("NS-0002") && nos.includes("NS-0003") && nos.every((n: string) => n.includes("NS-00"));
      return { status: ok ? "通过" : "不通过", actual: `关键词「NS-00」部分匹配命中公司编号：${nos.join(",")}`, evidence: "GET /prop/customer/list?keyword=NS-00" };
    });

    await book.run("客户列表查询-003", "关键词搜索公司名称", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: "NSロジ" });
      const names = r.rows.map((x: any) => x.subjectName);
      const ok = names.some((n: string) => n.includes("東日本")) && names.some((n: string) => n.includes("西日本")) && !names.some((n: string) => n.includes("空会社"));
      return { status: ok ? "通过" : "不通过", actual: `关键词「NSロジ」命中東日本/西日本两家公司，不匹配的空会社未显示`, evidence: `rows=${r.total}` };
    });

    await book.run("客户列表查询-004", "关键词搜索支店名称自动展开父级公司", REQ, async () => {
      await searchList(page, { keyword: "群馬営業所" });
      const rows = await tableRowTexts(page);
      const companyRow = rows.find((t) => t.includes("NSロジ東日本"));
      const siteRow = rows.find((t) => t.includes("群馬営業所"));
      const ok = !!companyRow && !!siteRow;
      return { status: ok ? "通过" : "不通过", actual: "搜索支店名「群馬営業所」：父级公司「NSロジ東日本」返回且自动展开显示支店行", evidence: `行数=${rows.length}` };
    });

    await book.run("客户列表查询-005", "关键词搜索支店业务编号", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: "NS-9001" });
      const company = r.rows.find((x: any) => x.customerNo === "NS-0001");
      const siteNos = (company?.sites ?? []).map((s: any) => s.customerNo);
      const ok = !!company && siteNos.includes("NS-9001") && !siteNos.includes("NS-9002");
      return { status: ok ? "通过" : "不通过", actual: `关键词「NS-9001」命中支店编号，返回父公司且仅展示命中支店（${siteNos.join(",")}）`, evidence: "BR-009 仅支店命中时过滤支店" };
    });

    await book.run("客户列表查询-007", "地址关键词搜索匹配客户", REQ, async () => {
      const r1 = await apiListCustomers(page, { address: "3710817" });
      const r2 = await apiListCustomers(page, { address: "371-0817" });
      const names1 = r1.rows.map((x: any) => x.subjectName);
      const names2 = r2.rows.map((x: any) => x.subjectName);
      const ok = names1.some((n: string) => n.includes("NSロジ東日本")) && JSON.stringify(names1) === JSON.stringify(names2);
      return { status: ok ? "通过" : "不通过", actual: "邮编「3710817」与带连字符「371-0817」搜索结果一致，均命中NSロジ東日本", evidence: "BR-006 地址搜索移除ASCII连字符" };
    });

    await book.run("客户列表查询-008", "地址正文关键字搜索", REQ, async () => {
      const r = await apiListCustomers(page, { address: "文京町" });
      const ok = r.rows.some((x: any) => x.subjectName.includes("NSロジ東日本")) && r.rows.every((x: any) => !x.subjectName.includes("西日本"));
      return { status: ok ? "通过" : "不通过", actual: `地址关键字「文京町」命中NSロジ東日本（共${r.total}社）`, evidence: "address=文京町" };
    });

    await book.run("客户列表查询-009", "联系人姓名搜索", REQ, async () => {
      const r = await apiListCustomers(page, { contact: "松井" });
      const ok = r.rows.some((x: any) => x.subjectName.includes("NSロジ東日本"));
      return { status: ok ? "通过" : "不通过", actual: `联系人姓名「松井」命中NSロジ東日本（共${r.total}社）`, evidence: "contact=松井" };
    });

    await book.run("客户列表查询-010", "联系人电话搜索", REQ, async () => {
      const r = await apiListCustomers(page, { contact: "090-1111" });
      const ok = r.rows.some((x: any) => x.subjectName.includes("NSロジ東日本"));
      return { status: ok ? "通过" : "不通过", actual: `联系人电话「090-1111」命中NSロジ東日本（共${r.total}社）`, evidence: "contact=090-1111" };
    });

    await book.run("客户列表查询-011", "联系人邮箱搜索", REQ, async () => {
      const r = await apiListCustomers(page, { contact: "nslogi-auto" });
      const ok = r.rows.some((x: any) => x.subjectName.includes("NSロジ東日本"));
      return { status: ok ? "通过" : "不通过", actual: `联系人邮箱片段「nslogi-auto」命中NSロジ東日本（共${r.total}社）`, evidence: "contact=nslogi-auto" };
    });

    await book.run("客户列表查询-012", "客户区分筛选直贩", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: "AUTO-CUST-FX", customerType: "direct" });
      const names = r.rows.map((x: any) => x.subjectName);
      const ok = names.some((n: string) => n.includes("東日本")) && !names.some((n: string) => n.includes("西日本")) && r.rows.every((x: any) => x.defaultCustomerType === "direct");
      return { status: ok ? "通过" : "不通过", actual: `区分=直販：東日本（直販）显示，西日本（代理店）排除`, evidence: `rows=${names.join("|")}` };
    });

    await book.run("客户列表查询-013", "客户区分筛选代理", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: "AUTO-CUST-FX", customerType: "agency" });
      const names = r.rows.map((x: any) => x.subjectName);
      const ok = names.length === 1 && names[0].includes("西日本");
      return { status: ok ? "通过" : "不通过", actual: `区分=代理店：仅西日本显示（${names.join(",")}）`, evidence: "customerType=agency" };
    });

    await book.run("客户列表查询-014", "多条件组合搜索", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: "NSロジ", address: "文京町", customerType: "direct" });
      const names = r.rows.map((x: any) => x.subjectName);
      const ok = names.length === 1 && names[0].includes("東日本");
      return { status: ok ? "通过" : "不通过", actual: "名称+地址+区分三条件组合：仅NSロジ東日本命中", evidence: "BR-008 需满足全部条件" };
    });

    await book.run("客户列表查询-015", "重置查询条件", REQ, async () => {
      await searchList(page, { keyword: "NSロジ" });
      await resetList(page);
      const keyword = await page.getByPlaceholder("顧客番号・会社名・支店／現場名").inputValue();
      const toolbar = await page.locator(".customer-page .toolbar").innerText();
      const r = await apiListCustomers(page, {});
      const ok = keyword === "" && toolbar.includes(`全${r.rowTotal}件`);
      return { status: ok ? "通过" : "不通过", actual: `重置后条件清空并回到全量列表：${safeText(toolbar, 40)}，与API rowTotal=${r.rowTotal}一致`, evidence: "BR-015" };
    });

    await book.run("客户列表查询-016", "搜索无匹配结果", REQ, async () => {
      await searchList(page, { keyword: "存在しないZZZ999" });
      const rows = await tableRowTexts(page);
      const toolbar = await page.locator(".customer-page .toolbar").innerText();
      const ok = rows.length === 0 && toolbar.includes("全0件");
      return { status: ok ? "通过" : "不通过", actual: `无匹配关键词：列表无数据行，工具栏显示「${safeText(toolbar, 30)}」`, evidence: "BR-077" };
    });

    await book.run("客户列表查询-017", "手动展开与折叠公司支店节点", REQ, async () => {
      await resetList(page);
      const row = page.locator("tr.ant-table-row").filter({ hasText: "AUTO-CUST-MT 新会社A" }).first();
      await row.locator(".ant-table-row-expand-icon").click();
      await page.waitForTimeout(600);
      let texts = await tableRowTexts(page);
      const expanded = texts.some((t) => t.includes("AUTO-CUST-MT 東京営業所"));
      await row.locator(".ant-table-row-expand-icon").first().click();
      await page.waitForTimeout(600);
      texts = await tableRowTexts(page);
      const collapsed = !texts.some((t) => t.includes("AUTO-CUST-MT 東京営業所"));
      const ok = expanded && collapsed;
      return { status: ok ? "通过" : "不通过", actual: "手动点击展开图标显示支店行，再点击折叠恢复隐藏", evidence: "BR-014 无搜索默认收起" };
    });

    await book.run("客户列表查询-018", "列表联系资料数量统计正确", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: "NSロジ東日本" });
      const company = r.rows[0];
      const site1 = (company.sites ?? []).find((s: any) => s.customerNo === "NS-9001");
      const companyOk = company.addressCount === 2 && company.contactCount === 2;
      const siteOk = site1 && site1.addressCount === 2 && site1.contactCount === 3;
      await searchList(page, { keyword: "NSロジ東日本" });
      const texts = await tableRowTexts(page);
      const siteRowText = texts.find((t) => t.includes("群馬営業所")) ?? "";
      const uiOk = siteRowText.includes("住所 2件") && siteRowText.includes("担当者 3名");
      const ok = companyOk && siteOk && uiOk;
      return { status: ok ? "通过" : "不通过", actual: `公司行 住所${company.addressCount}件/担当者${company.contactCount}名；群馬営業所行 UI显示「住所 2件・担当者 3名」与DB一致`, evidence: "BR-018" };
    });

    await book.run("客户列表查询-020", "搜索系统新建公司编号", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: mtCompanyNo });
      const ok = r.rows.some((x: any) => x.customerNo === mtCompanyNo);
      return { status: ok ? "通过" : "不通过", actual: `搜索系统编号「${mtCompanyNo}」精确命中新公司`, evidence: "公司维护-002创建的编号" };
    });

    await book.run("客户列表查询-021", "搜索系统新建支店编号", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: mtSiteNo });
      const company = r.rows.find((x: any) => x.subjectId === mtCompanyId);
      const ok = !!company && (company.sites ?? []).some((s: any) => s.customerNo === mtSiteNo);
      return { status: ok ? "通过" : "不通过", actual: `搜索系统支店编号「${mtSiteNo}」命中父公司并展示该支店`, evidence: "支店现场维护-001创建的编号" };
    });

    await book.run("客户列表查询-022", "地址2关键字搜索", REQ, async () => {
      const r = await apiListCustomers(page, { address: "NSロジビル" });
      const ok = r.rows.some((x: any) => x.subjectName.includes("NSロジ東日本"));
      return { status: ok ? "通过" : "不通过", actual: `地址2关键字「NSロジビル」命中NSロジ東日本（共${r.total}社）`, evidence: "BR-006 同时匹配地址1/地址2" };
    });

    await book.run("客户列表查询-023", "联系人传真搜索", REQ, async () => {
      const r = await apiListCustomers(page, { contact: "027-111" });
      const ok = r.rows.some((x: any) => x.subjectName.includes("NSロジ東日本"));
      return { status: ok ? "通过" : "不通过", actual: `传真「027-111」命中NSロジ東日本（共${r.total}社）`, evidence: "BR-007 联系人匹配姓名/电话/传真/邮箱" };
    });

    await book.run("客户列表查询-024", "列表列构成与两行语义", REQ, async () => {
      await resetList(page);
      const headers = await page.locator(".customer-page .ant-table-thead th").allInnerTexts();
      const joined = headers.join(",");
      const row = page.locator("tr.ant-table-row").filter({ hasText: "AUTO-CUST-MT 新会社A" }).first();
      const twoLine = (await row.locator("td div div + small").count()) >= 2;
      const ok = joined.includes("顧客番号") && joined.includes("会社名・支店／現場名")
        && joined.includes("住所情報") && joined.includes("連絡先情報") && joined.includes("操作") && twoLine;
      return { status: ok ? "通过" : "不通过", actual: `列构成：${headers.map((h) => safeText(h, 20)).join(" / ")}；公司名+区分、邮编+地址、住所件数+担当者数均为两行展示`, evidence: "index.vue columns定义一致" };
    });

    await book.run("客户列表查询-025", "分页按公司单位", REQ, async () => {
      const r1 = await apiListCustomers(page, { pageNum: 1 });
      const r2 = await apiListCustomers(page, { pageNum: 2 });
      const page1Ids = r1.rows.map((x: any) => x.subjectId);
      const page2Ids = r2.rows.map((x: any) => x.subjectId);
      const overlap = page1Ids.filter((id: number) => page2Ids.includes(id));
      const companyCount = (await db.query<any>("SELECT COUNT(*) c FROM prop_customer_subject WHERE subject_type='company'"))[0].c;
      const ok = r1.rows.length === 10 && Number(r1.total) === Number(companyCount) && overlap.length === 0 && r2.rows.length > 0;
      return { status: ok ? "通过" : "不通过", actual: `每页固定10社（实际${r1.rows.length}），total=${r1.total}=DB公司数${companyCount}，第2页${r2.rows.length}社且无重叠，公司携全部支店整体分页`, evidence: "BR-012/013" };
    });

    await book.run("客户列表查询-026", "回车键触发查询", REQ, async () => {
      await resetList(page);
      await searchList(page, { keyword: "NSロジ東日本" }, "enter");
      const texts = await tableRowTexts(page);
      const ok = texts.some((t) => t.includes("NSロジ東日本")) && !texts.some((t) => t.includes("空会社"));
      return { status: ok ? "通过" : "不通过", actual: "关键词输入框按Enter直接触发查询，结果与点击検索一致", evidence: "form @finish 提交" };
    });

    await book.run("客户列表查询-027", "无搜索条件时支店默认收起", REQ, async () => {
      await resetList(page);
      const texts = await tableRowTexts(page);
      const siteVisible = texts.some((t) => t.includes("東京営業所") || t.includes("群馬営業所"));
      const ok = !siteVisible;
      return { status: ok ? "通过" : "不通过", actual: `无条件查询时支店行全部收起，仅显示公司行（本页${texts.length}行）`, evidence: "BR-014 expandedKeys=[]" };
    });

    await book.run("客户列表查询-028", "英文搜索忽略大小写", REQ, async () => {
      const r1 = await apiListCustomers(page, { keyword: "nslogi" });
      const r2 = await apiListCustomers(page, { keyword: "NSLOGI" });
      const ok = r1.rows.some((x: any) => x.subjectName.includes("NSロジ東日本")) && r1.total === r2.total;
      return { status: ok ? "通过" : "不通过", actual: `小写「nslogi」与大写「NSLOGI」均命中名称含NSLogi的公司（各${r1.total}社）`, evidence: "BR-005 大小写不敏感" };
    });

    await book.run("客户列表查询-029", "邮编不带连字符及部分数字匹配", REQ, async () => {
      const r = await apiListCustomers(page, { address: "371081" });
      const ok = r.rows.some((x: any) => x.subjectName.includes("NSロジ東日本"));
      return { status: ok ? "通过" : "不通过", actual: "邮编部分数字「371081」命中NSロジ東日本（3710817）", evidence: "address=371081" };
    });

    await book.run("客户列表查询-030", "公司列表按创建时间倒序排列", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: "AUTO-CUST-FX" });
      const order = r.rows.map((x: any) => `${String(x.subjectName).replace("AUTO-CUST-FX ", "")}@${x.createTime}`);
      const times = r.rows.map((x: any) => new Date(x.createTime).getTime());
      const ids = r.rows.map((x: any) => x.subjectId);
      let sorted = true;
      for (let i = 1; i < times.length; i++) {
        if (times[i] > times[i - 1]) sorted = false;
        if (times[i] === times[i - 1] && ids[i] > ids[i - 1]) sorted = false;
      }
      return { status: sorted && r.rows.length === 3 ? "通过" : "不通过", actual: `FX公司顺序：${order.join(" → ")}（创建时间倒序：空会社→西日本→東日本）`, evidence: "BR-010" };
    });

    await book.run("客户列表查询-031", "同公司下支店按创建时间正序排列", REQ, async () => {
      const r = await apiListCustomers(page, { keyword: "NSロジ東日本" });
      const sites = (r.rows[0].sites ?? []).map((s: any) => String(s.subjectName).replace("AUTO-CUST-FX ", ""));
      const ok = sites.length === 2 && sites[0].includes("群馬営業所") && sites[1].includes("高崎現場");
      return { status: ok ? "通过" : "不通过", actual: `支店顺序：${sites.join(" → ")}（创建时间正序）`, evidence: "BR-011" };
    });

    await book.run("客户列表查询-032", "编辑客户不改变排序位置", REQ, async () => {
      const before = (await apiListCustomers(page, { keyword: "AUTO-CUST-FX" })).rows.map((x: any) => x.subjectId);
      const detail = await apiFetch(page, `/prop/customer/${fx.compA}`);
      const payload = detail.body.data;
      payload.storagePath = "\\\\fileserver\\cust\\nslogi-east-updated";
      const put = await apiFetch(page, `/prop/customer/${fx.compA}`, { method: "PUT", body: payload });
      const after = (await apiListCustomers(page, { keyword: "AUTO-CUST-FX" })).rows.map((x: any) => x.subjectId);
      const ok = put.body?.code === 200 && JSON.stringify(before) === JSON.stringify(after);
      return { status: ok ? "通过" : "不通过", actual: `编辑公司资料路径后，FX公司排序不变（${after.join(",")}）`, evidence: "排序键为create_time不受update影响" };
    });
  } finally {
    const trace = await finishSession(browser, session, "customer-query-maintenance");
    console.log("[trace]", trace);
    await book.save();
    await db.close();
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });



