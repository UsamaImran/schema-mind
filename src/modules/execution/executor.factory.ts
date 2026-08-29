import type { SqlDialect } from "../../modules/schema/schema.types.js";
import type { IQueryExecutor } from "./executor.interface.js";

export class ExecutorFactory {
  private executors = new Map<string, IQueryExecutor>();
  private factories = new Map<string, (dbName: string) => IQueryExecutor>();

  registerDialect(
    dialect: SqlDialect,
    factory: (dbName: string) => IQueryExecutor,
  ): void {
    this.factories.set(dialect, factory);
  }

  getExecutor(databaseName: string, dialect: SqlDialect): IQueryExecutor {
    const key = `${dialect}:${databaseName}`;
    let executor = this.executors.get(key);

    if (!executor) {
      const factory = this.factories.get(dialect);
      if (!factory) {
        throw new Error(
          `No executor factory registered for dialect: ${dialect}`,
        );
      }
      executor = factory(databaseName);
      this.executors.set(key, executor);
    }

    return executor;
  }
}
