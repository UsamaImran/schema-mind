import { ExecutorFactory } from "./executor.factory.js";
import { PostgresExecutor } from "./postgres.executor.js";
import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";

import { MySQLExecutor } from "./mySqlexecutor.js";

export function registerDialects(
  factory: ExecutorFactory,
  dbAdapter: ISqlDatabaseAdapter,
): void {
  const dialect = dbAdapter.getDialect();

  if (dialect === "postgresql") {
    factory.registerDialect("postgresql", () => {
      return new PostgresExecutor(dbAdapter.getPool() as any);
    });
  } else if (dialect === "mysql") {
    factory.registerDialect("mysql", () => {
      return new MySQLExecutor(dbAdapter.getPool() as any);
    });
  }
}
