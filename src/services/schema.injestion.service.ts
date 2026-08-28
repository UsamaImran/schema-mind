import { EmbeddingService } from "../infrastructure/embeddings/embedding.service.js";

import { SchemaSourceRepository } from "../infrastructure/mongo/repositories/schemaSource.repository.js";

import {
  SemanticUnitInput,
  SemanticUnitRepository,
} from "../infrastructure/mongo/repositories/semanticUnit.repository.js";

import { SchemaGraphRepository } from "../infrastructure/mongo/repositories/schemaGraph.repository.js";

import { PostgreSQLSchemaIntrospector } from "../infrastructure/postgres/postgres.schema-introspector.js";

import { TokenizerService } from "../infrastructure/tokenization/tokenizer.service.js";

import { SchemaGraphBuilder } from "../modules/schema/graph/schema-graph.builder.js";

import {
  ColumnDefinition,
  DatabaseSchema,
  TableDefinition,
} from "../modules/schema/schema.types.js";

import { createSchemaFingerprint } from "../shared/utils/schema-fingerprint.js";

export class IngestionService {
  constructor(
    private readonly postgresIntrospector: PostgreSQLSchemaIntrospector,

    private readonly semanticUnitRepository: SemanticUnitRepository,

    private readonly schemaGraphRepository: SchemaGraphRepository,

    private readonly schemaSourceRepository: SchemaSourceRepository,

    private readonly tokenizerService: TokenizerService,

    private readonly embeddingService: EmbeddingService,

    private readonly schemaGraphBuilder: SchemaGraphBuilder,
  ) {}

  async ingestIfRequired(): Promise<void> {
    console.log("Checking schema ingestion status...");

    const databaseSchema = await this.postgresIntrospector.getSchema();

    const fingerprint = createSchemaFingerprint(databaseSchema);

    const existingSource = await this.schemaSourceRepository.findByDatabase(
      databaseSchema.databaseName,
    );

    if (!existingSource) {
      console.log("No existing schema source found. Starting ingestion.");

      await this.ingest(databaseSchema, fingerprint);

      return;
    }

    if (existingSource.schemaFingerprint !== fingerprint) {
      console.log("Database schema has changed. Starting re-ingestion.");

      await this.ingest(databaseSchema, fingerprint);

      return;
    }

    const tableCount = databaseSchema.schemas.reduce(
      (count, schema) => count + schema.tables.length,
      0,
    );

    const hasCompleteSemanticIngestion =
      await this.semanticUnitRepository.hasCompleteIngestion(
        databaseSchema.databaseName,
        tableCount,
      );

    const hasCompleteGraphIngestion =
      await this.schemaGraphRepository.existsForSource(existingSource._id);

    if (!hasCompleteSemanticIngestion || !hasCompleteGraphIngestion) {
      console.log(
        "Schema is unchanged, but ingestion is incomplete. Resuming ingestion.",
      );

      await this.ingest(databaseSchema, fingerprint);

      return;
    }

    console.log(
      "Schema unchanged and ingestion is complete. Skipping ingestion.",
    );
  }

  private async ingest(
    databaseSchema: DatabaseSchema,
    fingerprint: string,
  ): Promise<void> {
    const databaseName = databaseSchema.databaseName;

    console.log(`Starting schema ingestion for ${databaseName}...`);

    const schemaSource = await this.schemaSourceRepository.upsert({
      databaseName,
      databaseType: "postgresql",
    });

    await this.schemaSourceRepository.updateStatus(databaseName, "processing");

    try {
      console.log("Building schema graph...");

      const schemaGraph = this.schemaGraphBuilder.build(databaseSchema);

      console.log(
        `Graph built: ${schemaGraph.nodes.length} nodes, ${schemaGraph.edges.length} edges`,
      );

      const semanticUnits: SemanticUnitInput[] = [];

      for (const schema of databaseSchema.schemas) {
        for (const table of schema.tables) {
          const content = this.buildSemanticContent(
            databaseName,
            schema.name,
            table,
          );

          const tokenCount = this.tokenizerService.count(content);

          const [embedding] = await this.embeddingService.embed([content]);

          if (!embedding?.length) {
            throw new Error(
              `Failed to generate embedding for ${schema.name}.${table.name}`,
            );
          }

          semanticUnits.push({
            sourceId: schemaSource._id,
            databaseName,
            schemaName: schema.name,
            tableName: table.name,
            type: "table",
            content,
            tokenCount,
            embedding,
          });
        }
      }

      await this.semanticUnitRepository.replaceForSource(
        databaseName,
        semanticUnits,
      );

      console.log(
        `Semantic ingestion completed: ${semanticUnits.length} units`,
      );

      await this.schemaGraphRepository.replaceForSource({
        sourceId: schemaSource._id,
        databaseName,
        nodes: schemaGraph.nodes,
        edges: schemaGraph.edges,
      });

      console.log(
        `Graph ingestion completed: ${schemaGraph.nodes.length} nodes, ${schemaGraph.edges.length} edges`,
      );

      const tableCount = databaseSchema.schemas.reduce(
        (count, schema) => count + schema.tables.length,
        0,
      );

      const schemaCount = databaseSchema.schemas.length;

      await this.schemaSourceRepository.markSynced(
        databaseName,
        tableCount,
        schemaCount,
        fingerprint,
      );

      console.log(
        `Schema ingestion completed successfully for ${databaseName}`,
      );
    } catch (error) {
      await this.schemaSourceRepository.updateStatus(databaseName, "failed");

      throw error;
    }
  }

  private buildSemanticContent(
    databaseName: string,
    schemaName: string,
    table: TableDefinition,
  ): string {
    const columns = table.columns
      .map(
        (column: ColumnDefinition) =>
          `- ${column.name}: ${column.dataType}, ${
            column.nullable ? "NULL" : "NOT NULL"
          }${column.defaultValue ? `, DEFAULT ${column.defaultValue}` : ""}`,
      )
      .join("\n");

    const primaryKeys =
      table.primaryKeys.length > 0
        ? table.primaryKeys.map((key) => `- ${key}`).join("\n")
        : "None";

    const foreignKeys =
      table.foreignKeys.length > 0
        ? table.foreignKeys
            .map(
              (fk) =>
                `- ${fk.columnName} → ${fk.referencedSchema}.${fk.referencedTable}.${fk.referencedColumn}`,
            )
            .join("\n")
        : "None";

    const indexes =
      table.indexes.length > 0
        ? table.indexes
            .map(
              (index) =>
                `- ${index.name} (${index.columns.join(", ")})${
                  index.unique ? " [UNIQUE" : " ["
                }${index.primary ? ", PRIMARY" : ""}]`,
            )
            .join("\n")
        : "None";

    return [
      `Database: ${databaseName}`,
      "",
      `Schema: ${schemaName}`,
      "",
      `Table: ${table.name}`,
      "",
      "Columns:",
      columns,
      "",
      "Primary Keys:",
      primaryKeys,
      "",
      "Foreign Keys:",
      foreignKeys,
      "",
      "Indexes:",
      indexes,
    ].join("\n");
  }
}
