/**
 * 产品生产模块测试数据清理（批次 006/007 遗留范围）。
 * 范围：批次006 = AUTO-B101~B106 / AUTO-R100 / AUTO-JF01 / AUTO-BA10x / AUTO-SE10x / AUTO-BI10x
 *      / AUTO-SEED-S1 / AUTO-SEED-A1 / AUTO-SEED-A2 / AUTO-FREE01 / 002 撞号夹具；
 *      批次007 = AUTO-N28% / AUTO-R29% / AUTO-C% / AUTO-D% / AUTO-Q% 及
 *      单号 001/002/003/999/A001/0001 与其派生夹具部件（001-A 等）。
 * 不动批次005遗留（AUTO-J001~J004 等）与其他模块数据（AUTO-MD-* 等）。
 * 默认仅盘点打印；加 --execute 才执行删除。
 * 删除顺序：prop_production_event → prop_inspection → prop_product_binding → prop_product → prop_part_item
 */
import { DbClient } from "./prod-runtime-utils.js";

const EXECUTE = process.argv.includes("--execute");

const PRODUCT_WHERE =
  "(manufacturing_no LIKE 'AUTO-B10%' OR manufacturing_no LIKE 'AUTO-N28%' OR manufacturing_no LIKE 'AUTO-R29%'" +
  " OR manufacturing_no LIKE 'AUTO-C%' OR manufacturing_no LIKE 'AUTO-D%' OR manufacturing_no LIKE 'AUTO-Q%'" +
  " OR manufacturing_no IN ('AUTO-R100', 'AUTO-JF01', '001', '002', '003', '999', 'A001', '0001'))";
const PART_WHERE = `(
  part_no LIKE 'AUTO-B10%' OR part_no LIKE 'AUTO-BA10%'
  OR part_no LIKE 'AUTO-SE10%' OR part_no LIKE 'AUTO-BI10%'
  OR part_no LIKE 'AUTO-N28%' OR part_no LIKE 'AUTO-R29%' OR part_no LIKE 'AUTO-C%'
  OR part_no LIKE 'AUTO-D%' OR part_no LIKE 'AUTO-Q%'
  OR part_no LIKE '001-%' OR part_no LIKE '002-%' OR part_no LIKE '003-%'
  OR part_no LIKE '999-%' OR part_no LIKE 'A001-%' OR part_no LIKE '0001-%'
  OR part_no IN ('AUTO-R100', 'AUTO-JF01', 'AUTO-SEED-S1', 'AUTO-SEED-A1', 'AUTO-SEED-A2', 'AUTO-FREE01', '002')
)`;

type ProductRow = {
  product_id: number;
  manufacturing_no: string;
  m_no: string;
  deleted_time: string | null;
  create_by: string;
  create_time: string;
  remark: string | null;
};
type PartRow = {
  part_id: number;
  part_no: string;
  part_type: string;
  deleted_time: string | null;
  create_by: string;
  create_time: string;
  remark: string | null;
};

async function main(): Promise<void> {
  const db = new DbClient();
  try {
    await db.connect();
    const refs = await db.query<{ table_name: string; column_name: string; referenced_table_name: string }>(
      `SELECT TABLE_NAME table_name, COLUMN_NAME column_name, REFERENCED_TABLE_NAME referenced_table_name
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE REFERENCED_TABLE_NAME IN ('prop_product', 'prop_part_item') AND TABLE_SCHEMA = DATABASE()`,
    );
    console.log("== 外键引用 ==");
    for (const row of refs) console.log(`  ${row.table_name}.${row.column_name} -> ${row.referenced_table_name}`);

    const products = await db.query<ProductRow>(
      `SELECT product_id, manufacturing_no, m_no, deleted_time, create_by, create_time, remark FROM prop_product WHERE ${PRODUCT_WHERE} ORDER BY product_id`,
    );
    const parts = await db.query<PartRow>(
      `SELECT part_id, part_no, part_type, deleted_time, create_by, create_time, remark FROM prop_part_item WHERE ${PART_WHERE} ORDER BY part_id`,
    );

    console.log(`== 命中产品 ${products.length} 条 ==`);
    for (const row of products)
      console.log(`  #${row.product_id} ${row.manufacturing_no} m=${row.m_no} deleted=${row.deleted_time ?? "否"} by=${row.create_by} at=${row.create_time} remark=${row.remark ?? ""}`);
    console.log(`== 命中部件 ${parts.length} 条 ==`);
    for (const row of parts)
      console.log(`  #${row.part_id} ${row.part_no} [${row.part_type}] deleted=${row.deleted_time ?? "否"} by=${row.create_by} at=${row.create_time} remark=${row.remark ?? ""}`);

    if (!EXECUTE) {
      console.log("\n（盘点模式，未删除；确认后加 --execute 执行）");
      return;
    }

    const productIds = products.map((row) => row.product_id);
    const partIds = parts.map((row) => row.part_id);
    if (!productIds.length && !partIds.length) {
      console.log("无命中数据，无需清理。");
      return;
    }
    const inList = (ids: number[]): string => (ids.length ? ids.join(",") : "-1");

    const reception = await db.query<{ cnt: number }>(
      `SELECT (SELECT COUNT(*) FROM prop_reception WHERE product_id IN (${inList(productIds)}))
       + (SELECT COUNT(*) FROM prop_reception_batch WHERE first_product_id IN (${inList(productIds)})) cnt`,
    );
    if (Number(reception[0].cnt) > 0) {
      console.error(`命中产品存在受付/批次记录 ${reception[0].cnt} 条，超出本脚本清理范围，已中止。`);
      process.exit(1);
    }

    const steps: Array<[string, string]> = [
      ["prop_production_event", `DELETE FROM prop_production_event WHERE product_id IN (${inList(productIds)}) OR part_id IN (${inList(partIds)}) OR related_part_id IN (${inList(partIds)})`],
      ["prop_inspection", `DELETE FROM prop_inspection WHERE product_id IN (${inList(productIds)})`],
      ["prop_intake_item", `DELETE FROM prop_intake_item WHERE product_id IN (${inList(productIds)}) OR part_id IN (${inList(partIds)})`],
      ["prop_product_order_relation", `DELETE FROM prop_product_order_relation WHERE product_id IN (${inList(productIds)})`],
      ["prop_product_binding", `DELETE FROM prop_product_binding WHERE product_id IN (${inList(productIds)}) OR part_id IN (${inList(partIds)})`],
      ["prop_product", `DELETE FROM prop_product WHERE product_id IN (${inList(productIds)})`],
      ["prop_part_item", `DELETE FROM prop_part_item WHERE part_id IN (${inList(partIds)})`],
    ];
    for (const [table, sql] of steps) {
      const result = await db.execute(sql);
      console.log(`已清理 ${table}：${result.affectedRows} 行`);
    }
    console.log("清理完成。");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error("清理失败：", error);
  process.exit(1);
});
