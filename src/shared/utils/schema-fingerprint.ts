import { createHash } from "node:crypto";
import {
  TableDefinition,
  DatabaseSchema,
  SchemaDefinition,
} from "../../modules/schema/schema.types.js";

function normalizeTable(table: TableDefinition) {
  return {
    name: table.name,

    columns: table.columns
      .map((column) => ({
        name: column.name,
        dataType: column.dataType,
        nullable: column.nullable,
        defaultValue: column.defaultValue,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),

    primaryKeys: [...table.primaryKeys].sort(),

    foreignKeys: table.foreignKeys
      .map((foreignKey) => ({
        columnName: foreignKey.columnName,
        referencedSchema: foreignKey.referencedSchema,
        referencedTable: foreignKey.referencedTable,
        referencedColumn: foreignKey.referencedColumn,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),

    indexes: table.indexes
      .map((index) => ({
        name: index.name,
        columns: [...index.columns],
        unique: index.unique,
        primary: index.primary,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function normalizeSchema(schema: SchemaDefinition) {
  return {
    name: schema.name,

    tables: schema.tables
      .map(normalizeTable)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function createSchemaFingerprint(
  databaseSchema: DatabaseSchema,
): string {
  const normalizedSchema = {
    databaseName: databaseSchema.databaseName,

    schemas: databaseSchema.schemas
      .map(normalizeSchema)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };

  const serialized = JSON.stringify(normalizedSchema);

  return createHash("sha256").update(serialized).digest("hex");
}
