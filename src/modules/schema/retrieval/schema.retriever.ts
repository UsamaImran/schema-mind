import { EmbeddingService } from "../../../infrastructure/embeddings/embedding.service.js";
import {
  GraphSeed,
  SchemaGraphRepository,
} from "../../../infrastructure/mongo/repositories/schemaGraph.repository.js";
import {
  SemanticTableLookup,
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
  retrievalSource: "hybrid" | "graph";

  /**
   * Only exists when the result was confirmed/discovered by graph traversal.
   */
  graphDistance?: number;
  graphRank?: number;
  graphSeedHybridScore?: number;
}

export class SchemaRetriever {
  private static readonly DEFAULT_LIMIT = 5;
  private static readonly MAX_LIMIT = 20;

  private static readonly GRAPH_SEED_LIMIT = 3;
  private static readonly GRAPH_MAX_DEPTH = 2;
  private static readonly RRF_CANDIDATE_LIMIT = 15;
  private static readonly FINAL_RESULT_LIMIT = 5;

  /**
   * Maximum graph boost applied to a candidate already found by hybrid retrieval.
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
    const finalLimit = this.resolveLimit(
      options.limit ?? SchemaRetriever.FINAL_RESULT_LIMIT,
    );
    const candidateLimit = Math.max(
      SchemaRetriever.RRF_CANDIDATE_LIMIT,
      finalLimit,
    );

    const [queryEmbedding] = await this.embeddingService.embed([question]);

    if (!queryEmbedding?.length) {
      throw new Error("Failed to generate query embedding");
    }

    const [vectorResults, keywordResults] = await Promise.all([
      this.semanticUnitRepository.vectorSearch(
        databaseName,
        queryEmbedding,
        candidateLimit,
      ),

      this.semanticUnitRepository.keywordSearch(
        databaseName,
        question,
        candidateLimit,
      ),
    ]);

    const hybridResults = this.reciprocalRankFusion(
      vectorResults,
      keywordResults,
      candidateLimit,
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
              limit: candidateLimit,
            },
          )
        : [];

    // ============================================================
    // STEP 6: Graph candidate discovery + final ranking
    // ============================================================

    const finalResults = await this.buildFinalResults(
      hybridResults,
      graphResults,
      databaseName,
      finalLimit,
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

      if (!result || !result.tableName || !result.sourceId) {
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
   * Build the final retrieval pool from:
   *
   * 1. hybrid candidates discovered by semantic + keyword retrieval
   * 2. graph-only candidates discovered through FK traversal
   *
   * Graph-only candidates do not get another embedding/keyword search.
   * Their relevance is anchored to the strength of the hybrid seed and
   * decays with FK distance.
   */
  private async buildFinalResults(
    hybridResults: HybridSearchResult[],
    graphResults: Array<{
      nodeId: string;
      sourceId: SemanticSearchResult["sourceId"];
      databaseName: string;
      tableName?: string;
      schemaName?: string;
      graphRank: number;
      score: number;
      distance: number;
      seedHybridScore: number;
    }>,
    databaseName: string,
    limit: number,
  ): Promise<HybridSearchResult[]> {
    const hybridByNodeId = new Set(
      hybridResults
        .filter((result) => result.tableName)
        .map((result) =>
          [
            result.databaseName,
            result.schemaName ?? "public",
            result.tableName,
          ].join("."),
        ),
    );

    const graphOnlyResults = graphResults.filter(
      (result) =>
        result.databaseName === databaseName &&
        !!result.tableName &&
        !hybridByNodeId.has(
          [
            result.databaseName,
            result.schemaName ?? "public",
            result.tableName,
          ].join("."),
        ),
    );

    const semanticTables: SemanticTableLookup[] = graphOnlyResults.map(
      (result) => ({
        ...(result.schemaName !== undefined && {
          schemaName: result.schemaName,
        }),
        tableName: result.tableName!,
      }),
    );

    const semanticUnits = await this.semanticUnitRepository.findByTables(
      databaseName,
      semanticTables,
    );

    const semanticByNodeId = new Map(
      semanticUnits.map((unit) => [
        [
          unit.databaseName,
          unit.schemaName ?? "public",
          unit.tableName,
        ].join("."),
        unit,
      ]),
    );

    const graphCandidates = this.createGraphCandidates(
      graphOnlyResults,
      semanticByNodeId,
    );

    const hybridCandidates = hybridResults.map((result) =>
      this.applyGraphMatch(result, graphResults),
    );

    return [...hybridCandidates, ...graphCandidates]
      .sort((a, b) => {
        if (b.finalScore !== a.finalScore) {
          return b.finalScore - a.finalScore;
        }

        if (
          b.reciprocalRankFusionScore !==
          a.reciprocalRankFusionScore
        ) {
          return (
            b.reciprocalRankFusionScore -
            a.reciprocalRankFusionScore
          );
        }

        if ((b.graphDistance ?? Infinity) !== (a.graphDistance ?? Infinity)) {
          return (a.graphDistance ?? Infinity) - (b.graphDistance ?? Infinity);
        }

        return a._id.toString().localeCompare(b._id.toString());
      })
      .slice(0, limit);
  }

  /**
   * Convert graph-only discoveries into semantic candidates so their
   * complete table context can be passed to SQL generation.
   */
  private createGraphCandidates(
    graphResults: Array<{
      nodeId: string;
      tableName?: string;
      schemaName?: string;
      graphRank: number;
      score: number;
      distance: number;
      seedHybridScore: number;
    }>,
    semanticByNodeId: Map<string, SemanticSearchResult>,
  ): HybridSearchResult[] {
    const candidates = new Map<string, HybridSearchResult>();

    for (const graphResult of graphResults) {
      if (!graphResult.tableName) {
        continue;
      }

      const nodeId = [
        graphResult.schemaName ?? "public",
        graphResult.tableName,
      ].join(".");

      const fullNodeId = graphResult.nodeId;
      const semanticUnit = [...semanticByNodeId.entries()].find(([key]) =>
        key.endsWith(nodeId),
      )?.[1];

      if (!semanticUnit) {
        continue;
      }

      const graphScore =
        graphResult.seedHybridScore / (1 + graphResult.distance);

      const candidate: HybridSearchResult = {
        ...semanticUnit,
        score: 0,
        reciprocalRankFusionScore: 0,
        finalScore: graphScore,
        graphMatched: true,
        retrievalSource: "graph",
        graphDistance: graphResult.distance,
        graphRank: graphResult.graphRank,
        graphSeedHybridScore: graphResult.seedHybridScore,
      };

      const existing = candidates.get(fullNodeId);

      if (
        !existing ||
        candidate.finalScore > existing.finalScore ||
        (candidate.finalScore === existing.finalScore &&
          (candidate.graphDistance ?? Infinity) <
            (existing.graphDistance ?? Infinity))
      ) {
        candidates.set(fullNodeId, candidate);
      }
    }

    return [...candidates.values()];
  }

  /**
   * Apply graph evidence to a candidate that was already discovered by
   * semantic/keyword retrieval.
   */
  private applyGraphMatch(
    result: HybridSearchResult,
    graphResults: Array<{
      nodeId: string;
      graphRank: number;
      distance: number;
      seedHybridScore: number;
    }>,
  ): HybridSearchResult {
    if (!result.tableName || !result.sourceId) {
      return {
        ...result,
        finalScore: result.reciprocalRankFusionScore,
        graphMatched: false,
        retrievalSource: "hybrid",
      };
    }

    const schemaName = result.schemaName ?? "public";
    const nodeId = [result.databaseName, schemaName, result.tableName].join(
      ".",
    );
    const graphMatch = graphResults.find((candidate) =>
      candidate.nodeId === nodeId,
    );

    if (!graphMatch) {
      return {
        ...result,
        finalScore: result.reciprocalRankFusionScore,
        graphMatched: false,
        retrievalSource: "hybrid",
      };
    }

    const graphBoost =
      SchemaRetriever.GRAPH_BOOST / Math.pow(2, graphMatch.distance);

    return {
      ...result,
      finalScore: result.reciprocalRankFusionScore + graphBoost,
      graphMatched: true,
      retrievalSource: "hybrid",
      graphDistance: graphMatch.distance,
      graphRank: graphMatch.graphRank,
      graphSeedHybridScore: graphMatch.seedHybridScore,
    };
  }

  /**
   * Reciprocal Rank Fusion.
   */
  private reciprocalRankFusion(
    vectorResults: SemanticSearchResult[],
    keywordResults: SemanticSearchResult[],
    limit: number,
  ): HybridSearchResult[] {
    const results = new Map<string, HybridSearchResult>();

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
        retrievalSource: "hybrid",
        dialect: result.dialect ?? "postgresql",
      });
    });

    keywordResults.forEach((result, index) => {
      const id = result._id.toString();
      const rank = index + 1;
      const score = 1 / (SchemaRetriever.RRF_K + rank);
      const existing = results.get(id);

      if (existing) {
        existing.keywordRank = rank;
        existing.reciprocalRankFusionScore += score;
        existing.finalScore = existing.reciprocalRankFusionScore;
        return;
      }

      results.set(id, {
        ...result,
        keywordRank: rank,
        reciprocalRankFusionScore: score,
        finalScore: score,
        graphMatched: false,
        retrievalSource: "hybrid",
      });
    });

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
