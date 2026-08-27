import { EmbeddingService } from "../../../infrastructure/embeddings/embedding.service.js";
import {
  GraphSeed,
  SchemaGraphRepository,
} from "../../../infrastructure/mongo/repositories/schemaGraph.repository.js";
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
  finalScore: number;

  graphMatched: boolean;

  /**
   * Only exists when the result was confirmed by graph traversal.
   *
   * IMPORTANT:
   * With exactOptionalPropertyTypes enabled, this must be
   * optional rather than `graphDistance: number | undefined`.
   */
  graphDistance?: number;
}

export class SchemaRetriever {
  private static readonly DEFAULT_LIMIT = 5;
  private static readonly MAX_LIMIT = 20;

  private static readonly GRAPH_SEED_LIMIT = 3;
  private static readonly GRAPH_MAX_DEPTH = 2;
  private static readonly RRF_CANDIDATE_LIMIT = 15;
  private static readonly FINAL_RESULT_LIMIT = 5;

  /**
   * Maximum graph boost.
   *
   * Distance 0 -> 0.005
   * Distance 1 -> 0.0025
   * Distance 2 -> 0.00125
   */
  private static readonly GRAPH_BOOST = 0.005;

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
    const limit = SchemaRetriever.RRF_CANDIDATE_LIMIT;

    const [queryEmbedding] = await this.embeddingService.embed([question]);

    if (!queryEmbedding?.length) {
      throw new Error("Failed to generate query embedding");
    }

    const [vectorResults, keywordResults] = await Promise.all([
      this.semanticUnitRepository.vectorSearch(
        databaseName,
        queryEmbedding,
        limit,
      ),

      this.semanticUnitRepository.keywordSearch(databaseName, question, limit),
    ]);

    const hybridResults = this.reciprocalRankFusion(
      vectorResults,
      keywordResults,
      limit,
    );

    // ============================================================
    // STEP 4: Create graph seeds
    // ============================================================

    const graphSeeds = this.createGraphSeeds(hybridResults, databaseName);

    // ============================================================
    // STEP 5: Graph expansion
    // ============================================================

    const graphResults =
      graphSeeds.length > 0
        ? await this.schemaGraphRepository.expandFromSeeds(
            databaseName,
            graphSeeds,
            {
              maxDepth: SchemaRetriever.GRAPH_MAX_DEPTH,
              limit,
            },
          )
        : [];

    // ============================================================
    // STEP 6: Graph confirmation + boost
    // ============================================================

    const finalResults = this.applyGraphBoost(
      hybridResults,
      graphResults,
      limit,
    );

    return {
      vector: vectorResults,
      keyword: keywordResults,
      hybrid: hybridResults,
      graph: graphResults,
      final: finalResults,
    };
  }

  /**
   * Convert strongest hybrid results into graph seeds.
   *
   * GraphSeed does not contain nodeId.
   * SchemaGraphRepository constructs/resolves the node identity.
   */
  private createGraphSeeds(
    hybridResults: HybridSearchResult[],
    databaseName: string,
  ): GraphSeed[] {
    const seeds: GraphSeed[] = [];

    const seen = new Set<string>();

    for (
      let index = 0;
      index < hybridResults.length &&
      seeds.length < SchemaRetriever.GRAPH_SEED_LIMIT;
      index++
    ) {
      const result = hybridResults[index];

      if (!result) {
        continue;
      }

      if (!result.tableName) {
        continue;
      }

      if (!result.sourceId) {
        continue;
      }

      const schemaName = result.schemaName ?? "public";

      const seedKey = [
        result.sourceId.toString(),
        databaseName,
        schemaName,
        result.tableName,
      ].join(":");

      if (seen.has(seedKey)) {
        continue;
      }

      seen.add(seedKey);

      seeds.push({
        sourceId: result.sourceId,
        databaseName,
        schemaName,
        tableName: result.tableName,
        hybridRank: index + 1,
        hybridScore: result.reciprocalRankFusionScore,
      });
    }

    return seeds;
  }

  /**
   * Confirm hybrid results against graph results and apply a
   * distance-aware graph boost.
   *
   * Graph-discovered tables are NOT automatically inserted into
   * the final result set.
   *
   * Only tables already present in hybridResults are boosted.
   */
  private applyGraphBoost(
    hybridResults: HybridSearchResult[],
    graphResults: Array<{
      nodeId: string;
      tableName?: string;
      schemaName?: string;
      graphRank: number;
      score: number;
      distance: number;
    }>,
    limit: number,
  ): HybridSearchResult[] {
    const graphMatches = new Map<
      string,
      {
        distance: number;
        graphRank: number;
      }
    >();

    for (const graphResult of graphResults) {
      graphMatches.set(graphResult.nodeId, {
        distance: graphResult.distance,
        graphRank: graphResult.graphRank,
      });
    }

    const boostedResults: HybridSearchResult[] = hybridResults.map(
      (result): HybridSearchResult => {
        /*
         * No usable table/source information.
         * Return the hybrid result unchanged apart from
         * resetting graph-related fields.
         */
        if (!result.tableName || !result.sourceId) {
          return {
            ...result,
            finalScore: result.reciprocalRankFusionScore,
            graphMatched: false,
          };
        }

        const schemaName = result.schemaName ?? "public";

        /*
         * IMPORTANT:
         *
         * Must match SchemaGraphRepository's nodeId convention:
         *
         * schema-mind-db.public.film
         */
        const nodeId = [result.databaseName, schemaName, result.tableName].join(
          ".",
        );

        const graphMatch = graphMatches.get(nodeId);

        /*
         * Hybrid result was not found in graph traversal.
         */
        if (!graphMatch) {
          return {
            ...result,
            finalScore: result.reciprocalRankFusionScore,
            graphMatched: false,
          };
        }

        /*
         * Distance-aware boost:
         *
         * distance 0 -> 0.005
         * distance 1 -> 0.0025
         * distance 2 -> 0.00125
         */
        const graphBoost =
          SchemaRetriever.GRAPH_BOOST / Math.pow(2, graphMatch.distance);

        return {
          ...result,
          finalScore: result.reciprocalRankFusionScore + graphBoost,
          graphMatched: true,
          graphDistance: graphMatch.distance,
        };
      },
    );

    return boostedResults
      .sort((a, b) => {
        /*
         * Primary ordering:
         * graph-boosted/final score.
         */
        if (b.finalScore !== a.finalScore) {
          return b.finalScore - a.finalScore;
        }

        /*
         * Secondary ordering:
         * original RRF score.
         */
        if (b.reciprocalRankFusionScore !== a.reciprocalRankFusionScore) {
          return b.reciprocalRankFusionScore - a.reciprocalRankFusionScore;
        }

        /*
         * Deterministic final tie-breaker.
         */
        return a._id.toString().localeCompare(b._id.toString());
      })
      .slice(0, limit);
  }

  /**
   * Reciprocal Rank Fusion.
   *
   * A result appearing in both vector and keyword retrieval
   * receives a score contribution from both rankings.
   */
  private reciprocalRankFusion(
    vectorResults: SemanticSearchResult[],
    keywordResults: SemanticSearchResult[],
    limit: number,
  ): HybridSearchResult[] {
    const results = new Map<string, HybridSearchResult>();

    // ============================================================
    // Vector contribution
    // ============================================================

    vectorResults.forEach((result, index) => {
      const id = result._id.toString();

      const rank = index + 1;

      const score = 1 / (SchemaRetriever.RRF_K + rank);

      results.set(id, {
        ...result,

        vectorRank: rank,

        reciprocalRankFusionScore: score,

        finalScore: score,

        graphMatched: false,
      });
    });

    // ============================================================
    // Keyword contribution
    // ============================================================

    keywordResults.forEach((result, index) => {
      const id = result._id.toString();

      const rank = index + 1;

      const score = 1 / (SchemaRetriever.RRF_K + rank);

      const existing = results.get(id);

      /*
       * Result appeared in both vector and keyword retrieval.
       */
      if (existing) {
        existing.keywordRank = rank;

        existing.reciprocalRankFusionScore += score;

        existing.finalScore = existing.reciprocalRankFusionScore;

        return;
      }

      /*
       * Result appeared only in keyword retrieval.
       */
      results.set(id, {
        ...result,

        keywordRank: rank,

        reciprocalRankFusionScore: score,

        finalScore: score,

        graphMatched: false,
      });
    });

    // ============================================================
    // Sort by RRF score
    // ============================================================

    return Array.from(results.values())
      .sort((a, b) => b.reciprocalRankFusionScore - a.reciprocalRankFusionScore)
      .slice(0, limit);
  }

  /**
   * Resolve and clamp requested result limit.
   */
  private resolveLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
      return SchemaRetriever.DEFAULT_LIMIT;
    }

    return Math.min(Math.floor(limit), SchemaRetriever.MAX_LIMIT);
  }
}
