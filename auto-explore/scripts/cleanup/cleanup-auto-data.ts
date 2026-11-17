/**
 * 清理所有 prop_* 业务表中带 AUTO 的测试数据及其外键后代。
 * 默认 dry-run；加 --execute 才执行删除。
 *
 * 保护策略：
 * - 所有不含 AUTO 的订单/产品/部件/客户/地址/联系人/部件资料/基础数据/作业选项行不删除；
 * - 订单 17、产品 20/35 的完整依赖闭包保留；
 * - 非 AUTO 行若被 AUTO 行引用，作为必需父级保留；
 * - 系统表 sys_*、QRTZ_*、gen_* 不处理。
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { mkdir, writeFile } from "node:fs/promises";

const EXECUTE = process.argv.includes("--execute");
const OUTPUT = "reports/cleanup-auto-plan.json";

type IRow = mysql.RowDataPacket;
type Meta = { name: string; pks: string[]; textColumns: string[] };
type DbKey = string;

type FkGroup = {
  name: string;
  childTable: string;
  parentTable: string;
  childColumns: string[];
  parentColumns: string[];
};

const PROTECT_SEED_TABLES = new Set([
  "prop_order",
  "prop_product",
]);

const NO_CHILD_EXPAND = new Set([
  "prop_part_item",
  "prop_customer_subject",
  "prop_customer_address",
  "prop_customer_contact",
  "prop_part_profile",
  "prop_part_profile_version",
  "prop_base_data",
  "prop_work_option",
]);

const TEXT_TYPES = new Set(["char", "varchar", "tinytext", "text", "mediumtext", "longtext", "json"]);

function q(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function keyOf(values: unknown[]): DbKey {
  return JSON.stringify(values.map((value) => (value === null ? null : String(value))));
}

function valuesOf(key: DbKey): string[] {
  return JSON.parse(key) as string[];
}

function addKey(map: Map<string, Set<DbKey>>, table: string, values: unknown[]): boolean {
  let set = map.get(table);
  if (!set) {
    set = new Set();
    map.set(table, set);
  }
  const key = keyOf(values);
  if (set.has(key)) return false;
  set.add(key);
  return true;
}

function selectPk(meta: Meta, alias = ""): string {
  const prefix = alias ? `${alias}.` : "";
  return meta.pks.map((name) => `${prefix}${q(name)}`).join(", ");
}

function pkInCondition(meta: Meta, keys: Iterable<DbKey>, alias = ""): { sql: string; params: string[] } {
  const list = [...keys];
  const prefix = alias ? `${alias}.` : "";
  const columns = meta.pks.map((name) => `${prefix}${q(name)}`);
  if (columns.length === 1) {
    return {
      sql: `${columns[0]} IN (${list.map(() => "?").join(",")})`,
      params: list.map((key) => valuesOf(key)[0]),
    };
  }
  const tuples = list.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
  return { sql: `(${columns.join(",")}) IN (${tuples})`, params: list.flatMap(valuesOf) };
}

function joinCondition(group: FkGroup, childAlias = "c", parentAlias = "p"): string {
  return group.childColumns
    .map((column, index) => `${childAlias}.${q(column)} = ${parentAlias}.${q(group.parentColumns[index])}`)
    .join(" AND ");
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
    multipleStatements: false,
  });

  const metas = new Map<string, Meta>();
  const autoRoots = new Map<string, Set<DbKey>>();
  const protectedKeys = new Map<string, Set<DbKey>>();
  const deletedKeys = new Map<string, Set<DbKey>>();
  const subtreeQueue: Array<{ table: string; key: DbKey }> = [];

  try {
    const [columnRows] = await conn.query<IRow[]>(
      `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'prop\\_%'
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    );
    for (const row of columnRows) {
      const table = String(row.TABLE_NAME);
      const meta = metas.get(table) ?? { name: table, pks: [], textColumns: [] };
      if (row.COLUMN_KEY === "PRI") meta.pks.push(String(row.COLUMN_NAME));
      if (TEXT_TYPES.has(String(row.DATA_TYPE).toLowerCase())) meta.textColumns.push(String(row.COLUMN_NAME));
      metas.set(table, meta);
    }

    const [fkRows] = await conn.query<IRow[]>(
      `SELECT k.CONSTRAINT_NAME, k.TABLE_NAME child_table, k.COLUMN_NAME child_column,
              k.REFERENCED_TABLE_NAME parent_table, k.REFERENCED_COLUMN_NAME parent_column,
              k.ORDINAL_POSITION
         FROM information_schema.KEY_COLUMN_USAGE k
        WHERE k.TABLE_SCHEMA = DATABASE()
          AND k.REFERENCED_TABLE_NAME IS NOT NULL
          AND k.TABLE_NAME LIKE 'prop\\_%'
          AND k.REFERENCED_TABLE_NAME LIKE 'prop\\_%'
        ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`,
    );
    const fkGroups: FkGroup[] = [];
    const groupMap = new Map<string, FkGroup>();
    for (const row of fkRows) {
      const name = String(row.CONSTRAINT_NAME);
      let group = groupMap.get(name);
      if (!group) {
        group = {
          name,
          childTable: String(row.child_table),
          parentTable: String(row.parent_table),
          childColumns: [],
          parentColumns: [],
        };
        groupMap.set(name, group);
        fkGroups.push(group);
      }
      group.childColumns.push(String(row.child_column));
      group.parentColumns.push(String(row.parent_column));
    }

    const autoCondition = (meta: Meta): string =>
      meta.textColumns.length
        ? `(${meta.textColumns
            .map((column) => `COALESCE(CAST(${q(column)} AS CHAR), '') LIKE '%AUTO%'`)
            .join(" OR ")})`
        : "FALSE";

    const keysWhere = async (meta: Meta, where: string): Promise<Set<DbKey>> => {
      const [rows] = await conn.query<IRow[]>(`SELECT ${selectPk(meta)} FROM ${q(meta.name)} WHERE ${where}`);
      return new Set(rows.map((row) => keyOf(meta.pks.map((column) => row[column]))));
    };

    // 1. AUTO 根行
    for (const meta of metas.values()) {
      if (!meta.textColumns.length) continue;
      const set = await keysWhere(meta, autoCondition(meta));
      if (set.size) autoRoots.set(meta.name, set);
    }

    // 2. 非 AUTO 顶层实体种子
    for (const table of PROTECT_SEED_TABLES) {
      const meta = metas.get(table) ?? (() => { throw new Error(`缺少表元数据 ${table}`); })();
      const set = await keysWhere(meta, `NOT ${autoCondition(meta)}`);
      for (const key of set) {
        addKey(protectedKeys, table, valuesOf(key));
      }
    }

    // 3. 明确保护的基线：订单 17、产品 20/35
    for (const [table, column, values] of [
      ["prop_order", "order_id", ["17"]],
      ["prop_product", "product_id", ["20", "35"]],
    ] as const) {
      const meta = metas.get(table)!;
      const [rows] = await conn.query<IRow[]>(
        `SELECT ${selectPk(meta)} FROM ${q(table)} WHERE ${q(column)} IN (${values.map(() => "?").join(",")})`,
        values,
      );
      for (const row of rows) {
        const keyValues = meta.pks.map((pk) => row[pk]);
        addKey(protectedKeys, table, keyValues);
        subtreeQueue.push({ table, key: keyOf(keyValues) });
      }
    }

    const expandParents = async (): Promise<boolean> => {
      let changed = false;
      for (const group of fkGroups) {
        const childKeys = protectedKeys.get(group.childTable);
        const parentMeta = metas.get(group.parentTable);
        const childMeta = metas.get(group.childTable);
        if (!childKeys?.size || !parentMeta || !childMeta) continue;
        const inClause = pkInCondition(childMeta, childKeys, "c");
        const [rows] = await conn.query<IRow[]>(
          `SELECT DISTINCT ${selectPk(parentMeta, "p")}
             FROM ${q(group.parentTable)} p
             JOIN ${q(group.childTable)} c ON ${joinCondition(group)}
            WHERE ${inClause.sql}`,
          inClause.params,
        );
        for (const row of rows) {
          if (addKey(protectedKeys, group.parentTable, parentMeta.pks.map((pk) => row[pk]))) changed = true;
        }
      }
      return changed;
    };

    const expandProtectedChildren = async (): Promise<boolean> => {
      let changed = false;
      while (subtreeQueue.length) {
        const current = subtreeQueue.shift()!;
        if (NO_CHILD_EXPAND.has(current.table)) continue;
        for (const group of fkGroups.filter((item) => item.parentTable === current.table)) {
          const parentMeta = metas.get(group.parentTable)!;
          const childMeta = metas.get(group.childTable)!;
          const inClause = pkInCondition(parentMeta, [current.key], "p");
          const [rows] = await conn.query<IRow[]>(
            `SELECT DISTINCT ${selectPk(childMeta, "c")}
               FROM ${q(group.parentTable)} p
               JOIN ${q(group.childTable)} c ON ${joinCondition(group)}
              WHERE ${inClause.sql}`,
            inClause.params,
          );
          const autoSet = autoRoots.get(group.childTable);
          for (const row of rows) {
            const keyValues = childMeta.pks.map((pk) => row[pk]);
            const key = keyOf(keyValues);
            if (autoSet?.has(key)) continue;
            if (addKey(protectedKeys, group.childTable, keyValues)) {
              changed = true;
              subtreeQueue.push({ table: group.childTable, key });
            }
          }
        }
      }
      return changed;
    };

    // 4. 保护闭包：保留行向上补齐父级；订单 17/产品 20/35 向下补齐非 AUTO 子级
    for (let round = 0; round < 20; round += 1) {
      const parentChanged = await expandParents();
      const childChanged = await expandProtectedChildren();
      if (!parentChanged && !childChanged) break;
    }

    // 5. AUTO 删除闭包：根行 + 全部外键后代
    for (const [table, set] of autoRoots) {
      for (const key of set) addKey(deletedKeys, table, valuesOf(key));
    }
    for (let round = 0; round < 50; round += 1) {
      let changed = false;
      for (const group of fkGroups) {
        const parentKeys = deletedKeys.get(group.parentTable);
        const parentMeta = metas.get(group.parentTable);
        const childMeta = metas.get(group.childTable);
        if (!parentKeys?.size || !parentMeta || !childMeta) continue;
        const inClause = pkInCondition(parentMeta, parentKeys, "p");
        const [rows] = await conn.query<IRow[]>(
          `SELECT DISTINCT ${selectPk(childMeta, "c")}
             FROM ${q(group.parentTable)} p
             JOIN ${q(group.childTable)} c ON ${joinCondition(group)}
            WHERE ${inClause.sql}`,
          inClause.params,
        );
        for (const row of rows) {
          if (addKey(deletedKeys, group.childTable, childMeta.pks.map((pk) => row[pk]))) changed = true;
        }
      }
      if (!changed) break;
    }

    // 6. 保护集合优先，从删除集合剔除
    const protectedAutoRows: Array<{ table: string; count: number }> = [];
    for (const [table, pset] of protectedKeys) {
      const dset = deletedKeys.get(table);
      if (!dset) continue;
      const autoSet = autoRoots.get(table);
      let autoProtected = 0;
      for (const key of pset) {
        if (dset.delete(key) && autoSet?.has(key)) autoProtected += 1;
      }
      if (autoProtected) protectedAutoRows.push({ table, count: autoProtected });
    }
    for (const [table, set] of deletedKeys) if (!set.size) deletedKeys.delete(table);

    const planRows = [...deletedKeys.entries()]
      .map(([table, set]) => ({ table, count: set.size }))
      .sort((a, b) => b.count - a.count || a.table.localeCompare(b.table));
    const total = planRows.reduce((sum, row) => sum + row.count, 0);
    const plan = {
      generatedAt: new Date().toISOString(),
      database: process.env.DB_NAME,
      execute: EXECUTE,
      protectedBaseline: ["prop_order#17", "prop_product#20", "prop_product#35"],
      autoRootTables: [...autoRoots.entries()].map(([table, set]) => ({ table, count: set.size })).sort((a, b) => b.count - a.count),
      protectedAutoRows,
      deleteTables: planRows,
      deleteTotal: total,
    };
    await mkdir("reports", { recursive: true });
    await writeFile(OUTPUT, JSON.stringify(plan, null, 2), "utf-8");

    console.log(`模式=${EXECUTE ? "执行" : "dry-run"} 删除表=${planRows.length} 删除行=${total}`);
    console.log("== 删除计划 ==");
    for (const row of planRows) console.log(`${row.table}\t${row.count}`);
    console.log("== 保留的 AUTO 行（基线依赖） ==");
    for (const row of protectedAutoRows) console.log(`${row.table}\t${row.count}`);
    console.log(`plan=${OUTPUT}`);

    if (!EXECUTE) return;

    await conn.query("START TRANSACTION");
    try {
      await conn.query("SET FOREIGN_KEY_CHECKS=0");
      let deleted = 0;
      for (const [table, set] of deletedKeys) {
        const meta = metas.get(table)!;
        const keys = [...set];
        for (let offset = 0; offset < keys.length; offset += 100) {
          const chunk = keys.slice(offset, offset + 100);
          const inClause = pkInCondition(meta, chunk);
          const [result] = await conn.query<mysql.ResultSetHeader>(
            `DELETE FROM ${q(table)} WHERE ${inClause.sql}`,
            inClause.params,
          );
          deleted += result.affectedRows;
          console.log(`[清理] ${table} ${offset + 1}-${offset + chunk.length}/${keys.length} affected=${result.affectedRows}`);
        }
      }
      await conn.query("SET FOREIGN_KEY_CHECKS=1");
      await conn.query("COMMIT");
      console.log(`清理完成，合计 ${deleted} 行。`);
    } catch (error) {
      await conn.query("SET FOREIGN_KEY_CHECKS=1").catch(() => undefined);
      await conn.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error("清理失败：", error);
  process.exit(1);
});
