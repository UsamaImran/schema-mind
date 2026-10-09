import oracledb, { type Pool } from "oracledb";
import type {
  IQueryExecutor,
  ExecutionResult,
  ExecuteOptions,
} from "./executor.interface.js";

export class OracleExecutor implements IQueryExecutor {
  constructor(private pool: Pool) {}

  async execute(
    sql: string,
    options: ExecuteOptions = {},
  ): Promise<ExecutionResult> {
    const connection = await this.pool.getConnection();
    const start = Date.now();
    let inTransaction = false;

    try {
      if (options.readOnly) {
        // Enforce transaction-scoped read-only isolation in Oracle
        await connection.execute("SET TRANSACTION READ ONLY");
        inTransaction = true;
      }

      const cleanSql = sql.trim().replace(/;\s*$/, "");
      const maxRows = options.maxRows ?? 100;

      // Oracle 12c+ standard ANSI row limiting: FETCH FIRST n ROWS ONLY
      const hasFetchFirst = /\bfetch\s+(first|next)\s+\d+\s+rows\s+only\b/i.test(cleanSql);
      const executableSql = hasFetchFirst
        ? cleanSql
        : `${cleanSql} FETCH FIRST ${maxRows} ROWS ONLY`;

      // Timeout execution using Promise.race and connection.break()
      let executePromise = connection.execute<Record<string, unknown>>(
        executableSql,
        [],
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: maxRows,
          autoCommit: false,
        },
      );

      let timer: NodeJS.Timeout | undefined;
      if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
        const timeoutMs = Math.max(0, Math.floor(options.timeoutMs));
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(async () => {
            try {
              await connection.break();
            } catch {
              // Ignore failure to break
            }
            reject(new Error(`Query execution timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        });

        executePromise = Promise.race([executePromise, timeoutPromise]);
      }

      let result;
      try {
        result = await executePromise;
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }

      const rows = (result.rows || []).slice(0, maxRows);
      const columns = (result.metaData || []).map(
        (m: oracledb.Metadata<Record<string, unknown>>) => m.name,
      );

      return {
        columns,
        rows,
        rowCount: rows.length,
        executionTimeMs: Date.now() - start,
      };
    } finally {
      if (inTransaction) {
        try {
          await connection.rollback();
        } catch {
          // Ignore rollback failure during connection cleanup
        }
      }
      try {
        await connection.close();
      } catch {
        // Ignore close failure
      }
    }
  }
}
