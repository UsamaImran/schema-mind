import type { Pool } from "mysql2/promise";
import type { QueryOptions } from "mysql2";
import type {
  IQueryExecutor,
  ExecutionResult,
  ExecuteOptions,
} from "./executor.interface.js";

export class MySQLExecutor implements IQueryExecutor {
  constructor(private pool: Pool) {}

  async execute(
    sql: string,
    options: ExecuteOptions = {},
  ): Promise<ExecutionResult> {
    const connection = await this.pool.getConnection();
    const start = Date.now();
    let inTransaction = false;
    let connectionDead = false;

    try {
      if (options.readOnly) {
        await connection.query("SET TRANSACTION READ ONLY");
        await connection.beginTransaction();
        inTransaction = true;
      }

      const cleanSql = sql.trim().replace(/;\s*$/, "");
      const maxRows = options.maxRows ?? 100;
      const executableSql = /\blimit\s+\d+/i.test(cleanSql)
        ? cleanSql
        : `${cleanSql} LIMIT ${maxRows}`;

      const queryOptions: QueryOptions = {
        sql: executableSql,
        ...(options.timeoutMs !== undefined && options.timeoutMs > 0
          ? { timeout: Math.max(0, Math.floor(options.timeoutMs)) }
          : {}),
      };

      const [rows, fields] = await connection.query(queryOptions);
      const rowArray = Array.isArray(rows) ? rows : [];
      const slicedRows = rowArray.slice(0, maxRows);

      const columns = Array.isArray(fields)
        ? fields.map((f: { name: string }) => f.name)
        : Object.keys(rowArray[0] ?? {});

      return {
        columns,
        rows: slicedRows,
        rowCount: slicedRows.length,
        executionTimeMs: Date.now() - start,
      };
    } finally {
      if (inTransaction) {
        try {
          await connection.rollback();
        } catch {
          connectionDead = true;
        }
      }

      if (connectionDead) {
        try {
          connection.destroy();
        } catch {
          // Ignore error during destroy of already dead connection
        }
      } else {
        connection.release();
      }
    }
  }
}
