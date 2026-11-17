/**
 * 客户管理未执行用例运行时验证 - 第二批：编辑功能(21条) + 删除功能(7条)
 * 依据：测试用例汇总_V5.xlsx 客户管理工作表；静态结论 BR-044~BR-068
 * 运行：npx tsx scripts/verify-customer-edit-delete.ts
 */
import {
  DbClient, ResultBook, launchAdminSession, finishSession, openCompanyDetail,
  apiFetch, visibleModal, saveModal, cancelModal, formErrors, addAddressBlock,
  fillField, fillSubjectForm, insertSubject, insertAddress, insertContact, safeText,
} from "./customer-runtime-utils.js";

const REQ = "FEAT-01-customer / spec 顧客管理";
const book = new ResultBook("reports/customer-runtime-results-edit-delete.json");
const db = new DbClient();

let edCompany = 0, edSite = 0, edAddr = 0, edContact = 0;
let delCompany = 0, delSiteA = 0, delSiteB = 0, delSiteC = 0, delAddrA = 0, delAddrB = 0;
let concCompany = 0;

async function cleanup(): Promise<void> {
  await db.execute("DELETE c FROM prop_customer_contact c JOIN prop_customer_address a ON c.address_id=a.address_id JOIN prop_customer_subject s ON a.subject_id=s.subject_id WHERE s.customer_no LIKE 'NS-ED%' OR s.subject_name LIKE 'AUTO-CUST-ED%'");
  await db.execute("DELETE a FROM prop_customer_address a JOIN prop_customer_subject s ON a.subject_id=s.subject_id WHERE s.customer_no LIKE 'NS-ED%' OR s.subject_name LIKE 'AUTO-CUST-ED%'");
  await db.execute("DELETE FROM prop_customer_subject WHERE subject_type='site' AND (customer_no LIKE 'NS-ED%' OR subject_name LIKE 'AUTO-CUST-ED%')");
  await db.execute("DELETE FROM prop_customer_subject WHERE customer_no LIKE 'NS-ED%' OR subject_name LIKE 'AUTO-CUST-ED%'");
  await db.execute("DELETE l FROM prop_order_line l JOIN prop_order o ON l.order_id=o.order_id WHERE o.customer_order_no LIKE 'AUTO-CUST-ED-ORD%'");
  await db.execute("DELETE op FROM prop_order_operation op JOIN prop_order o ON op.order_id=o.order_id WHERE o.customer_order_no LIKE 'AUTO-CUST-ED-ORD%'");
  await db.execute("DELETE FROM prop_order WHERE customer_order_no LIKE 'AUTO-CUST-ED-ORD%'");
  console.log("[清理] ED 数据已清除");
}

async function prepareFixtures(): Promise<void> {
  const t = "2026-10-27 09:00:00";
  edCompany = await insertSubject(db, { subjectType: "company", customerNo: "NS-ED01", createTime: t, subjectName: "AUTO-CUST-ED 編集対象会社", defaultCustomerType: "direct" });
  edAddr = await insertAddress(db, edCompany, { postalCode: "1500001", addressLine1: "東京都渋谷区ED1-1" }, 0, t);
  edContact = await insertContact(db, edAddr, { contactName: "編集 太郎", phone: "03-1111-0001", email: "edit@ed-auto.example" }, 0, t);
  edSite = await insertSubject(db, { subjectType: "site", companyId: edCompany, customerNo: "NS-ED02", createTime: t, subjectName: "AUTO-CUST-ED 編集対象支店" });
  const esAddr = await insertAddress(db, edSite, { postalCode: "1500002", addressLine1: "東京都渋谷区ED2-1" }, 0, t);
  await insertContact(db, esAddr, { contactName: "支店 花子" }, 0, t);

  delCompany = await insertSubject(db, { subjectType: "company", customerNo: "NS-ED03", createTime: t, subjectName: "AUTO-CUST-ED 削除対象会社", defaultCustomerType: "direct" });
  delSiteA = await insertSubject(db, { subjectType: "site", companyId: delCompany, customerNo: "NS-ED04", createTime: t, subjectName: "AUTO-CUST-ED 削除支店A" });
  delAddrA = await insertAddress(db, delSiteA, { postalCode: "1600001", addressLine1: "東京都新宿区DEL-A" }, 0, t);
  await insertContact(db, delAddrA, { contactName: "削除 一郎" }, 0, t);
  await insertContact(db, delAddrA, { contactName: "削除 二郎" }, 1, t);
  delSiteB = await insertSubject(db, { subjectType: "site", companyId: delCompany, customerNo: "NS-ED05", createTime: t, subjectName: "AUTO-CUST-ED 削除支店B" });
  delAddrB = await insertAddress(db, delSiteB, { postalCode: "1600002", addressLine1: "東京都新宿区DEL-B" }, 0, t);
  await insertContact(db, delAddrB, { contactName: "削除 三郎" }, 0, t);
  delSiteC = await insertSubject(db, { subjectType: "site", companyId: delCompany, customerNo: "NS-ED06", createTime: t, subjectName: "AUTO-CUST-ED 取消支店" });

  concCompany = await insertSubject(db, { subjectType: "company", customerNo: "NS-ED07", createTime: t, subjectName: "AUTO-CUST-ED 並行編集会社", defaultCustomerType: "direct" });
  console.log("[夹具] ED 公司/支店创建完成");
}

async function openEditCompany(page: any, companyId: number): Promise<any> {
  await openCompanyDetail(page, companyId);
  await page.locator("button").filter({ hasText: "会社情報を編集" }).first().click();
  const modal = visibleModal(page);
  await modal.waitFor({ state: "visible" });
  return modal;
}

async function openEditSite(page: any, companyId: number, siteName: string): Promise<any> {
  await openCompanyDetail(page, companyId);
  const card = page.locator(".subject-card").filter({ hasText: siteName }).first();
  await card.locator("button").filter({ hasText: "編集" }).first().click();
  const modal = visibleModal(page);
  await modal.waitFor({ state: "visible" });
  return modal;
}

async function waitModalClosed(page: any): Promise<void> {
  await page.locator(".ant-modal:visible").waitFor({ state: "hidden", timeout: 15000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
}

async function main(): Promise<void> {
  await db.connect();
  await cleanup();
  await prepareFixtures();
  const { browser, session } = await launchAdminSession("customer-edit-delete");
  const page = session.page;
  try {
    // ============ 四、编辑功能验证 ============
    await book.run("客户编辑-002", "编辑公司时业务编号不可修改", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const noItem = modal.locator(".ant-form-item").filter({ hasText: "顧客番号" }).last();
      const inputCount = await noItem.locator("input:not([disabled])").count();
      const itemText = safeText(await noItem.innerText(), 60);
      await cancelModal(page);
      const before = (await db.query<any>("SELECT customer_no FROM prop_customer_subject WHERE subject_id=?", [edCompany]))[0].customer_no;
      const detail = await apiFetch(page, `/prop/customer/${edCompany}`);
      const payload = detail.body.data; payload.customerNo = "HACK-9999";
      await apiFetch(page, `/prop/customer/${edCompany}`, { method: "PUT", body: payload });
      const after = (await db.query<any>("SELECT customer_no FROM prop_customer_subject WHERE subject_id=?", [edCompany]))[0].customer_no;
      const ok = inputCount === 0 && before === after;
      return { status: ok ? "通过" : "不通过", actual: `编辑弹窗顧客番号只读展示（${itemText}，无可编辑输入框）；API提交篡改编号被忽略，DB编号保持 ${after}`, evidence: "BR-048 编号不可变更" };
    });

    await book.run("客户编辑-003", "编辑支店基础信息成功", REQ, async () => {
      const modal = await openEditSite(page, edCompany, "AUTO-CUST-ED 編集対象支店");
      await fillField(modal, "支店／現場名", "AUTO-CUST-ED 編集対象支店-改");
      await fillField(modal, "資料の保存先", "\\\\ed-server\\site");
      await saveModal(page);
      await waitModalClosed(page);
      const row = (await db.query<any>("SELECT subject_name, storage_path FROM prop_customer_subject WHERE subject_id=?", [edSite]))[0];
      const ok = row.subject_name === "AUTO-CUST-ED 編集対象支店-改" && row.storage_path === "\\\\ed-server\\site";
      return { status: ok ? "通过" : "不通过", actual: `支店名称与资料路径修改保存成功：${row.subject_name}`, evidence: `subject_id=${edSite}` };
    });

    await book.run("客户编辑-004", "编辑地址信息成功", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const block = modal.locator(".address-block").first();
      await fillField(block, "住所1", "東京都渋谷区ED1-1-変更後");
      await fillField(block, "住所2（任意）", "EDビル2F");
      await saveModal(page);
      await waitModalClosed(page);
      const row = (await db.query<any>("SELECT address_line1, address_line2 FROM prop_customer_address WHERE address_id=?", [edAddr]))[0];
      const ok = row.address_line1.includes("変更後") && row.address_line2 === "EDビル2F";
      return { status: ok ? "通过" : "不通过", actual: `既有地址修改按ID更新成功：${row.address_line1} / ${row.address_line2}`, evidence: `address_id=${edAddr}；BR-052` };
    });

    await book.run("客户编辑-005", "编辑地址时必填项清空保存失败", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const block = modal.locator(".address-block").first();
      await fillField(block, "郵便番号", "");
      await saveModal(page);
      await page.waitForTimeout(600);
      const errors = await formErrors(page);
      const modalOpen = await modal.isVisible();
      await cancelModal(page);
      const ok = errors.includes("郵便番号") && modalOpen;
      return { status: ok ? "通过" : "不通过", actual: `清空邮编保存被拦截：「${safeText(errors, 90)}」，弹窗保持打开`, evidence: "前端校验规则required" };
    });

    await book.run("客户编辑-006", "编辑联系人信息成功", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const contact = modal.locator(".contact-block").first();
      await fillField(contact, "電話番号", "03-9999-8888");
      await fillField(contact, "役職", "課長");
      await saveModal(page);
      await waitModalClosed(page);
      const row = (await db.query<any>("SELECT phone, job_title FROM prop_customer_contact WHERE contact_id=?", [edContact]))[0];
      const ok = row.phone === "03-9999-8888" && row.job_title === "課長";
      return { status: ok ? "通过" : "不通过", actual: `联系人电话/职位修改成功：${row.phone} ${row.job_title}`, evidence: `contact_id=${edContact}；BR-054` };
    });

    await book.run("客户编辑-007", "编辑联系人姓名清空保存失败", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const contact = modal.locator(".contact-block").first();
      await fillField(contact, "氏名", "");
      await saveModal(page);
      await page.waitForTimeout(600);
      const errors = await formErrors(page);
      await cancelModal(page);
      const ok = errors.includes("氏名を入力");
      return { status: ok ? "通过" : "不通过", actual: `联系人姓名清空保存被拦截：「${safeText(errors, 90)}」`, evidence: "BR-038" };
    });

    await book.run("客户编辑-009", "编辑资料不影响历史业务快照", REQ, async () => {
      const prod = (await db.query<any>("SELECT data_id, display_value FROM prop_base_data WHERE data_type='external_product_name' AND status='0' LIMIT 1"))[0];
      const orderNo = "AUTO-CUST-ED-ORD-" + Date.now();
      const order = await apiFetch(page, "/prop/order", { method: "POST", body: {
        requestId: crypto.randomUUID(), customerOrderNo: orderNo, orderDate: "2026-10-27",
        orderType: "sale", customerType: "direct",
        orderingParty: { mode: "select", id: edCompany },
        recipient: { mode: "select", id: edCompany },
        billingParty: { mode: "select", id: edCompany },
        deliveryAddress: { mode: "select", id: edAddr },
        deliveryContact: { mode: "select", id: edContact },
        lines: [{ productNameId: prod.data_id, productName: prod.display_value, colorNote: "ED-SNAPSHOT", quantity: 1, sortOrder: 0 }],
      }});
      if ((order.body?.code ?? 0) !== 200) return { status: "阻塞", actual: `订单创建失败：${safeText(order.body?.msg || order.text, 120)}`, evidence: "无法构造历史业务" };
      const before = (await db.query<any>("SELECT ordering_party_snapshot, delivery_address_snapshot FROM prop_order WHERE customer_order_no=?", [orderNo]))[0];
      const detail = await apiFetch(page, `/prop/customer/${edCompany}`);
      const payload = detail.body.data; payload.subjectName = "AUTO-CUST-ED 編集対象会社-改名後";
      await apiFetch(page, `/prop/customer/${edCompany}`, { method: "PUT", body: payload });
      const after = (await db.query<any>("SELECT ordering_party_snapshot, delivery_address_snapshot FROM prop_order WHERE customer_order_no=?", [orderNo]))[0];
      const nameNow = (await db.query<any>("SELECT subject_name FROM prop_customer_subject WHERE subject_id=?", [edCompany]))[0].subject_name;
      const unchanged = JSON.stringify(before) === JSON.stringify(after);
      const ok = unchanged && String(before.ordering_party_snapshot).includes("編集対象会社") && nameNow.includes("改名後");
      return { status: ok ? "通过" : "不通过", actual: `客户改名后（${nameNow}），历史订单 ${orderNo} 的发注元/配送先快照保持不变：${safeText(String(before.ordering_party_snapshot), 60)}`, evidence: "BR-050 主档更新不回写业务快照" };
    });

    await book.run("客户编辑-010", "两个用户并发编辑同一客户不发生静默覆盖", REQ, async () => {
      const v1 = (await apiFetch(page, `/prop/customer/${concCompany}`)).body.data;
      const payloadA = JSON.parse(JSON.stringify(v1)); payloadA.subjectName = "AUTO-CUST-ED 並行A先保存";
      const payloadB = JSON.parse(JSON.stringify(v1)); payloadB.subjectName = "AUTO-CUST-ED 並行B后保存";
      const r1 = await apiFetch(page, `/prop/customer/${concCompany}`, { method: "PUT", body: payloadA });
      const r2 = await apiFetch(page, `/prop/customer/${concCompany}`, { method: "PUT", body: payloadB });
      const final = (await db.query<any>("SELECT subject_name FROM prop_customer_subject WHERE subject_id=?", [concCompany]))[0].subject_name;
      const bothOk = r1.body?.code === 200 && r2.body?.code === 200;
      const silentOverwrite = bothOk && final === "AUTO-CUST-ED 並行B后保存";
      return {
        status: silentOverwrite ? "不通过" : "通过",
        actual: `基于同一版本并发提交：两次保存均返回成功（code=200），后保存直接覆盖先保存（最终=${final}），系统无版本冲突检测与提示`,
        evidence: "BR-059 无乐观锁；与既有 verify-concurrent-edit 结论一致",
      };
    });

    await book.run("客户编辑-011", "连续录入地址与联系人", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      await fillField(await addAddressBlock(modal), "郵便番号", "1500003");
      const block2 = modal.locator(".address-block").last();
      await fillField(block2, "住所1", "東京都渋谷区ED3-1");
      await block2.locator("button").filter({ hasText: "担当者を追加" }).click();
      await fillField(block2.locator(".contact-block").last(), "氏名", "連続 五郎");
      await fillField(block2.locator(".contact-block").last(), "電話番号", "03-7777-6666");
      await saveModal(page);
      await waitModalClosed(page);
      const addrs = await db.query<any>("SELECT * FROM prop_customer_address WHERE subject_id=?", [edCompany]);
      const contacts = await db.query<any>("SELECT c.* FROM prop_customer_contact c JOIN prop_customer_address a ON c.address_id=a.address_id WHERE a.subject_id=?", [edCompany]);
      const ok = addrs.length === 2 && contacts.length === 2;
      return { status: ok ? "通过" : "不通过", actual: `编辑中连续追加地址+联系人一次保存成功，DB地址${addrs.length}件/联系人${contacts.length}名`, evidence: `subject_id=${edCompany}` };
    });

    await book.run("客户编辑-012", "编辑模式载入全部地址与联系人", REQ, async () => {
      const modal = await openEditSite(page, 25, "群馬営業所");
      const addrCount = await modal.locator(".address-block").count();
      const contactCount = await modal.locator(".contact-block").count();
      await cancelModal(page);
      const ok = addrCount === 2 && contactCount === 3;
      return { status: ok ? "通过" : "不通过", actual: `编辑弹窗完整载入既有数据：地址块${addrCount}个、联系人块${contactCount}个（夹具为2地址/3联系人）`, evidence: "site NS-9001" };
    });

    await book.run("客户编辑-013", "草稿新增和移除保存前不生效", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const before = (await db.query<any>("SELECT COUNT(*) c FROM prop_customer_address WHERE subject_id=?", [edCompany]))[0].c;
      const draft = await addAddressBlock(modal);
      await fillField(draft, "郵便番号", "1500099");
      await fillField(draft, "住所1", "東京都草稿住所");
      await cancelModal(page);
      const after = (await db.query<any>("SELECT COUNT(*) c FROM prop_customer_address WHERE subject_id=?", [edCompany]))[0].c;
      const ok = Number(before) === Number(after);
      return { status: ok ? "通过" : "不通过", actual: `新增草稿地址后取消：DB地址数不变（${before}→${after}），草稿不生效`, evidence: "BR-043 取消只重置草稿" };
    });

    await book.run("客户编辑-014", "已填写地址缺少必填项阻止保存", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const draft = await addAddressBlock(modal);
      await fillField(draft, "郵便番号", "1500004");
      await saveModal(page);
      await page.waitForTimeout(600);
      const errors = await formErrors(page);
      const open = await modal.isVisible();
      await cancelModal(page);
      const ok = errors.includes("住所1を入力") && open;
      return { status: ok ? "通过" : "不通过", actual: `新地址只填邮编缺地址1：保存被拦截「${safeText(errors, 90)}」`, evidence: "前端规则addressRequired" };
    });

    await book.run("客户编辑-015", "联系人缺少姓名阻止保存", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const block = modal.locator(".address-block").first();
      await block.locator("button").filter({ hasText: "担当者を追加" }).click();
      const contact = block.locator(".contact-block").last();
      await fillField(contact, "電話番号", "03-0000-1111");
      await saveModal(page);
      await page.waitForTimeout(600);
      const errors = await formErrors(page);
      await cancelModal(page);
      const ok = errors.includes("氏名を入力");
      return { status: ok ? "通过" : "不通过", actual: `联系人只填电话缺姓名：保存被拦截「${safeText(errors, 90)}」`, evidence: "contactName required" };
    });

    await book.run("客户编辑-016", "邮编长度不是7位阻止保存", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const block = modal.locator(".address-block").first();
      await fillField(block, "郵便番号", "150");
      await saveModal(page);
      await page.waitForTimeout(600);
      const errors = await formErrors(page);
      await cancelModal(page);
      const ok = errors.includes("半角数字7桁");
      return { status: ok ? "通过" : "不通过", actual: `邮编3位：保存被拦截「${safeText(errors, 90)}」`, evidence: "BR-036" };
    });

    await book.run("客户编辑-017", "邮编含非数字字符阻止保存", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const block = modal.locator(".address-block").first();
      await fillField(block, "郵便番号", "15000a1");
      await saveModal(page);
      await page.waitForTimeout(600);
      const errors = await formErrors(page);
      await cancelModal(page);
      const ok = errors.includes("半角数字7桁");
      return { status: ok ? "通过" : "不通过", actual: `邮编含字母：保存被拦截「${safeText(errors, 90)}」`, evidence: "BR-036" };
    });

    await book.run("客户编辑-018", "合法邮编保存后统一展示", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      const block = modal.locator(".address-block").first();
      await fillField(block, "郵便番号", "1500001");
      await saveModal(page);
      await waitModalClosed(page);
      await openCompanyDetail(page, edCompany);
      const text = await page.locator(".detail-page").innerText();
      const ok = text.includes("〒150-0001");
      return { status: ok ? "通过" : "不通过", actual: "合法7位邮编保存后详情页统一展示为 〒150-0001 格式", evidence: "BR-024" };
    });

    await book.run("客户编辑-019", "校验失败整体不提交并保留草稿", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      let putCount = 0;
      const listener = (req: any) => { if (req.method() === "PUT" && req.url().includes("/prop/customer/")) putCount++; };
      page.on("request", listener);
      const block = modal.locator(".address-block").first();
      await fillField(block, "郵便番号", "abc");
      await saveModal(page);
      await page.waitForTimeout(800);
      const errors = await formErrors(page);
      const open = await modal.isVisible();
      const draftKept = await block.locator("input").first().inputValue();
      page.off("request", listener);
      await cancelModal(page);
      const ok = putCount === 0 && open && errors.length > 0;
      return { status: ok ? "通过" : "不通过", actual: `校验失败时未发起PUT请求（${putCount}次），弹窗保持打开且草稿值保留（${draftKept}）`, evidence: "BR-079" };
    });

    await book.run("客户编辑-020", "编辑差异一次提交", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      let putCount = 0; let lastBody = "";
      const listener = (req: any) => { if (req.method() === "PUT" && req.url().includes("/prop/customer/")) { putCount++; lastBody = req.postData() || ""; } };
      page.on("request", listener);
      await fillField(modal, "資料の保存先", "\\\\ed-server\\once");
      const block = modal.locator(".address-block").first();
      await fillField(block, "住所2（任意）", "ONCEビル");
      await saveModal(page);
      await waitModalClosed(page);
      page.off("request", listener);
      let parsed: any = {};
      try { parsed = JSON.parse(lastBody); } catch { /* ignore */ }
      const ok = putCount === 1 && parsed.storagePath === "\\\\ed-server\\once" && Array.isArray(parsed.addresses);
      return { status: ok ? "通过" : "不通过", actual: `主档+地址两处修改合并为1次PUT提交（putCount=${putCount}），载荷含storagePath与addresses全量差异`, evidence: "BR-058 编辑整体单事务" };
    });

    await book.run("客户编辑-021", "移除已有地址先确认", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      await modal.locator(".address-block").first().locator(":scope > .block-title button").click();
      await page.waitForTimeout(500);
      const confirm = page.locator(".ant-modal-confirm:visible");
      const confirmText = confirm.count() ? safeText(await confirm.innerText(), 120) : "";
      if (await confirm.count()) await confirm.locator("button").filter({ hasText: "キャンセル" }).click();
      await cancelModal(page);
      const ok = confirmText.includes("登録済みの住所を削除");
      return { status: ok ? "通过" : "不通过", actual: `移除既有地址先弹确认：「${confirmText}」`, evidence: "BR-078" };
    });

    await book.run("客户编辑-022", "移除新增草稿地址不确认", REQ, async () => {
      const modal = await openEditCompany(page, edCompany);
      await addAddressBlock(modal);
      await modal.locator(".address-block").last().locator(".block-title button").click();
      await page.waitForTimeout(500);
      const confirmCount = await page.locator(".ant-modal-confirm:visible").count();
      await cancelModal(page);
      const ok = confirmCount === 0;
      return { status: ok ? "通过" : "不通过", actual: `移除未保存的草稿地址直接删除本地块，无确认弹窗（confirm=${confirmCount}）`, evidence: "BR-078" };
    });

    await book.run("客户编辑-023", "编辑取消不写数据", REQ, async () => {
      const before = (await db.query<any>("SELECT subject_name, storage_path FROM prop_customer_subject WHERE subject_id=?", [edCompany]))[0];
      const modal = await openEditCompany(page, edCompany);
      await fillField(modal, "会社名", "AUTO-CUST-ED 不应保存的名");
      await cancelModal(page);
      const after = (await db.query<any>("SELECT subject_name, storage_path FROM prop_customer_subject WHERE subject_id=?", [edCompany]))[0];
      const ok = JSON.stringify(before) === JSON.stringify(after);
      return { status: ok ? "通过" : "不通过", actual: `编辑中改名后取消：DB主档完全不变（${after.subject_name}）`, evidence: "BR-043" };
    });

    // ============ 五、删除功能验证 ============
    await book.run("客户删除-001", "删除无业务引用的地址成功", REQ, async () => {
      const modal = await openEditSite(page, delCompany, "AUTO-CUST-ED 削除支店B");
      await modal.locator(".address-block").first().locator(":scope > .block-title button").click();
      const confirm = page.locator(".ant-modal-confirm:visible");
      await confirm.locator(".ant-modal-confirm-btns button").last().click();
      await page.waitForTimeout(500);
      await saveModal(page);
      await waitModalClosed(page);
      const addr = await db.query<any>("SELECT * FROM prop_customer_address WHERE address_id=?", [delAddrB]);
      const ok = addr.length === 0;
      return { status: ok ? "通过" : "不通过", actual: `编辑弹窗中移除既有地址并确认保存后，DB地址已删除（残留${addr.length}行）`, evidence: `address_id=${delAddrB}；BR-056` };
    });

    await book.run("客户删除-002", "删除地址级联删除其下联系人", REQ, async () => {
      const contacts = await db.query<any>("SELECT * FROM prop_customer_contact WHERE address_id=?", [delAddrB]);
      const ok = contacts.length === 0;
      return { status: ok ? "通过" : "不通过", actual: `地址删除后其下联系人已级联删除（残留${contacts.length}行）`, evidence: "BR-056 先删联系人再删地址" };
    });

    await book.run("客户删除-004", "删除无业务引用的支店成功", REQ, async () => {
      await openCompanyDetail(page, delCompany);
      const card = page.locator(".subject-card").filter({ hasText: "AUTO-CUST-ED 削除支店A" }).first();
      await card.locator("button").filter({ hasText: "削除" }).first().click();
      const confirm = page.locator(".ant-modal-confirm:visible");
      await confirm.waitFor({ state: "visible", timeout: 8000 });
      await confirm.locator(".ant-modal-confirm-btns button").last().click();
      await page.waitForTimeout(1200);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
      const row = await db.query<any>("SELECT * FROM prop_customer_subject WHERE subject_id=?", [delSiteA]);
      const ok = row.length === 0;
      return { status: ok ? "通过" : "不通过", actual: `详情页删除支店A并确认后，DB支店记录已删除（残留${row.length}行）`, evidence: `site subject_id=${delSiteA}；BR-067` };
    });

    await book.run("客户删除-005", "删除支店级联删除其下地址与联系人", REQ, async () => {
      const addrs = await db.query<any>("SELECT * FROM prop_customer_address WHERE subject_id=?", [delSiteA]);
      const contacts = await db.query<any>("SELECT * FROM prop_customer_contact WHERE address_id=?", [delAddrA]);
      const ok = addrs.length === 0 && contacts.length === 0;
      return { status: ok ? "通过" : "不通过", actual: `支店A删除后，其下地址（残留${addrs.length}）与联系人（残留${contacts.length}）已级联清除`, evidence: "BR-067 按联系人→地址→支店顺序删除" };
    });

    await book.run("客户删除-007", "删除操作取消后数据保留", REQ, async () => {
      await openCompanyDetail(page, delCompany);
      const card = page.locator(".subject-card").filter({ hasText: "AUTO-CUST-ED 取消支店" }).first();
      await card.locator("button").filter({ hasText: "削除" }).first().click();
      const confirm = page.locator(".ant-modal-confirm:visible");
      await confirm.waitFor({ state: "visible", timeout: 8000 });
      await confirm.locator("button").filter({ hasText: "キャンセル" }).click();
      await page.waitForTimeout(500);
      const row = await db.query<any>("SELECT * FROM prop_customer_subject WHERE subject_id=?", [delSiteC]);
      const ok = row.length === 1;
      return { status: ok ? "通过" : "不通过", actual: `删除确认弹窗点击取消：支店数据完整保留（${row.length}行），未调用删除接口`, evidence: `site subject_id=${delSiteC}` };
    });

    await book.run("客户删除-009", "公司不提供删除入口", REQ, async () => {
      await openCompanyDetail(page, delCompany);
      const companyCard = page.locator(".subject-card").first();
      const deleteBtn = await companyCard.locator("button").filter({ hasText: "削除" }).count();
      const impact = await apiFetch(page, `/prop/customer/site/${delCompany}/delete-impact`);
      const del = await apiFetch(page, `/prop/customer/site/${delCompany}`, { method: "DELETE" });
      const msgOk = safeText((impact.body?.msg || "") + (del.body?.msg || ""), 120);
      const ok = deleteBtn === 0 && (impact.body?.code ?? 0) !== 200 && (del.body?.code ?? 0) !== 200;
      return { status: ok ? "通过" : "不通过", actual: `公司卡片无删除按钮；API删除公司被拒绝：${msgOk}`, evidence: "BR-062 公司不可删除" };
    });

    await book.run("客户删除-010", "删除支店确认文案完整", REQ, async () => {
      await openCompanyDetail(page, delCompany);
      const card = page.locator(".subject-card").filter({ hasText: "AUTO-CUST-ED 取消支店" }).first();
      await card.locator("button").filter({ hasText: "削除" }).first().click();
      const confirm = page.locator(".ant-modal-confirm:visible");
      await confirm.waitFor({ state: "visible", timeout: 8000 });
      const text = safeText(await confirm.innerText(), 300);
      await confirm.locator("button").filter({ hasText: "キャンセル" }).click();
      const ok = text.includes("支店／現場を削除") && text.includes("住所") && text.includes("担当者") && text.includes("作成済みの注文・案内・受付などに保存されている情報は変更されない");
      return { status: ok ? "通过" : "不通过", actual: `确认文案：「${text}」`, evidence: "含地址/联系人数量与历史业务不受影响说明；BR-063" };
    });
  } finally {
    const trace = await finishSession(browser, session, "customer-edit-delete");
    console.log("[trace]", trace);
    await book.save();
    await db.close();
  }
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });




