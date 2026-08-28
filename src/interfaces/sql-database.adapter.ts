import type { QueryResultRow } from "pg";
import type { SqlDialect } from "../modules/schema/schema.types.js";

export interface ISqlDatabaseAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getDatabaseName(): string;
  getDialect(): SqlDialect; // ← NEW
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<T[]>;
}
