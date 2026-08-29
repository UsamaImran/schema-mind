import type { Pool } from "mysql2/promise";
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

    try {
      if (options.readOnly) {
        await connection.query("SET SESSION TRANSACTION READ ONLY");
        await connection.beginTransaction();
      }

      const [rows, fields] = await connection.query(sql);
      const rowArray = Array.isArray(rows) ? rows : [];
      const slicedRows = rowArray.slice(0, options.maxRows ?? 100);

      const columns = Array.isArray(fields)
        ? fields.map((f: { name: string }) => f.name)
        : Object.keys(rowArray[0] ?? {});

      if (options.readOnly) {
        await connection.rollback();
        await connection.query("SET SESSION TRANSACTION READ WRITE");
      }

      return {
        columns,
        rows: slicedRows,
        rowCount: slicedRows.length,
        executionTimeMs: Date.now() - start,
      };
    } catch (error) {
      if (options.readOnly) {
        await connection.rollback();
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
