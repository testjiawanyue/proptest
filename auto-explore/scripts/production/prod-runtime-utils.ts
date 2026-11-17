/**
 * 产品生产模块运行时验证公共工具。
 * 复用 customer 模块的 ResultBook / DbClient / 会话助手，补充生产模块专用的
 * API 直连、夹具种数与页面操作助手。
 */
import type { Page } from "playwright";
import { config } from "../../src/config/index.js";
import { DbClient } from "../customer/customer-runtime-utils.js";

export { ResultBook, DbClient, launchAdminSession, finishSession, safeText } from "../customer/customer-runtime-utils.js";

export const apiBase = `${config.app.baseUrl}${config.app.apiPrefix}`;

export async function apiLogin(user: string, password: string): Promise<string> {
  const resp = await fetch(`${apiBase}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user, password }),
  });
  const body = (await resp.json()) as { code: number; token?: string; msg?: string };
  if (body.code !== 200 || !body.token) throw new Error(`API 登录失败：${body.msg ?? resp.status}`);
  return body.token;
}

export async function apiCall(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; code: number; msg: string; data: unknown }> {
  const resp = await fetch(`${apiBase}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await resp.text();
  let parsed: { code?: number; msg?: string; data?: unknown } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { msg: text.slice(0, 200) };
  }
  return { status: resp.status, code: parsed.code ?? -1, msg: parsed.msg ?? "", data: parsed.data };
}

/** 幂等入库夹具：通过后端 API 建档衣体+产品（UI 主流程已由衣体入库脚本覆盖）。 */
export async function intakeViaApi(token: string, profileId: number, numbers: string[]): Promise<void> {
  const res = await apiCall(token, "POST", "/prop/production/intake", { profileId, numbers });
  if (res.code !== 200) throw new Error(`入库夹具失败：${res.msg}`);
}

/** 幂等种入部件个体（已存在则复用）。 */
export async function seedPart(
  db: DbClient,
  input: { partNo: string; partType: string; profileId: number; remark: string },
): Promise<number> {
  const existing = await db.query<{ part_id: number }>(
    "SELECT part_id FROM prop_part_item WHERE active_part_no=? AND deleted_time IS NULL",
    [input.partNo],
  );
  if (existing.length) return existing[0].part_id;
  const profile = await db.query<{ current_version_id: number }>(
    "SELECT current_version_id FROM prop_part_profile WHERE profile_id=?",
    [input.profileId],
  );
  if (!profile.length) throw new Error(`资料不存在：profile_id=${input.profileId}`);
  const result = await db.execute(
    `INSERT INTO prop_part_item (part_no, active_part_no, part_type, source_type, current_profile_id, current_profile_version_id, create_by, create_time, remark)
     VALUES (?, ?, ?, 'assembly', ?, ?, 'AI自动探索', NOW(), ?)`,
    [input.partNo, input.partNo, input.partType, input.profileId, profile[0].current_version_id, input.remark],
  );
  return Number(result.insertId);
}

export async function readToasts(page: Page): Promise<string> {
  return page
    .locator(".ant-message span")
    .allInnerTexts()
    .then((texts) => texts.join(" | "))
    .catch(() => "");
}

/** 点击当前可见下拉中的指定选项（ant-design-vue 下拉挂载在 body）。 */
export async function pickOption(page: Page, text: string | RegExp): Promise<void> {
  const option = page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: text }).first();
  await option.click();
}

/** 长列表下拉（rc-virtual-list 虚拟滚动）：边滚动边找选项再点击。 */
export async function pickOptionScroll(page: Page, text: string | RegExp): Promise<void> {
  const option = page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: text }).first();
  const holder = page.locator(".ant-select-dropdown:visible .rc-virtual-list-holder").first();
  try {
    // 下拉会定位到当前已选项，先向上滚回列表顶部
    for (let i = 0; i < 12; i++) {
      if (await option.isVisible().catch(() => false)) break;
      await holder.hover();
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(120);
    }
    for (let i = 0; i < 60; i++) {
      if (await option.isVisible().catch(() => false)) {
        await option.click();
        return;
      }
      await holder.hover();
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(150);
    }
    await option.click({ timeout: 3000 });
  } catch (error) {
    await page.keyboard.press("Escape");
    throw error;
  }
}

/** 读取当前可见的确认/提示弹窗文本（无弹窗返回空串）。 */
export async function modalText(page: Page): Promise<string> {
  const modal = page.locator(".ant-modal:visible").last();
  return modal.innerText().catch(() => "");
}

export function compact(text: string, max = 260): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/** 幂等组装夹具：确保产品存在且必需部件（气囊/传感器/发生器1）齐全，达到待检状态。 */
export async function ensureQualifiedProduct(
  db: DbClient,
  token: string,
  productNo: string,
  jacketProfileId = 17,
): Promise<number> {
  const existing = await db.query<{ product_id: number }>(
    "SELECT product_id FROM prop_product WHERE active_manufacturing_no=? AND deleted_time IS NULL",
    [productNo],
  );
  let productId: number;
  if (existing.length) {
    productId = existing[0].product_id;
  } else {
    await intakeViaApi(token, jacketProfileId, [productNo]);
    const created = await db.query<{ product_id: number }>(
      "SELECT product_id FROM prop_product WHERE active_manufacturing_no=? AND deleted_time IS NULL",
      [productNo],
    );
    if (!created.length) throw new Error(`入库夹具未建档：${productNo}`);
    productId = created[0].product_id;
  }
  const slots: Array<[string, string, number]> = [
    ["airbag", "A", 2],
    ["sensor", "S", 3],
    ["inflator_1", "I", 4],
  ];
  for (const [slotType, suffix, profileId] of slots) {
    const bound = await db.query<{ cnt: number }>(
      "SELECT COUNT(*) cnt FROM prop_product_binding WHERE product_id=? AND slot_type=? AND ended_time IS NULL",
      [productId, slotType],
    );
    if (Number(bound[0].cnt) > 0) continue;
    const partId = await seedPart(db, {
      partNo: `${productNo}-${suffix}`,
      partType: slotType === "inflator_1" ? "inflator" : slotType,
      profileId,
      remark: `AUTO-FIXTURE-齐全产品夹具 ${productNo}`,
    });
    await db.execute(
      `INSERT INTO prop_product_binding (product_id, part_id, slot_type, active_slot_key, active_part_key, started_by, started_time)
       VALUES (?, ?, ?, ?, ?, 'AI自动探索', NOW())`,
      [productId, partId, slotType, `${productId}:${slotType}`, String(partId)],
    );
  }
  return productId;
}
