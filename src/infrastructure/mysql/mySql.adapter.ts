import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { env } from "../../config/env.js";
import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import type { SqlDialect } from "../../modules/schema/schema.types.js";

export class MySQLAdapter implements ISqlDatabaseAdapter {
  private readonly pool: Pool;

  constructor() {
    // Zod schema in env.ts already validates these are defined when dialect=mysql
    this.pool = createPool({
      host: env.MYSQL_HOST!,
      port: env.MYSQL_PORT!,
      database: env.MYSQL_DATABASE!,
      user: env.MYSQL_USER!,
      password: env.MYSQL_PASSWORD,
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
    return env.MYSQL_DATABASE!;
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
}
