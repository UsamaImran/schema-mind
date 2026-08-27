import { EmbeddingService } from "../infrastructure/embeddings/embedding.service.js";
import { SchemaSourceRepository } from "../infrastructure/mongo/repositories/schemaSource.repository.js";
import { SemanticUnitRepository } from "../infrastructure/mongo/repositories/semanticUnit.repository.js";
import { PostgreSQLAdapter } from "../infrastructure/postgres/postgres.adapter.js";
import { PostgreSQLSchemaIntrospector } from "../infrastructure/postgres/postgres.schema-introspector.js";
import { TokenizerService } from "../infrastructure/tokenization/tokenizer.service.js";
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

    this.ingestionService = new IngestionService(
      postgresIntrospector,
      semanticUnitRepository,
      schemaSourceRepository,
      tokenizerService,
      embeddingService,
    );
  }

  async start(): Promise<void> {
    await this.ingestionService.ingestIfRequired();
  }
}
