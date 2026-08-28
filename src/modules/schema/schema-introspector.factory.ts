import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import { PostgreSQLSchemaIntrospector } from "../../infrastructure/postgres/postgres.schema-introspector.js";
import type { ISchemaIntrospector } from "./schema.intropector.js";

export function createSchemaIntrospector(
  adapter: ISqlDatabaseAdapter,
): ISchemaIntrospector {
  switch (adapter.getDialect()) {
    case "postgresql":
      return new PostgreSQLSchemaIntrospector(adapter);
    default:
      throw new Error(`No introspector for dialect: ${adapter.getDialect()}`);
  }
}
