/**
 * 只读盘点所有业务表中包含 AUTO 的数据。
 * 用法：npx tsx scripts/cleanup/inventory-auto-data.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { mkdir, writeFile } from "node:fs/promises";

type ColumnRow = {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  COLUMN_KEY: string;
};

type ForeignKeyRow = {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
  CONSTRAINT_NAME: string;
  DELETE_RULE: string;
};

const DB = process.env.DB_NAME ?? "";
const OUTPUT = "reports/cleanup-auto-inventory.json";
const SCAN_TYPES = new Set(["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "json"]);

function quoteIdent(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function truncate(value: unknown, max = 240): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `<buffer ${value.length} bytes>`;
  if (typeof value === "string" && value.length > max) return `${value.slice(0, max)}...`;
  return value;
}

async function main(): Promise<void> {
  if (!DB) throw new Error("DB_NAME 未配置");
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: DB,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
  try {
    const [columns] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME LIKE 'prop\\_%'
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    );
    const [fkRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT k.TABLE_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
              k.CONSTRAINT_NAME, r.DELETE_RULE
         FROM information_schema.KEY_COLUMN_USAGE k
         JOIN information_schema.REFERENTIAL_CONSTRAINTS r
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
        WHERE k.TABLE_SCHEMA = DATABASE()
          AND k.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY k.TABLE_NAME, k.COLUMN_NAME`,
    );
    const foreignKeys = fkRows as ForeignKeyRow[];

    const byTable = new Map<string, ColumnRow[]>();
    for (const raw of columns as ColumnRow[]) {
      if (!SCAN_TYPES.has(String(raw.DATA_TYPE).toLowerCase())) continue;
      const list = byTable.get(raw.TABLE_NAME) ?? [];
      list.push(raw);
      byTable.set(raw.TABLE_NAME, list);
    }

    const matches: Array<Record<string, unknown>> = [];
    let matchedColumns = 0;
    let matchedCount = 0;
    for (const [table, tableColumns] of byTable) {
      const pkColumns = tableColumns.filter((c) => c.COLUMN_KEY === "PRI").map((c) => c.COLUMN_NAME);
      for (const column of tableColumns) {
        const where = `CAST(${quoteIdent(column.COLUMN_NAME)} AS CHAR) LIKE '%AUTO%'`;
        const [countRows] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT COUNT(*) cnt FROM ${quoteIdent(table)} WHERE ${where}`,
        );
        const count = Number(countRows[0]?.cnt ?? 0);
        if (count === 0) continue;
        matchedColumns += 1;
        matchedCount += count;

        const selected = [...new Set([...pkColumns, column.COLUMN_NAME])]
          .map((name) => `${quoteIdent(name)}${name === column.COLUMN_NAME ? " AS match_value" : ""}`)
          .join(", ");
        const [sampleRows] = await conn.query<mysql.RowDataPacket[]>(
          `SELECT ${selected} FROM ${quoteIdent(table)} WHERE ${where} LIMIT 3`,
        );
        matches.push({
          table,
          column: column.COLUMN_NAME,
          dataType: column.DATA_TYPE,
          count,
          primaryKeys: pkColumns,
          samples: sampleRows.map((row) => {
            const out: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(row)) out[key] = truncate(value);
            return out;
          }),
        });
      }
    }

    const tableNames = [...byTable.keys()];
    const tableCounts: Record<string, number> = {};
    for (const table of tableNames) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) cnt FROM ${quoteIdent(table)}`);
      tableCounts[table] = Number(rows[0]?.cnt ?? 0);
    }

    const payload = {
      generatedAt: new Date().toISOString(),
      database: DB,
      scannedTables: tableNames.length,
      matchedColumns,
      matchedCount,
      matches,
      tableCounts,
      foreignKeys,
    };
    await mkdir("reports", { recursive: true });
    await writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`database=${DB} scannedTables=${tableNames.length} matchedColumns=${matchedColumns} matchedRowsByColumn=${matchedCount}`);
    for (const item of matches) {
      console.log(`${item.table}.${item.column}\t${item.count}\t${JSON.stringify(item.samples).slice(0, 300)}`);
    }
    console.log(`written=${OUTPUT}`);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("盘点失败：", error);
  process.exit(1);
});
