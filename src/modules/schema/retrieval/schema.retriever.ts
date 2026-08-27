import { EmbeddingService } from "../../../infrastructure/embeddings/embedding.service.js";
import { SemanticUnitRepository } from "../../../infrastructure/mongo/repositories/semanticUnit.repository.js";

export interface SchemaRetrievalOptions {
  limit?: number;
}

export class SchemaRetriever {
  private static readonly DEFAULT_LIMIT = 5;
  private static readonly MAX_LIMIT = 20;

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly semanticUnitRepository: SemanticUnitRepository,
  ) {}

  async retrieve(
    question: string,
    databaseName: string,
    options: SchemaRetrievalOptions = {},
  ) {
    const limit = this.resolveLimit(options.limit);

    const [queryEmbedding] = await this.embeddingService.embed([question]);

    if (!queryEmbedding?.length) {
      throw new Error("Failed to generate query embedding");
    }

    return this.semanticUnitRepository.vectorSearch(
      databaseName,
      queryEmbedding,
      limit,
    );
  }

  private resolveLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
      return SchemaRetriever.DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(limit), SchemaRetriever.MAX_LIMIT);
  }
}
