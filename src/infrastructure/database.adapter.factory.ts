import { PostgreSQLAdapter } from "./postgres/postgres.adapter.js";
import type { ISqlDatabaseAdapter } from "../interfaces/sql-database.adapter.js";
import { env } from "../config/env.js";

export function createDatabaseAdapter(): ISqlDatabaseAdapter {
  const dialect = env.DATABASE_DIALECT ?? "postgresql";
  switch (dialect) {
    case "postgresql":
      return new PostgreSQLAdapter();
    // case "mysql": return new MySQLAdapter();
    default:
      throw new Error(`Unsupported dialect: ${dialect}`);
  }
}
