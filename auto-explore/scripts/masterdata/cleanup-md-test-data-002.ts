/**
 * 批次002（基础设置遗留 15 条复验）夹具清理。
 * 仅清理本批 AUTO- 夹具，保留 2026-10-27 及更早批次数据。
 * 用法：npx tsx scripts/masterdata/cleanup-md-test-data-002.ts [--execute]
 */
import { DbClient } from "../customer/customer-runtime-utils.js";

const EXECUTE = process.argv.includes("--execute");
const db = new DbClient();
await db.connect();

const steps: Array<{ label: string; sql: string; params?: unknown[] }> = [
  { label: "受付NG", sql: "DELETE FROM prop_reception_ng WHERE reception_id=?", params: [3] },
  { label: "作业检查", sql: "DELETE FROM prop_work_check WHERE reception_id=?", params: [3] },
  { label: "作业组", sql: "DELETE FROM prop_work_group WHERE reception_id=?", params: [3] },
  { label: "受付记录", sql: "DELETE FROM prop_reception WHERE reception_id=?", params: [3] },
  { label: "受付包", sql: "DELETE FROM prop_reception_package WHERE batch_id=?", params: [1] },
  { label: "受付批次", sql: "DELETE FROM prop_reception_batch WHERE batch_id=?", params: [1] },
  { label: "产品部件绑定", sql: "DELETE FROM prop_product_binding WHERE product_id IN (866,867)", params: [] },
  { label: "生产事件", sql: "DELETE FROM prop_production_event WHERE product_id IN (866,867)", params: [] },
  { label: "入库明细", sql: "DELETE FROM prop_intake_item WHERE product_id IN (866,867)", params: [] },
  { label: "产品", sql: "DELETE FROM prop_product WHERE product_id IN (866,867)", params: [] },
  { label: "部件个体", sql: "DELETE FROM prop_part_item WHERE part_id BETWEEN 1294 AND 1299", params: [] },
  { label: "入库批次", sql: "DELETE FROM prop_intake_batch WHERE batch_id IN (164,165)", params: [] },
  { label: "部件资料版本", sql: "DELETE FROM prop_part_profile_version WHERE profile_id IN (48,49,50)", params: [] },
  { label: "部件资料", sql: "DELETE FROM prop_part_profile WHERE profile_id IN (48,49,50)", params: [] },
  { label: "作业选项", sql: "DELETE FROM prop_work_option WHERE option_id IN (27,28)", params: [] },
];

const countOf = async (sql: string, params: unknown[] = []) => {
  const countSql = sql.replace(/^DELETE FROM\s+([^\s]+).*$/s, "SELECT COUNT(*) cnt FROM $1 $2")
    .replace(/\$2/, sql.match(/WHERE\s+(.+)$/s)?.[1] ? `WHERE ${sql.match(/WHERE\s+(.+)$/s)![1]}` : "");
  try {
    const rows = await db.query<{ cnt: number }>(countSql, params);
    return Number(rows[0]?.cnt ?? 0);
  } catch (error) {
    return -1;
  }
};

console.log(`模式：${EXECUTE ? "执行清理" : "仅盘点（dry-run）"}`);
let total = 0;
try {
  await db.query("START TRANSACTION");
  await db.execute("UPDATE prop_part_profile SET current_version_id=NULL WHERE profile_id IN (48,49,50)");
  for (const step of steps) {
    const before = EXECUTE ? 0 : await countOf(step.sql, step.params);
    if (!EXECUTE) {
      total += Math.max(before, 0);
      console.log(`[盘点] ${step.label}: ${before}`);
      continue;
    }
    const result = await db.execute(step.sql, step.params);
    total += result.affectedRows;
    console.log(`[清理] ${step.label}: ${result.affectedRows} 行`);
  }
  if (EXECUTE) {
    await db.query("COMMIT");
    console.log(`清理完成，合计 ${total} 行。`);
  } else {
    await db.query("ROLLBACK");
    console.log(`盘点完成，预计清理 ${total} 行。`);
  }
} catch (error) {
  await db.query("ROLLBACK").catch(() => undefined);
  console.error("清理失败，已回滚：", error);
  process.exitCode = 1;
} finally {
  await db.close();
}
