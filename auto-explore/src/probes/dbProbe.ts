import mysql from "mysql2/promise";
import { config } from "../config/index.js";
import { assertBusinessDbOnly } from "../guardrails/guardrails.js";

export interface DbSnapshot {
  label: string;
  rows: Record<string, unknown>[];
  takenAt: string;
}

export interface DbDiff {
  label: string;
  beforeCount: number;
  afterCount: number;
  added: Record<string, unknown>[];
  removed: Record<string, unknown>[];
}

export class DbProbe {
  private pool: mysql.Pool | null = null;

  async connect(): Promise<void> {
    assertBusinessDbOnly(config.db.database);
    this.pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      connectionLimit: 3,
    });
    await this.pool.query("SELECT 1");
  }

  async snapshot(label: string, sql: string, params: unknown[] = []): Promise<DbSnapshot> {
    this.assertConnected();
    const [rows] = await this.pool!.query(sql, params);
    return { label, rows: rows as Record<string, unknown>[], takenAt: new Date().toISOString() };
  }

  diff(label: string, before: DbSnapshot, after: DbSnapshot, keyField: string): DbDiff {
    const keyOf = (row: Record<string, unknown>): string => String(row[keyField]);
    const beforeKeys = new Set(before.rows.map(keyOf));
    const afterKeys = new Set(after.rows.map(keyOf));
    return {
      label,
      beforeCount: before.rows.length,
      afterCount: after.rows.length,
      added: after.rows.filter((row) => !beforeKeys.has(keyOf(row))),
      removed: before.rows.filter((row) => !afterKeys.has(keyOf(row))),
    };
  }

  async close(): Promise<void> {
    await this.pool?.end();
    this.pool = null;
  }

  private assertConnected(): void {
    if (!this.pool) throw new Error("DbProbe not connected. Call connect() first.");
  }
}
