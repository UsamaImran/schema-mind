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
    let inTransaction = false;
    let discardClient = false;

    try {
      if (options.readOnly) {
        await client.query("BEGIN TRANSACTION READ ONLY");
        inTransaction = true;
      }

      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        const timeout = Math.max(0, Math.floor(options.timeoutMs));
        const timeoutSql = inTransaction
          ? `SET LOCAL statement_timeout = ${timeout}`
          : `SET statement_timeout = ${timeout}`;
        await client.query(timeoutSql);
      }

      const result = await client.query(sql);
      const maxRows = options.maxRows ?? 100;
      const rows = result.rows.slice(0, maxRows);

      return {
        columns: (result.fields ?? []).map((f) => f.name),
        rows,
        rowCount: rows.length,
        executionTimeMs: Date.now() - start,
      };
    } finally {
      if (inTransaction) {
        try {
          await client.query("ROLLBACK");
        } catch {
          discardClient = true;
        }
      } else if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        try {
          await client.query("RESET statement_timeout");
        } catch {
          discardClient = true;
        }
      }

      client.release(discardClient);
    }
  }
}
