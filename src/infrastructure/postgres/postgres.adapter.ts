import { Pool, type QueryResultRow } from "pg";
import { env } from "../../config/env.js";
import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import type { SqlDialect } from "../../modules/schema/schema.types.js";
import { PostgresSchemaChangeListener } from "./postgres.schema-change.listener.js";

export class PostgreSQLAdapter implements ISqlDatabaseAdapter {
  private readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
    });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }

  getDatabaseName(): string {
    return env.DB_NAME;
  }

  getDialect(): SqlDialect {
    return "postgresql";
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(text, values);
    return result.rows;
  }

  getPool(): Pool {
    return this.pool;
  }

  createSchemaChangeListener(onChange: () => Promise<void>) {
    return new PostgresSchemaChangeListener(this, onChange);
  }
}
