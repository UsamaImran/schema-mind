import type { QueryResultRow } from "pg";

export interface ISqlDatabaseAdapter {
  connect(): Promise<void>;

  disconnect(): Promise<void>;

  getDatabaseName(): string;

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<T[]>;
}
