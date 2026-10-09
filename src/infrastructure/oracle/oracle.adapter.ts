import oracledb, { type Pool } from "oracledb";
import { env } from "../../config/env.js";
import type {
  ISqlDatabaseAdapter,
  ISchemaChangeListener,
  QueryResultRow,
} from "../../interfaces/sql-database.adapter.js";
import type { SqlDialect } from "../../modules/schema/schema.types.js";
import { OracleSchemaChangeListener } from "./oracle.schema-change.listener.js";

export class OracleAdapter implements ISqlDatabaseAdapter {
  private pool: Pool | undefined;

  private getConnectString(): string {
    if (env.ORACLE_SERVICE_NAME) {
      return `${env.DB_HOST}:${env.DB_PORT}/${env.ORACLE_SERVICE_NAME}`;
    }
    return `${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`;
  }

  async connect(): Promise<void> {
    if (this.pool) {
      return;
    }

    this.pool = await oracledb.createPool({
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      connectString: this.getConnectString(),
      poolMin: 2,
      poolMax: 10,
      poolIncrement: 1,
      poolTimeout: 60,
    });

    const connection = await this.pool.getConnection();
    try {
      await connection.execute("SELECT 1 FROM DUAL");
    } finally {
      await connection.close();
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.close(10);
      this.pool = undefined;
    }
  }

  getDatabaseName(): string {
    return env.ORACLE_SERVICE_NAME || env.DB_NAME;
  }

  getDialect(): SqlDialect {
    return "oracle";
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<T[]> {
    if (!this.pool) {
      throw new Error("Oracle pool is not initialized. Call connect() first.");
    }

    const connection = await this.pool.getConnection();
    try {
      const binds = (values as oracledb.BindParameters) || [];
      const result = await connection.execute(text, binds, {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        autoCommit: false,
      });

      return (result.rows || []) as T[];
    } finally {
      await connection.close();
    }
  }

  getPool(): Pool {
    if (!this.pool) {
      throw new Error("Oracle pool is not initialized. Call connect() first.");
    }
    return this.pool;
  }

  createSchemaChangeListener(
    onChange: () => Promise<void>,
  ): ISchemaChangeListener {
    return new OracleSchemaChangeListener(
      this,
      onChange,
      env.SCHEMA_POLL_INTERVAL_MS,
    );
  }
}

