import { env } from "../config/env.js";
import type { ISqlDatabaseAdapter } from "../interfaces/sql-database.adapter.js";
import { MySQLAdapter } from "./mysql/mySql.adapter.js";
import { PostgreSQLAdapter } from "./postgres/postgres.adapter.js";

export function createDatabaseAdapter(): ISqlDatabaseAdapter {
  switch (env.DATABASE_DIALECT) {
    case "postgresql":
      return new PostgreSQLAdapter();
    case "mysql":
      return new MySQLAdapter();
    // case "sqlite": return new SQLiteAdapter();
    // case "mssql": return new SQLServerAdapter();
    default:
      throw new Error(`Unsupported dialect: ${env.DATABASE_DIALECT}`);
  }
}
