import { EmbeddingService } from "../../../infrastructure/embeddings/embedding.service.js";
import { SchemaGraphRepository } from "../../../infrastructure/mongo/repositories/schemaGraph.repository.js";
import {
  SemanticUnitRepository,
  SemanticSearchResult,
} from "../../../infrastructure/mongo/repositories/semanticUnit.repository.js";

export interface SchemaRetrievalOptions {
  limit?: number;
}

export interface HybridSearchResult extends SemanticSearchResult {
  vectorRank?: number;
  keywordRank?: number;
  reciprocalRankFusionScore: number;
}

export class SchemaRetriever {
  private static readonly DEFAULT_LIMIT = 5;
  private static readonly MAX_LIMIT = 20;

  // Standard RRF constant
  private static readonly RRF_K = 60;

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly semanticUnitRepository: SemanticUnitRepository,
    private readonly schemaGraphRepository: SchemaGraphRepository,
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

    const [vectorResults, keywordResults, graphResults] = await Promise.all([
      this.semanticUnitRepository.vectorSearch(
        databaseName,
        queryEmbedding,
        limit,
      ),

      this.semanticUnitRepository.keywordSearch(databaseName, question, limit),
      this.schemaGraphRepository.keywordSearch(databaseName, question),
    ]);

    // const hybridResults = this.reciprocalRankFusion(
    //   vectorResults,
    //   keywordResults,
    //   limit,
    // );

    return {
      vector: vectorResults,
      keyword: keywordResults,
      graph: graphResults,
    };
  }

  private reciprocalRankFusion(
    vectorResults: SemanticSearchResult[],
    keywordResults: SemanticSearchResult[],
    limit: number,
  ): HybridSearchResult[] {
    const results = new Map<string, HybridSearchResult>();

    vectorResults.forEach((result, index) => {
      const id = result._id.toString();
      const rank = index + 1;

      results.set(id, {
        ...result,
        vectorRank: rank,
        reciprocalRankFusionScore: 1 / (SchemaRetriever.RRF_K + rank),
      });
    });

    keywordResults.forEach((result, index) => {
      const id = result._id.toString();
      const rank = index + 1;

      const existing = results.get(id);

      if (existing) {
        existing.keywordRank = rank;

        existing.reciprocalRankFusionScore +=
          1 / (SchemaRetriever.RRF_K + rank);
      } else {
        results.set(id, {
          ...result,
          keywordRank: rank,
          reciprocalRankFusionScore: 1 / (SchemaRetriever.RRF_K + rank),
        });
      }
    });

    return Array.from(results.values())
      .sort((a, b) => b.reciprocalRankFusionScore - a.reciprocalRankFusionScore)
      .slice(0, limit);
  }

  private resolveLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
      return SchemaRetriever.DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(limit), SchemaRetriever.MAX_LIMIT);
  }
}
