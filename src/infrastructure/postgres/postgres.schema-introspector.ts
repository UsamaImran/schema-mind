import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import { ISchemaIntrospector } from "../../modules/schema/schema.intropector.js";
import type {
  DatabaseSchema,
  ForeignKeyDefinition,
  IndexDefinition,
  SchemaDefinition,
  TableDefinition,
} from "../../modules/schema/schema.types.js";

export class PostgreSQLSchemaIntrospector implements ISchemaIntrospector {
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
          'pg_catalog',
          'information_schema'
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
        column_default
      FROM information_schema.columns
      WHERE table_schema NOT IN (
        'pg_catalog',
        'information_schema'
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
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN (
          'pg_catalog',
          'information_schema'
        )
      ORDER BY
        tc.table_schema,
        tc.table_name,
        kcu.ordinal_position;
    `);
  }

  private async getForeignKeys(): Promise<Record<string, unknown>[]> {
    return this.database.query(`
      SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_schema AS referenced_schema,
        ccu.table_name AS referenced_table,
        ccu.column_name AS referenced_column,
        kcu.ordinal_position
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
        AND tc.table_name = kcu.table_name
      JOIN information_schema.constraint_column_usage ccu
        ON tc.constraint_name = ccu.constraint_name
        AND tc.table_schema = ccu.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN (
          'pg_catalog',
          'information_schema'
        )
      ORDER BY
        tc.table_schema,
        tc.table_name,
        kcu.ordinal_position;
    `);
  }

  private async getIndexes(): Promise<Record<string, unknown>[]> {
    return this.database.query(`
      SELECT
        schemaname AS table_schema,
        tablename AS table_name,
        indexname AS index_name,
        indexdef AS index_definition
      FROM pg_indexes
      WHERE schemaname NOT IN (
        'pg_catalog',
        'information_schema'
      )
      ORDER BY
        schemaname,
        tablename,
        indexname;
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

      if (!table) {
        continue;
      }

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

      if (!table) {
        continue;
      }

      table.primaryKeys.push(String(row.column_name));
    }

    // Add foreign keys
    for (const row of foreignKeyRows) {
      const table = this.findTable(
        schemaMap,
        String(row.table_schema),
        String(row.table_name),
      );

      if (!table) {
        continue;
      }

      const foreignKey: ForeignKeyDefinition = {
        columnName: String(row.column_name),
        referencedSchema: String(row.referenced_schema),
        referencedTable: String(row.referenced_table),
        referencedColumn: String(row.referenced_column),
      };

      table.foreignKeys.push(foreignKey);
    }

    // Add indexes
    for (const row of indexRows) {
      const table = this.findTable(
        schemaMap,
        String(row.table_schema),
        String(row.table_name),
      );

      if (!table) {
        continue;
      }

      const indexDefinition = String(row.index_definition);

      const index: IndexDefinition = {
        name: String(row.index_name),
        columns: this.extractIndexColumns(indexDefinition),
        unique: indexDefinition.startsWith("CREATE UNIQUE INDEX"),
        primary: false,
      };

      table.indexes.push(index);
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

  private extractIndexColumns(indexDefinition: string): string[] {
    const match = indexDefinition.match(/\(([^)]+)\)/);
    const columns = match?.[1];

    if (!columns) {
      return [];
    }

    return columns
      .split(",")
      .map((column) => column.trim())
      .map((column) => column.replace(/^"/, "").replace(/"$/, ""));
  }

  private findTable(
    schemaMap: Map<string, TableDefinition[]>,
    schemaName: string,
    tableName: string,
  ): TableDefinition | undefined {
    const tables = schemaMap.get(schemaName);

    if (!tables) {
      return undefined;
    }

    return tables.find((table) => table.name === tableName);
  }
}
