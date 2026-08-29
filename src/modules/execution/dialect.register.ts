import { ExecutorFactory } from "./executor.factory.js";
import { PostgresExecutor } from "./postgres.executor.js";
import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import { Pool } from "pg";

export function registerDialects(
  factory: ExecutorFactory,
  dbAdapter: ISqlDatabaseAdapter,
): void {
  const dialect = dbAdapter.getDialect();

  if (dialect === "postgresql") {
    factory.registerDialect("postgresql", () => {
      return new PostgresExecutor(dbAdapter.getPool() as unknown as Pool);
    });
  }
  // else if (dialect === "mysql") { ... }
}
