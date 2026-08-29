import { ExecutorFactory } from "./executor.factory.js";
import { PostgresExecutor } from "./postgres.executor.js";

import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import { Pool as PgPool } from "pg";
import type { Pool as MySQLPool } from "mysql2/promise";
import { MySQLExecutor } from "./mySql.executor.js";

export function registerDialects(
  factory: ExecutorFactory,
  dbAdapter: ISqlDatabaseAdapter,
): void {
  const dialect = dbAdapter.getDialect();

  if (dialect === "postgresql") {
    factory.registerDialect("postgresql", () => {
      return new PostgresExecutor(dbAdapter.getPool() as unknown as PgPool);
    });
  } else if (dialect === "mysql") {
    factory.registerDialect("mysql", () => {
      return new MySQLExecutor(dbAdapter.getPool() as unknown as MySQLPool);
    });
  }
}
