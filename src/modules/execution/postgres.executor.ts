import type { Pool } from "pg";
import type {
  IQueryExecutor,
  ExecutionResult,
  ExecuteOptions,
} from "./executor.interface.js";

export class PostgresExecutor implements IQueryExecutor {
  constructor(private pool: Pool) {}

  async execute(
    sql: string,
    options: ExecuteOptions = {},
  ): Promise<ExecutionResult> {
    const client = await this.pool.connect();
    const start = Date.now();

    try {
      if (options.readOnly) {
        await client.query("BEGIN TRANSACTION READ ONLY");
      }

      const result = await client.query(sql);
      const rows = result.rows.slice(0, options.maxRows ?? 100);

      return {
        columns: result.fields.map((f) => f.name),
        rows,
        rowCount: rows.length,
        executionTimeMs: Date.now() - start,
      };
    } finally {
      client.release();
    }
  }
}
