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
    await this.check(); // initial check
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
    const rows = await this.adapter.query<{
      hash: string;
    }>(`
      SELECT MD5(GROUP_CONCAT(
        CONCAT(table_schema, '.', table_name, '.', column_name, ':', data_type)
        ORDER BY table_schema, table_name, column_name
        SEPARATOR ','
      )) as hash
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
    `);
    return rows[0]?.hash ?? "";
  }
}
