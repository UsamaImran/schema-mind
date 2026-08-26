export type SchemaDocument =
  | TableDocument
  | RelationshipDocument
  | SchemaSummaryDocument;

export interface BaseSchemaDocument {
  databaseName: string;
  schemaName: string;
  content: string;
}

export interface TableDocument extends BaseSchemaDocument {
  type: "table";
  tableName: string;
}

export interface RelationshipDocument extends BaseSchemaDocument {
  type: "relationship";
  tableName: string;
  referencedTableName: string;
}

export interface SchemaSummaryDocument extends BaseSchemaDocument {
  type: "schema-summary";
}
