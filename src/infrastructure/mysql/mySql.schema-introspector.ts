import type { ISqlDatabaseAdapter } from "../../interfaces/sql-database.adapter.js";
import { ISchemaIntrospector } from "../../modules/schema/schema.intropector.js";
import type {
  DatabaseSchema,
  ForeignKeyDefinition,
  IndexDefinition,
  SchemaDefinition,
  TableDefinition,
} from "../../modules/schema/schema.types.js";

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

  /**
   * MySQL treats the selected database as the schema namespace.
   *
   * DATABASE() returns the database currently selected by the connection.
   */
  private async getTables(): Promise<Record<string, unknown>[]> {
    return this.database.query(`
      SELECT
        table_schema,
        table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema = DATABASE()
      ORDER BY
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
      WHERE table_schema = DATABASE()
      ORDER BY
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
        AND kcu.table_schema = DATABASE()
      ORDER BY
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
        AND kcu.table_schema = DATABASE()
      ORDER BY
        kcu.table_name,
        kcu.ordinal_position;
    `);
  }

  /**
   * MySQL information_schema.statistics returns one row per
   * index column, so composite indexes need to be aggregated.
   *
   * PRIMARY is intentionally included here. MySQL exposes the
   * primary-key index as index_name = 'PRIMARY'.
   */
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
      WHERE table_schema = DATABASE()
      ORDER BY
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
    const tables = new Map<string, TableDefinition>();

    /*
     * ---------------------------------------------------------
     * Build tables
     * ---------------------------------------------------------
     *
     * For MySQL, the currently selected database is our single
     * schema namespace.
     */
    for (const row of tableRows) {
      const tableName = String(row.table_name);

      tables.set(tableName, {
        name: tableName,
        columns: [],
        primaryKeys: [],
        foreignKeys: [],
        indexes: [],
      });
    }

    /*
     * ---------------------------------------------------------
     * Add columns
     * ---------------------------------------------------------
     */
    for (const row of columnRows) {
      const tableName = String(row.table_name);
      const table = tables.get(tableName);

      if (!table) continue;

      table.columns.push({
        name: String(row.column_name),
        dataType: String(row.data_type),
        nullable: row.is_nullable === "YES",
        defaultValue:
          row.column_default === null ? null : String(row.column_default),
      });
    }

    /*
     * ---------------------------------------------------------
     * Add primary keys
     * ---------------------------------------------------------
     *
     * Keep the order returned by ordinal_position because
     * composite primary keys are order-sensitive.
     */
    for (const row of primaryKeyRows) {
      const tableName = String(row.table_name);
      const table = tables.get(tableName);

      if (!table) continue;

      table.primaryKeys.push(String(row.column_name));
    }

    /*
     * ---------------------------------------------------------
     * Add foreign keys
     * ---------------------------------------------------------
     */
    const databaseName = this.database.getDatabaseName();

    for (const row of foreignKeyRows) {
      const tableName = String(row.table_name);
      const table = tables.get(tableName);

      if (!table) continue;

      const foreignKey: ForeignKeyDefinition = {
        columnName: String(row.column_name),

        referencedSchema: String(row.referenced_table_schema ?? databaseName),

        referencedTable: String(row.referenced_table_name),

        referencedColumn: String(row.referenced_column_name),
      };

      table.foreignKeys.push(foreignKey);
    }

    /*
     * ---------------------------------------------------------
     * Aggregate indexes
     * ---------------------------------------------------------
     *
     * information_schema.statistics returns:
     *
     *   index_1 | column_a
     *   index_1 | column_b
     *   index_1 | column_c
     *
     * for a composite index.
     *
     * We therefore aggregate by:
     *
     *   table + index
     *
     * while preserving seq_in_index ordering.
     */
    const indexMap = new Map<
      string,
      Map<
        string,
        {
          columns: string[];
          nonUnique: number;
        }
      >
    >();

    for (const row of indexRows) {
      const tableName = String(row.table_name);
      const indexName = String(row.index_name);
      const columnName = String(row.column_name);
      const nonUnique = Number(row.non_unique);

      if (!indexMap.has(tableName)) {
        indexMap.set(tableName, new Map());
      }

      const tableIndexes = indexMap.get(tableName)!;

      if (!tableIndexes.has(indexName)) {
        tableIndexes.set(indexName, {
          columns: [],
          nonUnique,
        });
      }

      tableIndexes.get(indexName)!.columns.push(columnName);
    }

    /*
     * ---------------------------------------------------------
     * Attach indexes to tables
     * ---------------------------------------------------------
     *
     * PRIMARY is identified directly from MySQL's index_name.
     * We do NOT infer primary indexes by comparing columns.
     */
    for (const [tableName, tableIndexes] of indexMap.entries()) {
      const table = tables.get(tableName);

      if (!table) continue;

      for (const [indexName, indexData] of tableIndexes.entries()) {
        const index: IndexDefinition = {
          name: indexName,
          columns: indexData.columns,
          unique: indexData.nonUnique === 0,
          primary: indexName === "PRIMARY",
        };

        table.indexes.push(index);
      }
    }

    /*
     * ---------------------------------------------------------
     * Return the MySQL database as one SchemaDefinition
     * ---------------------------------------------------------
     */
    return [
      {
        name: databaseName,
        tables: Array.from(tables.values()),
      },
    ];
  }
}
