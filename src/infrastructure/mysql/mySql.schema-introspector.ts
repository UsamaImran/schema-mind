import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import { ISchemaIntrospector } from "../../modules/schema/schema.intropector.js";
import type {
  DatabaseSchema,
  ForeignKeyDefinition,
  IndexDefinition,
  SchemaDefinition,
  TableDefinition,
} from "../../modules/schema/schema.types.js";

/**
 * MySQL Schema Introspector
 *
 * Introspects a live MySQL database using information_schema.
 * MySQL uses a single-database-per-connection model, so we treat
 * the current database as the single schema (similar to Postgres public schema).
 */
export class MySQLSchemaIntrospector implements ISchemaIntrospector {
  constructor(private readonly database: ISqlDatabaseAdapter) {}

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

  private async getTables(): Promise<Record<string, unknown>[]> {
    return this.database.query(`
      SELECT
        table_schema,
        table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN (
          'mysql',
          'information_schema',
          'performance_schema',
          'sys'
        )
      ORDER BY
        table_schema,
        table_name;
    `);
  }

  private async getColumns(): Promise<Record<string, unknown>[]> {
    return this.database.query(`
      SELECT
        table_schema,
        table_name,
        column_name,
        data_type,
        is_nullable,
        column_default,
        extra,
        column_comment
      FROM information_schema.columns
      WHERE table_schema NOT IN (
        'mysql',
        'information_schema',
        'performance_schema',
        'sys'
      )
      ORDER BY
        table_schema,
        table_name,
        ordinal_position;
    `);
  }

  private async getPrimaryKeys(): Promise<Record<string, unknown>[]> {
    return this.database.query(`
      SELECT
        kcu.table_schema,
        kcu.table_name,
        kcu.column_name,
        kcu.ordinal_position
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.table_constraints tc
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND kcu.table_schema NOT IN (
          'mysql',
          'information_schema',
          'performance_schema',
          'sys'
        )
      ORDER BY
        kcu.table_schema,
        kcu.table_name,
        kcu.ordinal_position;
    `);
  }

  private async getForeignKeys(): Promise<Record<string, unknown>[]> {
    return this.database.query(`
      SELECT
        kcu.table_schema,
        kcu.table_name,
        kcu.column_name,
        kcu.referenced_table_schema,
        kcu.referenced_table_name,
        kcu.referenced_column_name
      FROM information_schema.key_column_usage kcu
      JOIN information_schema.table_constraints tc
        ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND kcu.table_schema NOT IN (
          'mysql',
          'information_schema',
          'performance_schema',
          'sys'
        )
      ORDER BY
        kcu.table_schema,
        kcu.table_name,
        kcu.ordinal_position;
    `);
  }

  private async getIndexes(): Promise<Record<string, unknown>[]> {
    return this.database.query(`
      SELECT
        table_schema,
        table_name,
        index_name,
        column_name,
        non_unique,
        seq_in_index
      FROM information_schema.statistics
      WHERE table_schema NOT IN (
        'mysql',
        'information_schema',
        'performance_schema',
        'sys'
      )
        AND index_name != 'PRIMARY'
      ORDER BY
        table_schema,
        table_name,
        index_name,
        seq_in_index;
    `);
  }

  private buildSchemas(
    tableRows: Record<string, unknown>[],
    columnRows: Record<string, unknown>[],
    primaryKeyRows: Record<string, unknown>[],
    foreignKeyRows: Record<string, unknown>[],
    indexRows: Record<string, unknown>[],
  ): SchemaDefinition[] {
    const schemaMap = new Map<string, TableDefinition[]>();

    // Build schemas and tables
    for (const row of tableRows) {
      const schemaName = String(row.table_schema);
      const tableName = String(row.table_name);

      if (!schemaMap.has(schemaName)) {
        schemaMap.set(schemaName, []);
      }

      schemaMap.get(schemaName)!.push({
        name: tableName,
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
      });
    }

    // Add columns
    for (const row of columnRows) {
      const table = this.findTable(
        schemaMap,
        String(row.table_schema),
        String(row.table_name),
      );

      if (!table) continue;

      const extra = String(row.extra ?? "");
      const isAutoIncrement = extra.includes("auto_increment");

      table.columns.push({
        name: String(row.column_name),
        dataType: String(row.data_type),
        nullable: row.is_nullable === "YES",
        defaultValue:
          row.column_default === null ? null : String(row.column_default),
      });
    }

    // Add primary keys
    for (const row of primaryKeyRows) {
      const table = this.findTable(
        schemaMap,
        String(row.table_schema),
        String(row.table_name),
      );

      if (!table) continue;

      table.primaryKeys.push(String(row.column_name));
    }

    // Add foreign keys
    for (const row of foreignKeyRows) {
      const table = this.findTable(
        schemaMap,
        String(row.table_schema),
        String(row.table_name),
      );

      if (!table) continue;

      const foreignKey: ForeignKeyDefinition = {
        columnName: String(row.column_name),
        referencedSchema: String(
          row.referenced_table_schema ?? row.table_schema,
        ),
        referencedTable: String(row.referenced_table_name),
        referencedColumn: String(row.referenced_column_name),
      };

      table.foreignKeys.push(foreignKey);
    }

    // Aggregate indexes (MySQL returns one row per index column)
    const indexMap = new Map<
      string,
      Map<string, { columns: string[]; nonUnique: number }>
    >();

    for (const row of indexRows) {
      const schemaName = String(row.table_schema);
      const tableName = String(row.table_name);
      const indexName = String(row.index_name);
      const columnName = String(row.column_name);
      const nonUnique = Number(row.non_unique);

      const schemaKey = `${schemaName}.${tableName}`;
      if (!indexMap.has(schemaKey)) {
        indexMap.set(schemaKey, new Map());
      }

      const tableIndexes = indexMap.get(schemaKey)!;
      if (!tableIndexes.has(indexName)) {
        tableIndexes.set(indexName, { columns: [], nonUnique });
      }

      tableIndexes.get(indexName)!.columns.push(columnName);
    }

    // Attach aggregated indexes to tables
    for (const [schemaTableKey, tableIndexes] of indexMap.entries()) {
      const [schemaName, tableName] = schemaTableKey.split(".");
      const table = this.findTable(schemaMap, schemaName, tableName);

      if (!table) continue;

      for (const [indexName, indexData] of tableIndexes.entries()) {
        const index: IndexDefinition = {
          name: indexName,
          columns: indexData.columns,
          unique: indexData.nonUnique === 0,
          primary: false,
        };

        table.indexes.push(index);
      }
    }

    // Mark primary-key indexes
    for (const schema of schemaMap.values()) {
      for (const table of schema) {
        const primaryKeyColumns = new Set(table.primaryKeys);

        for (const index of table.indexes) {
          const indexColumns = new Set(index.columns);

          if (
            indexColumns.size === primaryKeyColumns.size &&
            [...primaryKeyColumns].every((column) => indexColumns.has(column))
          ) {
            index.primary = true;
          }
        }
      }
    }

    return Array.from(schemaMap.entries()).map(([name, tables]) => ({
      name,
      tables,
    }));
  }

  private findTable(
    schemaMap: Map<string, TableDefinition[]>,
    schemaName: string,
    tableName: string,
  ): TableDefinition | undefined {
    const tables = schemaMap.get(schemaName);
    if (!tables) return undefined;
    return tables.find((table) => table.name === tableName);
  }
}
