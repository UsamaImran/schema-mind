export interface DatabaseSchema {
  databaseName: string;
  dialect: SqlDialect;
  schemas: SchemaDefinition[];
}

export type SqlDialect = "postgresql" | "mysql" | "sqlite" | "mssql";

export interface SchemaDefinition {
  name: string;
  tables: TableDefinition[];
}

export interface TableDefinition {
  name: string;
  columns: ColumnDefinition[];
  primaryKeys: string[];
  foreignKeys: ForeignKeyDefinition[];
  indexes: IndexDefinition[];
}

export interface ColumnDefinition {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
}

export interface ForeignKeyDefinition {
  columnName: string;
  referencedSchema: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}
