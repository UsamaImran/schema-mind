import { EmbeddingService } from "../infrastructure/embeddings/embedding.service.js";
import { SchemaGraphRepository } from "../infrastructure/mongo/repositories/schemaGraph.repository.js";
import { SchemaSourceRepository } from "../infrastructure/mongo/repositories/schemaSource.repository.js";
import { SemanticUnitRepository } from "../infrastructure/mongo/repositories/semanticUnit.repository.js";
import { PostgreSQLAdapter } from "../infrastructure/postgres/postgres.adapter.js";
import { PostgreSQLSchemaIntrospector } from "../infrastructure/postgres/postgres.schema-introspector.js";
import { TokenizerService } from "../infrastructure/tokenization/tokenizer.service.js";
import { SchemaGraphBuilder } from "../modules/schema/graph/schema-graph.builder.js";
import { IngestionService } from "./schema.injestion.service.js";

export class SchemaIngestionInitiator {
  private readonly ingestionService: IngestionService;

  constructor() {
    const postgresAdapter = new PostgreSQLAdapter();
    const postgresIntrospector = new PostgreSQLSchemaIntrospector(
      postgresAdapter,
    );
    const semanticUnitRepository = new SemanticUnitRepository();
    const schemaSourceRepository = new SchemaSourceRepository();
    const tokenizerService = new TokenizerService();
    const embeddingService = new EmbeddingService();
    const schemaGraphRepository = new SchemaGraphRepository();
    const schemaGraphBuilder = new SchemaGraphBuilder();

    this.ingestionService = new IngestionService(
      postgresIntrospector,
      semanticUnitRepository,
      schemaGraphRepository,
      schemaSourceRepository,
      tokenizerService,
      embeddingService,
      schemaGraphBuilder,
    );
  }

  async start(): Promise<void> {
    await this.ingestionService.ingestIfRequired();
  }
}
