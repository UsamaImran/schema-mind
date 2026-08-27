export interface SchemaGraph {
  databaseName: string;

  nodes: SchemaGraphNode[];

  edges: SchemaGraphEdge[];
}

export interface SchemaGraphNode {
  nodeId: string;

  type: "database" | "schema" | "table" | "column";

  databaseName: string;

  schemaName?: string;

  tableName?: string;

  columnName?: string;
}

export interface SchemaGraphEdge {
  edgeId: string;

  type: "contains" | "has_column" | "references" | "belongs_to";

  from: string;

  to: string;

  metadata?: {
    columnName?: string;

    referencedColumn?: string;
  };
}
