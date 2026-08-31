import type { PoolClient } from "pg";
import { BaseSchemaChangeListener } from "../schema-change/base.schema-change.listener.js";
import type { PostgreSQLAdapter } from "./postgres.adapter.js";

export class PostgresSchemaChangeListener extends BaseSchemaChangeListener {
  private client: PoolClient | undefined;
  private adapter: PostgreSQLAdapter;

  constructor(adapter: PostgreSQLAdapter, onChange: () => Promise<void>) {
    super(onChange);
    this.adapter = adapter;
  }

  async start(): Promise<void> {
    const pool = this.adapter.getPool() as import("pg").Pool;
    this.client = await pool.connect();

    await this.client.query("LISTEN schema_changes");

    this.client.on("notification", (msg) => {
      console.log("Schema change detected:", msg.payload);
      this.handleChange(msg.payload);
    });

    this.client.on("error", (err) => {
      console.error("PG listener error:", err);
      this.scheduleReconnect(() => this.start());
    });

    this.client.on("end", () => {
      console.warn("PG listener disconnected");
      this.scheduleReconnect(() => this.start());
    });
  }

  async stop(): Promise<void> {
    this.clearReconnect();
    if (this.client) {
      this.client.release();
      this.client = undefined;
    }
  }
}
