import { Pool } from "pg";
import { env } from "../../config/env.js";
import type { SqlDialect } from "../../modules/schema/schema.types.js";
import type { IQueryExecutor } from "./executor.interface.js";
import { PostgresExecutor } from "./postgres.executor.js";

export class ExecutorFactory {
  private executors = new Map<string, IQueryExecutor>();

  getExecutor(databaseName: string, dialect: SqlDialect): IQueryExecutor {
    const key = `${dialect}:${databaseName}`;

    if (!this.executors.has(key)) {
      const executor = this.createExecutor(dialect);
      this.executors.set(key, executor);
    }

    return this.executors.get(key)!;
  }

  private createExecutor(dialect: SqlDialect): IQueryExecutor {
    switch (dialect) {
      case "postgresql":
        return new PostgresExecutor(
          new Pool({
            host: env.POSTGRES_HOST,
            port: env.POSTGRES_PORT,
            database: env.POSTGRES_DATABASE,
            user: env.POSTGRES_USER,
            password: env.POSTGRES_PASSWORD,
          }),
        );
      default:
        throw new Error(`Unsupported dialect: ${dialect}`);
    }
  }
}
