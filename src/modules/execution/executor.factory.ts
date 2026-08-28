import type { SqlDialect } from "../../modules/schema/schema.types.js";
import type { IQueryExecutor } from "../../modules/execution/executor.interface.js";

export class ExecutorFactory {
  private executors = new Map<string, IQueryExecutor>();

  register(
    databaseName: string,
    dialect: SqlDialect,
    executor: IQueryExecutor,
  ): void {
    this.executors.set(`${dialect}:${databaseName}`, executor);
  }

  getExecutor(databaseName: string, dialect: SqlDialect): IQueryExecutor {
    const key = `${dialect}:${databaseName}`;
    const executor = this.executors.get(key);
    if (!executor) {
      throw new Error(`No executor registered for ${key}`);
    }
    return executor;
  }
}
