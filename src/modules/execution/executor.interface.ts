export interface ExecutionResult {
  columns: string[];
  rows: unknown[];
  rowCount: number;
  executionTimeMs: number;
}

export interface IQueryExecutor {
  execute(sql: string, options?: ExecuteOptions): Promise<ExecutionResult>;
}

export interface ExecuteOptions {
  maxRows?: number;
  timeoutMs?: number;
  readOnly?: boolean;
}
