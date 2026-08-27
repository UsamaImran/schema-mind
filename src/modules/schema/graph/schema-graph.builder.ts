import type {
  DatabaseSchema,
  ForeignKeyDefinition,
  SchemaDefinition,
  TableDefinition,
} from "../schema.types.js";

import type {
  SchemaGraph,
  SchemaGraphEdge,
  SchemaGraphNode,
} from "./schema-graph.types.js";

export class SchemaGraphBuilder {
  build(databaseSchema: DatabaseSchema): SchemaGraph {
    const nodes: SchemaGraphNode[] = [];
    const edges: SchemaGraphEdge[] = [];

    for (const schema of databaseSchema.schemas) {
      for (const table of schema.tables) {
        nodes.push(
          this.buildTableNode(databaseSchema.databaseName, schema, table),
        );

        edges.push(
          ...this.buildForeignKeyEdges(
            databaseSchema.databaseName,
            schema,
            table,
          ),
        );
      }
    }

    return {
      databaseName: databaseSchema.databaseName,
      nodes,
      edges,
    };
  }

  private buildTableNode(
    databaseName: string,
    schema: SchemaDefinition,
    table: TableDefinition,
  ): SchemaGraphNode {
    const nodeId = this.buildTableId(databaseName, schema.name, table.name);

    return {
      nodeId,
      type: "table",
      databaseName,
      schemaName: schema.name,
      tableName: table.name,
    };
  }

  private buildForeignKeyEdges(
    databaseName: string,
    schema: SchemaDefinition,
    table: TableDefinition,
  ): SchemaGraphEdge[] {
    return table.foreignKeys.map((foreignKey) =>
      this.buildForeignKeyEdge(databaseName, schema.name, table, foreignKey),
    );
  }

  private buildForeignKeyEdge(
    databaseName: string,
    schemaName: string,
    table: TableDefinition,
    foreignKey: ForeignKeyDefinition,
  ): SchemaGraphEdge {
    const source = this.buildTableId(databaseName, schemaName, table.name);

    const target = this.buildTableId(
      databaseName,
      foreignKey.referencedSchema,
      foreignKey.referencedTable,
    );

    const edgeId = [
      source,
      foreignKey.columnName,
      target,
      foreignKey.referencedColumn,
    ].join("::");

    return {
      edgeId,

      type: "references",

      from: source,
      to: target,

      metadata: {
        columnName: foreignKey.columnName,
        referencedColumn: foreignKey.referencedColumn,
      },
    };
  }

  private buildTableId(
    databaseName: string,
    schemaName: string,
    tableName: string,
  ): string {
    return `${databaseName}.${schemaName}.${tableName}`;
  }
}
