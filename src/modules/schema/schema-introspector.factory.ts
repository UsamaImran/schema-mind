import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import { PostgreSQLSchemaIntrospector } from "../../infrastructure/postgres/postgres.schema-introspector.js";
import type { ISchemaIntrospector } from "./schema.intropector.js";
import { MySQLSchemaIntrospector } from "../../infrastructure/mysql/mySql.schema-introspector.js";

export function createSchemaIntrospector(
  adapter: ISqlDatabaseAdapter,
): ISchemaIntrospector {
  switch (adapter.getDialect()) {
    case "postgresql":
      return new PostgreSQLSchemaIntrospector(adapter);
    case "mysql":
      return new MySQLSchemaIntrospector(adapter);
    default:
      throw new Error(`No introspector for dialect: ${adapter.getDialect()}`);
  }
}
