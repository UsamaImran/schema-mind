import { EmbeddingService } from "../infrastructure/embeddings/embedding.service.js";
import { SchemaSourceRepository } from "../infrastructure/mongo/repositories/schemaSource.repository.js";
import {
  SemanticUnitInput,
  SemanticUnitRepository,
} from "../infrastructure/mongo/repositories/semanticUnit.repository.js";
import { PostgreSQLSchemaIntrospector } from "../infrastructure/postgres/postgres.schema-introspector.js";

import { TokenizerService } from "../infrastructure/tokenization/tokenizer.service.js";
import {
  ColumnDefinition,
  TableDefinition,
} from "../modules/schema/schema.types.js";

export class IngestionService {
  constructor(
    private readonly postgresIntrospector: PostgreSQLSchemaIntrospector,
    private readonly semanticUnitRepository: SemanticUnitRepository,
    private readonly schemaSourceRepository: SchemaSourceRepository,
    private readonly tokenizerService: TokenizerService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async ingest(): Promise<void> {
    console.log("Starting schema ingestion...");

    const databaseSchema = await this.postgresIntrospector.getSchema();

    const schemaSource = await this.schemaSourceRepository.upsert({
      databaseName: databaseSchema.databaseName,
      databaseType: "postgresql",
    });

    await this.schemaSourceRepository.updateStatus(
      databaseSchema.databaseName,
      "processing",
    );

    try {
      const semanticUnits: SemanticUnitInput[] = [];

      for (const schema of databaseSchema.schemas) {
        for (const table of schema.tables) {
          const content = this.buildSemanticContent(
            databaseSchema.databaseName,
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
            databaseName: databaseSchema.databaseName,
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
        databaseSchema.databaseName,
        semanticUnits,
      );

      const tableCount = databaseSchema.schemas.reduce(
        (count, schema) => count + schema.tables.length,
        0,
      );

      await this.schemaSourceRepository.markSynced(
        databaseSchema.databaseName,
        tableCount,
        databaseSchema.schemas.length,
      );

      console.log(
        `Schema ingestion completed: ${semanticUnits.length} semantic units`,
      );
    } catch (error) {
      await this.schemaSourceRepository.updateStatus(
        databaseSchema.databaseName,
        "failed",
      );

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
