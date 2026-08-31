import { createHash } from "node:crypto";
import { BaseSchemaChangeListener } from "../schema-change/base.schema-change.listener.js";
import type { MySQLAdapter } from "./mySql.adapter.js";

export class MySQLSchemaChangeListener extends BaseSchemaChangeListener {
  private adapter: MySQLAdapter;
  private intervalMs: number;
  private timer: NodeJS.Timeout | undefined;
  private lastFingerprint: string = "";

  constructor(
    adapter: MySQLAdapter,
    onChange: () => Promise<void>,
    intervalMs = 30000,
  ) {
    super(onChange);
    this.adapter = adapter;
    this.intervalMs = intervalMs;
  }

  async start(): Promise<void> {
    await this.check();
    this.timer = setInterval(() => this.check(), this.intervalMs);
  }

  async stop(): Promise<void> {
    this.clearReconnect();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async check(): Promise<void> {
    try {
      const fingerprint = await this.computeFingerprint();
      if (this.lastFingerprint && this.lastFingerprint !== fingerprint) {
        await this.handleChange();
      }
      this.lastFingerprint = fingerprint;
    } catch (err) {
      console.error("MySQL schema poll failed:", err);
    }
  }

  private async computeFingerprint(): Promise<string> {
    await this.adapter.query(`SET SESSION group_concat_max_len = 1000000`);

    const dbName = this.adapter.getDatabaseName();

    const [columnHash] = await this.adapter.query<{ hash: string }>(
      `
      SELECT MD5(GROUP_CONCAT(
        CONCAT(table_name, '.', column_name, ':', data_type, ':', is_nullable)
        ORDER BY table_name, column_name
        SEPARATOR '|'
      )) as hash
      FROM information_schema.columns
      WHERE table_schema = ?
      `,
      [dbName],
    );

    const [indexHash] = await this.adapter.query<{ hash: string }>(
      `
      SELECT MD5(GROUP_CONCAT(
        CONCAT(table_name, '.', index_name, ':', column_name, ':', non_unique)
        ORDER BY table_name, index_name, seq_in_index
        SEPARATOR '|'
      )) as hash
      FROM information_schema.statistics
      WHERE table_schema = ?
      `,
      [dbName],
    );

    const [tableHash] = await this.adapter.query<{ hash: string }>(
      `
      SELECT MD5(GROUP_CONCAT(
        CONCAT(table_name, ':', engine, ':', table_rows)
        ORDER BY table_name
        SEPARATOR '|'
      )) as hash
      FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'
      `,
      [dbName],
    );

    const [fkHash] = await this.adapter.query<{ hash: string }>(
      `
      SELECT MD5(GROUP_CONCAT(
        CONCAT(table_name, '.', constraint_name, '->', referenced_table_name)
        ORDER BY table_name, constraint_name
        SEPARATOR '|'
      )) as hash
      FROM information_schema.key_column_usage
      WHERE table_schema = ? AND referenced_table_name IS NOT NULL
      `,
      [dbName],
    );

    const combined = `${columnHash?.hash ?? ""}:${indexHash?.hash ?? ""}:${tableHash?.hash ?? ""}:${fkHash?.hash ?? ""}`;

    return createHash("md5").update(combined).digest("hex");
  }
}
