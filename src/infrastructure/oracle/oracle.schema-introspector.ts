import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import type { ISchemaIntrospector } from "../../modules/schema/schema.intropector.js";
import type {
  DatabaseSchema,
  ForeignKeyDefinition,
  IndexDefinition,
  SchemaDefinition,
  TableDefinition,
} from "../../modules/schema/schema.types.js";
import { env } from "../../config/env.js";

interface OracleTableRow {
  [key: string]: unknown;
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
}

interface OracleColumnRow {
  [key: string]: unknown;
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  DATA_TYPE: string;
  NULLABLE: string;
  DATA_DEFAULT: string | null;
}

interface OraclePKRow {
  [key: string]: unknown;
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  POSITION: number;
}

interface OracleFKRow {
  [key: string]: unknown;
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  REFERENCED_TABLE_SCHEMA: string;
  REFERENCED_TABLE_NAME: string;
  REFERENCED_COLUMN_NAME: string;
  POSITION: number;
}

interface OracleIndexRow {
  [key: string]: unknown;
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  INDEX_NAME: string;
  COLUMN_NAME: string;
  UNIQUENESS: string;
  COLUMN_POSITION: number;
}

export class OracleSchemaIntrospector implements ISchemaIntrospector {
  constructor(private readonly database: ISqlDatabaseAdapter) {}

  private getTargetSchema(): string {
    return env.DB_USER.toUpperCase();
  }

  async getSchema(): Promise<DatabaseSchema> {
    const [tables, columns, primaryKeys, foreignKeys, indexes] =
      await Promise.all([
        this.getTables(),
        this.getColumns(),
        this.getPrimaryKeys(),
        this.getForeignKeys(),
        this.getIndexes(),
      ]);

    return {
      databaseName: this.database.getDatabaseName(),
      dialect: this.database.getDialect(),
      schemas: this.buildSchemas(
        tables,
        columns,
        primaryKeys,
        foreignKeys,
        indexes,
      ),
    };
  }

  private async getTables(): Promise<OracleTableRow[]> {
    const schema = this.getTargetSchema();
    return this.database.query<OracleTableRow>(
      `
      SELECT 
        OWNER as TABLE_SCHEMA,
        TABLE_NAME
      FROM ALL_TABLES
      WHERE OWNER = :owner
      ORDER BY TABLE_NAME
      `,
      [schema],
    );
  }

  private async getColumns(): Promise<OracleColumnRow[]> {
    const schema = this.getTargetSchema();
    return this.database.query<OracleColumnRow>(
      `
      SELECT 
        OWNER as TABLE_SCHEMA,
        TABLE_NAME,
        COLUMN_NAME,
        DATA_TYPE,
        NULLABLE,
        DATA_DEFAULT
      FROM ALL_TAB_COLUMNS
      WHERE OWNER = :owner
      ORDER BY TABLE_NAME, COLUMN_ID
      `,
      [schema],
    );
  }

  private async getPrimaryKeys(): Promise<OraclePKRow[]> {
    const schema = this.getTargetSchema();
    return this.database.query<OraclePKRow>(
      `
      SELECT 
        acc.OWNER as TABLE_SCHEMA,
        acc.TABLE_NAME,
        acc.COLUMN_NAME,
        acc.POSITION
      FROM ALL_CONSTRAINTS ac
      JOIN ALL_CONS_COLUMNS acc
        ON ac.OWNER = acc.OWNER
        AND ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME
      WHERE ac.OWNER = :owner
        AND ac.CONSTRAINT_TYPE = 'P'
      ORDER BY acc.TABLE_NAME, acc.POSITION
      `,
      [schema],
    );
  }

  private async getForeignKeys(): Promise<OracleFKRow[]> {
    const schema = this.getTargetSchema();
    return this.database.query<OracleFKRow>(
      `
      SELECT 
        acc.OWNER as TABLE_SCHEMA,
        acc.TABLE_NAME,
        acc.COLUMN_NAME,
        racc.OWNER as REFERENCED_TABLE_SCHEMA,
        racc.TABLE_NAME as REFERENCED_TABLE_NAME,
        racc.COLUMN_NAME as REFERENCED_COLUMN_NAME,
        acc.POSITION
      FROM ALL_CONSTRAINTS ac
      JOIN ALL_CONS_COLUMNS acc
        ON ac.OWNER = acc.OWNER
        AND ac.CONSTRAINT_NAME = acc.CONSTRAINT_NAME
      JOIN ALL_CONS_COLUMNS racc
        ON ac.R_OWNER = racc.OWNER
        AND ac.R_CONSTRAINT_NAME = racc.CONSTRAINT_NAME
        AND acc.POSITION = racc.POSITION
      WHERE ac.OWNER = :owner
        AND ac.CONSTRAINT_TYPE = 'R'
      ORDER BY acc.TABLE_NAME, acc.POSITION
      `,
      [schema],
    );
  }

  private async getIndexes(): Promise<OracleIndexRow[]> {
    const schema = this.getTargetSchema();
    return this.database.query<OracleIndexRow>(
      `
      SELECT 
        ai.TABLE_OWNER as TABLE_SCHEMA,
        ai.TABLE_NAME,
        ai.INDEX_NAME,
        aic.COLUMN_NAME,
        ai.UNIQUENESS,
        aic.COLUMN_POSITION
      FROM ALL_INDEXES ai
      JOIN ALL_IND_COLUMNS aic
        ON ai.OWNER = aic.INDEX_OWNER
        AND ai.INDEX_NAME = aic.INDEX_NAME
      WHERE ai.TABLE_OWNER = :owner
      ORDER BY ai.TABLE_NAME, ai.INDEX_NAME, aic.COLUMN_POSITION
      `,
      [schema],
    );
  }

  private buildSchemas(
    tableRows: OracleTableRow[],
    columnRows: OracleColumnRow[],
    primaryKeyRows: OraclePKRow[],
    foreignKeyRows: OracleFKRow[],
    indexRows: OracleIndexRow[],
  ): SchemaDefinition[] {
    const schemas = new Map<string, Map<string, TableDefinition>>();

    const getTable = (
      schemaName: string,
      tableName: string,
    ): TableDefinition | undefined => {
      return schemas.get(schemaName)?.get(tableName);
    };

    // 1. Build tables
    for (const row of tableRows) {
      const schemaName = String(row.TABLE_SCHEMA || "");
      const tableName = String(row.TABLE_NAME || "");

      if (!schemas.has(schemaName)) {
        schemas.set(schemaName, new Map());
      }

      schemas.get(schemaName)!.set(tableName, {
        name: tableName,
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
      });
    }

    // 2. Add columns
    for (const row of columnRows) {
      const table = getTable(String(row.TABLE_SCHEMA), String(row.TABLE_NAME));
      if (!table) continue;

      table.columns.push({
        name: String(row.COLUMN_NAME),
        dataType: String(row.DATA_TYPE),
        nullable: String(row.NULLABLE).toUpperCase() === "Y",
        defaultValue: row.DATA_DEFAULT != null ? String(row.DATA_DEFAULT).trim() : null,
      });
    }

    // 3. Primary keys
    for (const row of primaryKeyRows) {
      const table = getTable(String(row.TABLE_SCHEMA), String(row.TABLE_NAME));
      if (!table) continue;

      table.primaryKeys.push(String(row.COLUMN_NAME));
    }

    // 4. Foreign keys
    for (const row of foreignKeyRows) {
      const table = getTable(String(row.TABLE_SCHEMA), String(row.TABLE_NAME));
      if (!table) continue;

      table.foreignKeys.push({
        columnName: String(row.COLUMN_NAME),
        referencedSchema: String(row.REFERENCED_TABLE_SCHEMA),
        referencedTable: String(row.REFERENCED_TABLE_NAME),
        referencedColumn: String(row.REFERENCED_COLUMN_NAME),
      });
    }

    // 5. Indexes
    const indexMap = new Map<string, IndexDefinition>();
    for (const row of indexRows) {
      const schemaName = String(row.TABLE_SCHEMA);
      const tableName = String(row.TABLE_NAME);
      const indexName = String(row.INDEX_NAME);
      const key = `${schemaName}.${tableName}.${indexName}`;

      if (!indexMap.has(key)) {
        const table = getTable(schemaName, tableName);
        const isPrimary = table ? table.primaryKeys.includes(String(row.COLUMN_NAME)) : false;

        indexMap.set(key, {
          name: indexName,
          columns: [],
          unique: String(row.UNIQUENESS).toUpperCase() === "UNIQUE",
          primary: isPrimary,
        });
      }

      indexMap.get(key)!.columns.push(String(row.COLUMN_NAME));
    }

    for (const [key, indexDef] of indexMap) {
      const [schemaName, tableName] = key.split(".");
      if (schemaName && tableName) {
        const table = getTable(schemaName, tableName);
        if (table) {
          table.indexes.push(indexDef);
        }
      }
    }

    return Array.from(schemas.entries()).map(([name, tableMap]) => ({
      name,
      tables: Array.from(tableMap.values()),
    }));
  }
}
