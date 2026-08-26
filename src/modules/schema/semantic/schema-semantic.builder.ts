import type {
  DatabaseSchema,
  ForeignKeyDefinition,
  SchemaDefinition,
  TableDefinition,
} from "../schema.types.js";

import type {
  RelationshipDocument,
  SchemaDocument,
  SchemaSummaryDocument,
  TableDocument,
} from "./schema-document.types.js";

export class SchemaSemanticBuilder {
  build(databaseSchema: DatabaseSchema): SchemaDocument[] {
    const documents: SchemaDocument[] = [];

    for (const schema of databaseSchema.schemas) {
      documents.push(
        this.buildSchemaSummaryDocument(databaseSchema.databaseName, schema),
      );

      for (const table of schema.tables) {
        documents.push(
          this.buildTableDocument(
            databaseSchema.databaseName,
            schema.name,
            table,
          ),
        );

        documents.push(
          ...this.buildRelationshipDocuments(
            databaseSchema.databaseName,
            schema.name,
            table,
          ),
        );
      }
    }

    return documents;
  }

  private buildSchemaSummaryDocument(
    databaseName: string,
    schema: SchemaDefinition,
  ): SchemaSummaryDocument {
    const tables = schema.tables.map((table) => `- ${table.name}`).join("\n");

    return {
      type: "schema-summary",
      databaseName,
      schemaName: schema.name,
      content: [
        `Database: ${databaseName}`,
        `Schema: ${schema.name}`,
        "",
        "Tables:",
        tables,
      ].join("\n"),
    };
  }

  private buildTableDocument(
    databaseName: string,
    schemaName: string,
    table: TableDefinition,
  ): TableDocument {
    return {
      type: "table",
      databaseName,
      schemaName,
      tableName: table.name,
      content: this.buildTableContent(databaseName, schemaName, table),
    };
  }

  private buildTableContent(
    databaseName: string,
    schemaName: string,
    table: TableDefinition,
  ): string {
    const sections: string[] = [
      `Database: ${databaseName}`,
      `Schema: ${schemaName}`,
      `Table: ${table.name}`,
      "",
      this.buildColumnsSection(table),
    ];

    if (table.primaryKeys.length > 0) {
      sections.push("", this.buildPrimaryKeysSection(table));
    }

    if (table.foreignKeys.length > 0) {
      sections.push("", this.buildForeignKeysSection(table));
    }

    if (table.indexes.length > 0) {
      sections.push("", this.buildIndexesSection(table));
    }

    return sections.join("\n");
  }

  private buildColumnsSection(table: TableDefinition): string {
    const columns = table.columns
      .map((column) => {
        const nullable = column.nullable ? "NULL" : "NOT NULL";

        const defaultValue = column.defaultValue
          ? `, DEFAULT ${column.defaultValue}`
          : "";

        return `- ${column.name}: ${column.dataType}, ${nullable}${defaultValue}`;
      })
      .join("\n");

    return `Columns:\n${columns}`;
  }

  private buildPrimaryKeysSection(table: TableDefinition): string {
    return [
      "Primary Keys:",
      ...table.primaryKeys.map((column) => `- ${column}`),
    ].join("\n");
  }

  private buildForeignKeysSection(table: TableDefinition): string {
    return [
      "Foreign Keys:",
      ...table.foreignKeys.map((foreignKey) =>
        this.formatForeignKey(foreignKey),
      ),
    ].join("\n");
  }

  private formatForeignKey(foreignKey: ForeignKeyDefinition): string {
    return [
      `- ${foreignKey.columnName}`,
      `references`,
      `${foreignKey.referencedSchema}.${foreignKey.referencedTable}.${foreignKey.referencedColumn}`,
    ].join(" ");
  }

  private buildIndexesSection(table: TableDefinition): string {
    const indexes = table.indexes
      .map((index) => {
        const properties = [
          index.unique ? "UNIQUE" : null,
          index.primary ? "PRIMARY" : null,
        ]
          .filter(Boolean)
          .join(", ");

        const suffix = properties ? ` [${properties}]` : "";

        return `- ${index.name} (${index.columns.join(", ")})${suffix}`;
      })
      .join("\n");

    return `Indexes:\n${indexes}`;
  }

  private buildRelationshipDocuments(
    databaseName: string,
    schemaName: string,
    table: TableDefinition,
  ): RelationshipDocument[] {
    return table.foreignKeys.map((foreignKey) => ({
      type: "relationship",
      databaseName,
      schemaName,
      tableName: table.name,
      referencedTableName: foreignKey.referencedTable,
      content: this.buildRelationshipContent(
        databaseName,
        schemaName,
        table,
        foreignKey,
      ),
    }));
  }

  private buildRelationshipContent(
    databaseName: string,
    schemaName: string,
    table: TableDefinition,
    foreignKey: ForeignKeyDefinition,
  ): string {
    return [
      `Database: ${databaseName}`,
      `Schema: ${schemaName}`,
      "",
      "Relationship:",
      `${schemaName}.${table.name}.${foreignKey.columnName}`,
      "references",
      `${foreignKey.referencedSchema}.${foreignKey.referencedTable}.${foreignKey.referencedColumn}`,
    ].join("\n");
  }
}
