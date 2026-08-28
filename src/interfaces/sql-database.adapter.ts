import type { SqlDialect } from "../modules/schema/schema.types.js";
export type QueryResultRow = Record<string, unknown>;

export interface ISqlDatabaseAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getDatabaseName(): string;
  getDialect(): SqlDialect;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<T[]>;
}
