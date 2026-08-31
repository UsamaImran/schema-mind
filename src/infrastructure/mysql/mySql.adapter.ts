import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { env } from "../../config/env.js";
import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import type { SqlDialect } from "../../modules/schema/schema.types.js";
import { MySQLSchemaChangeListener } from "./mysql.schema-change.listener.js";

export class MySQLAdapter implements ISqlDatabaseAdapter {
  private readonly pool: Pool;

  constructor() {
    this.pool = createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
  }

  async connect(): Promise<void> {
    const connection = await this.pool.getConnection();
    try {
      await connection.query("SELECT 1");
    } finally {
      connection.release();
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  getDatabaseName(): string {
    return env.DB_NAME;
  }

  getDialect(): SqlDialect {
    return "mysql";
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<T[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(text, values);
    return rows as T[];
  }

  getPool(): Pool {
    return this.pool;
  }

  createSchemaChangeListener(onChange: () => Promise<void>) {
    return new MySQLSchemaChangeListener(this, onChange);
  }
}
