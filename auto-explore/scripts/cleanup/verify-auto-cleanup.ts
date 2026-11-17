/** 校验 AUTO 清理后的外键与基线完整性。用法：npx tsx scripts/cleanup/verify-auto-cleanup.ts */
import "dotenv/config";
import mysql from "mysql2/promise";
import { writeFile } from "node:fs/promises";

type IRow = mysql.RowDataPacket;
type FkGroup = {
  name: string;
  childTable: string;
  parentTable: string;
  childColumns: string[];
  parentColumns: string[];
};

function q(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function joinCondition(group: FkGroup): string {
  return group.childColumns
    .map((column, index) => `c.${q(column)} = p.${q(group.parentColumns[index])}`)
    .join(" AND ");
}

function notNullCondition(group: FkGroup): string {
  return group.childColumns.map((column) => `c.${q(column)} IS NOT NULL`).join(" AND ");
}

async function main(): Promise<void> {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  try {
    const [fkRows] = await conn.query<IRow[]>(
      `SELECT k.CONSTRAINT_NAME, k.TABLE_NAME child_table, k.COLUMN_NAME child_column,
              k.REFERENCED_TABLE_NAME parent_table, k.REFERENCED_COLUMN_NAME parent_column
         FROM information_schema.KEY_COLUMN_USAGE k
        WHERE k.TABLE_SCHEMA = DATABASE()
          AND k.REFERENCED_TABLE_NAME IS NOT NULL
          AND k.TABLE_NAME LIKE 'prop\\_%'
          AND k.REFERENCED_TABLE_NAME LIKE 'prop\\_%'
        ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    );
    const groups = new Map<string, FkGroup>();
    for (const row of fkRows) {
      const name = String(row.CONSTRAINT_NAME);
      const group = groups.get(name) ?? {
        name,
        childTable: String(row.child_table),
        parentTable: String(row.parent_table),
        childColumns: [],
        parentColumns: [],
      };
      group.childColumns.push(String(row.child_column));
      group.parentColumns.push(String(row.parent_column));
      groups.set(name, group);
    }

    const orphans: Array<Record<string, unknown>> = [];
    for (const group of groups.values()) {
      const [rows] = await conn.query<IRow[]>(
        `SELECT COUNT(*) cnt
           FROM ${q(group.childTable)} c
           LEFT JOIN ${q(group.parentTable)} p ON ${joinCondition(group)}
          WHERE ${notNullCondition(group)} AND p.${q(group.parentColumns[0])} IS NULL`,
      );
      const count = Number(rows[0]?.cnt ?? 0);
      if (count) {
        orphans.push({ constraint: group.name, childTable: group.childTable, parentTable: group.parentTable, count });
      }
    }

    const [orderRefs] = await conn.query<IRow[]>(
      `SELECT o.order_id
         FROM prop_order o
         LEFT JOIN prop_customer_subject s1 ON s1.subject_id = o.ordering_party_id
         LEFT JOIN prop_customer_subject s2 ON s2.subject_id = o.recipient_id
         LEFT JOIN prop_customer_subject s3 ON s3.subject_id = o.billing_party_id
         LEFT JOIN prop_customer_address a ON a.address_id = o.delivery_address_id
         LEFT JOIN prop_customer_contact ct ON ct.contact_id = o.delivery_contact_id
        WHERE s1.subject_id IS NULL OR s2.subject_id IS NULL OR s3.subject_id IS NULL
           OR a.address_id IS NULL OR ct.contact_id IS NULL`,
    );

    const [productRefs] = await conn.query<IRow[]>(
      `SELECT p.product_id
         FROM prop_product p
         LEFT JOIN prop_shipment s1 ON s1.shipment_id = p.baseline_shipment_id
         LEFT JOIN prop_shipment s2 ON s2.shipment_id = p.name_adopted_shipment_id
        WHERE (p.baseline_shipment_id IS NOT NULL AND s1.shipment_id IS NULL)
           OR (p.name_adopted_shipment_id IS NOT NULL AND s2.shipment_id IS NULL)`,
    );

    const [partRefs] = await conn.query<IRow[]>(
      `SELECT p.part_id
         FROM prop_part_item p
         LEFT JOIN prop_part_profile pr ON pr.profile_id = p.current_profile_id
         LEFT JOIN prop_part_profile_version v ON v.version_id = p.current_profile_version_id
         LEFT JOIN prop_base_data b ON b.data_id = p.current_firmware_id
        WHERE (p.current_profile_id IS NOT NULL AND pr.profile_id IS NULL)
           OR (p.current_profile_version_id IS NOT NULL AND v.version_id IS NULL)
           OR (p.current_firmware_id IS NOT NULL AND b.data_id IS NULL)`,
    );

    const expected = [
      ["order17", "SELECT COUNT(*) cnt FROM prop_order WHERE order_id=17"],
      ["product20", "SELECT COUNT(*) cnt FROM prop_product WHERE product_id=20"],
      ["product35", "SELECT COUNT(*) cnt FROM prop_product WHERE product_id=35"],
      ["subject1", "SELECT COUNT(*) cnt FROM prop_customer_subject WHERE subject_id=1"],
      ["subject74", "SELECT COUNT(*) cnt FROM prop_customer_subject WHERE subject_id=74"],
      ["address48", "SELECT COUNT(*) cnt FROM prop_customer_address WHERE address_id=48"],
      ["contact53", "SELECT COUNT(*) cnt FROM prop_customer_contact WHERE contact_id=53"],
    ] as const;
    const baseline: Record<string, number> = {};
    for (const [name, sql] of expected) {
      const [rows] = await conn.query<IRow[]>(sql);
      baseline[name] = Number(rows[0]?.cnt ?? 0);
    }

    const [counts] = await conn.query<IRow[]>(
      `SELECT 'prop_order' t,COUNT(*) n FROM prop_order
       UNION ALL SELECT 'prop_product',COUNT(*) FROM prop_product
       UNION ALL SELECT 'prop_part_item',COUNT(*) FROM prop_part_item
       UNION ALL SELECT 'prop_customer_subject',COUNT(*) FROM prop_customer_subject
       UNION ALL SELECT 'prop_customer_address',COUNT(*) FROM prop_customer_address
       UNION ALL SELECT 'prop_customer_contact',COUNT(*) FROM prop_customer_contact
       UNION ALL SELECT 'prop_shipment',COUNT(*) FROM prop_shipment
       UNION ALL SELECT 'prop_shipment_file',COUNT(*) FROM prop_shipment_file
       UNION ALL SELECT 'prop_product_order_relation',COUNT(*) FROM prop_product_order_relation`,
    );

    const payload = {
      checkedAt: new Date().toISOString(),
      database: process.env.DB_NAME,
      fkGroups: groups.size,
      orphanCount: orphans.length,
      orphans,
      orderReferenceErrors: orderRefs.map((row) => row.order_id),
      productReferenceErrors: productRefs.map((row) => row.product_id),
      partReferenceErrors: partRefs.map((row) => row.part_id),
      baseline,
      remainingCounts: Object.fromEntries(counts.map((row) => [String(row.t), Number(row.n)])),
    };
    await writeFile("reports/cleanup-auto-verify.json", JSON.stringify(payload, null, 2), "utf-8");
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("校验失败：", error);
  process.exit(1);
});
