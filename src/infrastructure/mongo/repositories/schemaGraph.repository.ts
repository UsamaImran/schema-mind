import { Types } from "mongoose";

import {
  SchemaGraphModel,
  type SchemaGraph,
  type SchemaGraphDocument,
  type SchemaGraphNode,
} from "../models/schemaGraph.model.js";

/**
 * Input used when creating/replacing a graph for a schema source.
 */
export interface SchemaGraphInput {
  sourceId: Types.ObjectId;
  databaseName: string;
  nodes: SchemaGraph["nodes"];
  edges: SchemaGraph["edges"];
}

/**
 * A table selected by Step 1 hybrid retrieval.
 *
 * This intentionally does NOT contain a graph nodeId initially.
 *
 * Semantic-unit _id != graph nodeId.
 *
 * resolveSeeds() converts this into a graph-aware seed.
 */
export interface GraphSeed {
  sourceId: Types.ObjectId;
  databaseName: string;
  schemaName?: string;
  tableName: string;

  /**
   * RRF score produced by hybrid retrieval.
   */
  hybridScore: number;

  /**
   * Rank produced by hybrid retrieval.
   */
  hybridRank: number;
}

/**
 * Graph seed after resolving the semantic-unit table
 * to an actual graph node.
 */
export interface ResolvedGraphSeed extends GraphSeed {
  nodeId: string;
}

/**
 * Options controlling graph expansion.
 */
export interface GraphExpansionOptions {
  /**
   * Maximum number of FK hops from a seed.
   *
   * 0 = seed tables only
   * 1 = seed + directly related tables
   * 2 = seed + relationships up to two hops away
   */
  maxDepth?: number;

  /**
   * Maximum number of graph tables returned.
   */
  limit?: number;
}

/**
 * A table discovered during graph expansion.
 */
export interface GraphExpansionResult {
  nodeId: string;

  sourceId: Types.ObjectId;
  databaseName: string;

  schemaName?: string;
  tableName?: string;

  /**
   * The hybrid seed from which this node was reached.
   */
  seedNodeId: string;

  /**
   * Number of FK relationships between the seed and this table.
   */
  distance: number;

  /**
   * Graph-only relevance score.
   *
   * distance 0 => 1
   * distance 1 => 0.5
   * distance 2 => 0.333...
   */
  graphScore: number;

  /**
   * Hybrid rank of the originating seed.
   *
   * Used as a tie-breaker when multiple graph nodes have
   * the same graph distance.
   */
  seedHybridRank: number;

  /**
   * Hybrid score of the originating seed.
   */
  seedHybridScore: number;
}

/**
 * Backwards-compatible traversal result shape.
 *
 * This can be useful if other parts of the application already
 * consume graphRank / score.
 */
export interface GraphTraversalResult extends GraphExpansionResult {
  graphRank: number;
  score: number;
}

/**
 * Options for the lower-level traversal method.
 */
export interface GraphTraversalOptions {
  maxDepth?: number;
  limit?: number;
}

export class SchemaGraphRepository {
  /**
   * Replace the graph belonging to a schema source.
   */
  async replaceForSource(
    graph: SchemaGraphInput,
  ): Promise<SchemaGraphDocument> {
    return SchemaGraphModel.findOneAndReplace(
      {
        sourceId: graph.sourceId,
      },
      {
        sourceId: graph.sourceId,
        databaseName: graph.databaseName,
        nodes: graph.nodes,
        edges: graph.edges,
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
      },
    ).exec();
  }

  /**
   * Find the graph belonging to a database.
   */
  async findByDatabase(
    databaseName: string,
  ): Promise<SchemaGraphDocument | null> {
    return SchemaGraphModel.findOne({
      databaseName,
    }).exec();
  }

  /**
   * Find the graph belonging to a schema source.
   */
  async findBySourceId(
    sourceId: Types.ObjectId,
  ): Promise<SchemaGraphDocument | null> {
    return SchemaGraphModel.findOne({
      sourceId,
    }).exec();
  }

  /**
   * Check whether a graph exists for a schema source.
   */
  async existsForSource(sourceId: Types.ObjectId): Promise<boolean> {
    const result = await SchemaGraphModel.exists({
      sourceId,
    });

    return result !== null;
  }

  /**
   * Delete the graph belonging to a schema source.
   */
  async deleteForSource(sourceId: Types.ObjectId): Promise<void> {
    await SchemaGraphModel.deleteOne({
      sourceId,
    }).exec();
  }

  /**
   * Resolve Step 1 hybrid retrieval results into graph node IDs.
   *
   * Step 1 knows about semantic-unit documents.
   *
   * Step 2 knows about graph nodes.
   *
   * They are different identity systems, so we resolve using:
   *
   * sourceId
   * databaseName
   * schemaName
   * tableName
   *
   * rather than trying to use the semantic-unit MongoDB _id
   * as a graph node ID.
   */
  async resolveSeeds(seeds: GraphSeed[]): Promise<ResolvedGraphSeed[]> {
    if (seeds.length === 0) {
      return [];
    }

    /**
     * Graphs are stored one-per-source.
     *
     * Therefore we can fetch all relevant graphs in one query.
     */
    const sourceIds = [
      ...new Set(seeds.map((seed) => seed.sourceId.toString())),
    ];

    const graphs = await SchemaGraphModel.find({
      sourceId: {
        $in: sourceIds.map((id) => new Types.ObjectId(id)),
      },
    }).exec();

    /**
     * Resolve:
     *
     * source + database + schema + table
     *
     * -> graph nodeId
     */
    const nodeLookup = new Map<string, string>();

    for (const graph of graphs) {
      for (const node of graph.nodes) {
        if (node.type !== "table") {
          continue;
        }

        if (!node.tableName) {
          continue;
        }

        const key = this.buildTableKey(
          graph.sourceId,
          node.databaseName,
          node.schemaName,
          node.tableName,
        );

        nodeLookup.set(key, node.nodeId);
      }
    }

    const resolved: ResolvedGraphSeed[] = [];

    for (const seed of seeds) {
      const key = this.buildTableKey(
        seed.sourceId,
        seed.databaseName,
        seed.schemaName,
        seed.tableName,
      );

      const nodeId = nodeLookup.get(key);

      /**
       * A semantic result may exist even if the graph has not
       * been generated or is stale.
       *
       * Do not fail the entire retrieval pipeline.
       */
      if (!nodeId) {
        continue;
      }

      resolved.push({
        ...seed,
        nodeId,
      });
    }

    return resolved;
  }

  /**
   * Expand the graph from hybrid retrieval seeds.
   *
   * This is Step 2 of retrieval.
   *
   * Step 1:
   *
   * question
   *   -> vector search
   *   -> keyword search
   *   -> RRF
   *
   * Step 2:
   *
   * top hybrid tables
   *   -> resolve graph node IDs
   *   -> FK traversal
   *   -> structurally related tables
   *
   * IMPORTANT:
   *
   * This method does NOT perform semantic search.
   * This method does NOT perform keyword search.
   */
  async expandFromSeeds(
    databaseName: string,
    seeds: GraphSeed[],
    options: GraphExpansionOptions = {},
  ): Promise<GraphTraversalResult[]> {
    if (seeds.length === 0) {
      return [];
    }

    /**
     * Make sure seeds belong to the database currently being queried.
     */
    const databaseSeeds = seeds.filter(
      (seed) => seed.databaseName === databaseName,
    );

    if (databaseSeeds.length === 0) {
      return [];
    }

    /**
     * Resolve semantic table identities into graph node IDs.
     */
    const resolvedSeeds = await this.resolveSeeds(databaseSeeds);

    if (resolvedSeeds.length === 0) {
      return [];
    }

    const maxDepth = this.resolveMaxDepth(options.maxDepth);
    const limit = this.resolveLimit(options.limit);

    return this.traverse(databaseName, resolvedSeeds, {
      maxDepth,
      limit,
    });
  }

  /**
   * Traverse the schema graph using FK relationships.
   *
   * IMPORTANT:
   *
   * We deliberately DO NOT traverse:
   *
   * contains
   * has_column
   *
   * Those edges describe schema structure but should not be used
   * as SQL table relationship paths.
   *
   * We only traverse:
   *
   * references
   * belongs_to
   *
   * in both directions.
   */
  async traverse(
    databaseName: string,
    seeds: ResolvedGraphSeed[],
    options: GraphTraversalOptions = {},
  ): Promise<GraphTraversalResult[]> {
    const maxDepth = this.resolveMaxDepth(options.maxDepth);
    const limit = this.resolveLimit(options.limit);

    if (seeds.length === 0) {
      return [];
    }

    const graph = await this.findByDatabase(databaseName);

    if (!graph) {
      return [];
    }

    /**
     * ------------------------------------------------------------
     * 1. Build node lookup
     * ------------------------------------------------------------
     */
    const nodeMap = new Map<string, SchemaGraphNode>();

    for (const node of graph.nodes) {
      nodeMap.set(node.nodeId, node);
    }

    /**
     * ------------------------------------------------------------
     * 2. Build table-only FK adjacency map
     * ------------------------------------------------------------
     *
     * Example:
     *
     * film_category -> film
     * film_category -> category
     *
     * becomes:
     *
     * film_category:
     *   film
     *   category
     *
     * film:
     *   film_category
     *
     * category:
     *   film_category
     *
     * This makes traversal bidirectional.
     */
    const adjacency = new Map<string, Set<string>>();

    for (const edge of graph.edges) {
      /**
       * Ignore structural hierarchy edges.
       */
      if (edge.type !== "references" && edge.type !== "belongs_to") {
        continue;
      }

      const fromNode = nodeMap.get(edge.from);
      const toNode = nodeMap.get(edge.to);

      if (!fromNode || !toNode) {
        continue;
      }

      /**
       * Only table -> table relationships participate
       * in SQL table discovery.
       */
      if (fromNode.type !== "table" || toNode.type !== "table") {
        continue;
      }

      const fromNeighbors = adjacency.get(edge.from) ?? new Set<string>();

      fromNeighbors.add(edge.to);

      adjacency.set(edge.from, fromNeighbors);

      const toNeighbors = adjacency.get(edge.to) ?? new Set<string>();

      toNeighbors.add(edge.from);

      adjacency.set(edge.to, toNeighbors);
    }

    /**
     * ------------------------------------------------------------
     * 3. Multi-source BFS
     * ------------------------------------------------------------
     *
     * Multiple hybrid results become multiple BFS seeds.
     *
     * Example:
     *
     * seed 1 = film_category
     * seed 2 = film
     * seed 3 = category
     *
     * They are expanded together.
     */
    const queue: Array<{
      nodeId: string;
      distance: number;
      seedNodeId: string;
      seedHybridRank: number;
      seedHybridScore: number;
    }> = [];

    /**
     * We need to remember the best known state for each node.
     *
     * A node can be reachable from multiple seeds.
     *
     * Example:
     *
     * film_category -> film
     *
     * and
     *
     * film -> film_category
     *
     * We do not want duplicate results.
     */
    const bestDistance = new Map<string, number>();

    const bestSeedRank = new Map<string, number>();

    /**
     * Add hybrid seeds.
     *
     * Sort first so better hybrid seeds are processed first.
     */
    const sortedSeeds = [...seeds].sort((a, b) => a.hybridRank - b.hybridRank);

    for (const seed of sortedSeeds) {
      const node = nodeMap.get(seed.nodeId);

      /**
       * Ignore stale semantic results whose graph node
       * no longer exists.
       */
      if (!node) {
        continue;
      }

      /**
       * We only want table nodes.
       */
      if (node.type !== "table") {
        continue;
      }

      /**
       * Ignore seeds from another database.
       */
      if (node.databaseName !== databaseName) {
        continue;
      }

      const existingDistance = bestDistance.get(seed.nodeId);

      /**
       * If this node is already a seed with a better hybrid rank,
       * do not enqueue it again.
       */
      if (existingDistance !== undefined && existingDistance <= 0) {
        continue;
      }

      bestDistance.set(seed.nodeId, 0);
      bestSeedRank.set(seed.nodeId, seed.hybridRank);

      queue.push({
        nodeId: seed.nodeId,
        distance: 0,
        seedNodeId: seed.nodeId,
        seedHybridRank: seed.hybridRank,
        seedHybridScore: seed.hybridScore,
      });
    }

    /**
     * ------------------------------------------------------------
     * 4. BFS traversal
     * ------------------------------------------------------------
     */
    const discovered = new Map<string, GraphExpansionResult>();

    while (queue.length > 0) {
      /**
       * queue.shift() is fine for the small schema graphs we're
       * dealing with here. If this becomes a very large graph,
       * this can later be changed to an index-based queue.
       */
      const current = queue.shift()!;

      const node = nodeMap.get(current.nodeId);

      if (!node || node.type !== "table") {
        continue;
      }

      /**
       * Check whether this is still the best known distance.
       */
      const knownDistance = bestDistance.get(current.nodeId);

      if (knownDistance !== undefined && current.distance > knownDistance) {
        continue;
      }

      /**
       * Store the discovered table.
       *
       * If multiple seeds reach the same table at the same
       * distance, prefer the better hybrid seed.
       */
      const existing = discovered.get(current.nodeId);

      const graphScore = 1 / (1 + current.distance);

      const candidate: GraphExpansionResult = {
        nodeId: node.nodeId,

        sourceId: graph.sourceId,

        databaseName: node.databaseName,

        ...(node.schemaName !== undefined && {
          schemaName: node.schemaName,
        }),

        ...(node.tableName !== undefined && {
          tableName: node.tableName,
        }),

        seedNodeId: current.seedNodeId,

        distance: current.distance,

        graphScore,

        seedHybridRank: current.seedHybridRank,

        seedHybridScore: current.seedHybridScore,
      };

      if (!existing) {
        discovered.set(current.nodeId, candidate);
      } else {
        const shouldReplace =
          candidate.distance < existing.distance ||
          (candidate.distance === existing.distance &&
            candidate.seedHybridRank < existing.seedHybridRank);

        if (shouldReplace) {
          discovered.set(current.nodeId, candidate);
        }
      }

      /**
       * Do not expand beyond maxDepth.
       */
      if (current.distance >= maxDepth) {
        continue;
      }

      const neighbors = adjacency.get(current.nodeId) ?? new Set<string>();

      for (const neighborId of neighbors) {
        const neighbor = nodeMap.get(neighborId);

        if (!neighbor || neighbor.type !== "table") {
          continue;
        }

        const nextDistance = current.distance + 1;

        const knownNeighborDistance = bestDistance.get(neighborId);

        /**
         * We only enqueue the neighbor if:
         *
         * 1. We have never seen it, OR
         * 2. We found a shorter path.
         */
        if (
          knownNeighborDistance !== undefined &&
          knownNeighborDistance <= nextDistance
        ) {
          continue;
        }

        bestDistance.set(neighborId, nextDistance);

        bestSeedRank.set(neighborId, current.seedHybridRank);

        queue.push({
          nodeId: neighborId,

          distance: nextDistance,

          seedNodeId: current.seedNodeId,

          seedHybridRank: current.seedHybridRank,

          seedHybridScore: current.seedHybridScore,
        });
      }
    }

    /**
     * ------------------------------------------------------------
     * 5. Rank graph results
     * ------------------------------------------------------------
     *
     * Priority:
     *
     * 1. Shorter graph distance
     * 2. Better hybrid seed rank
     * 3. Higher hybrid score
     * 4. Stable node ID
     */
    const ranked = Array.from(discovered.values()).sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }

      if (a.seedHybridRank !== b.seedHybridRank) {
        return a.seedHybridRank - b.seedHybridRank;
      }

      if (a.seedHybridScore !== b.seedHybridScore) {
        return b.seedHybridScore - a.seedHybridScore;
      }

      return a.nodeId.localeCompare(b.nodeId);
    });

    /**
     * ------------------------------------------------------------
     * 6. Convert to final traversal result
     * ------------------------------------------------------------
     */
    return ranked.slice(0, limit).map((result, index) => ({
      ...result,

      graphRank: index + 1,

      /**
       * Graph traversal score is intentionally independent
       * of semantic/vector scores.
       *
       * The hybrid score belongs to Step 1.
       * graphScore belongs to Step 2.
       */
      score: result.graphScore,
    }));
  }

  /**
   * Build a stable identity for a table.
   *
   * This is used to connect semantic retrieval results
   * to graph nodes.
   */
  private buildTableKey(
    sourceId: Types.ObjectId,
    databaseName: string,
    schemaName: string | undefined,
    tableName: string | undefined,
  ): string {
    return [
      sourceId.toString(),
      databaseName,
      schemaName ?? "",
      tableName ?? "",
    ].join(":");
  }

  /**
   * Resolve graph traversal depth.
   */
  private resolveMaxDepth(depth: number | undefined): number {
    if (depth === undefined || !Number.isFinite(depth) || depth < 0) {
      return 2;
    }

    return Math.min(Math.floor(depth), 5);
  }

  /**
   * Resolve graph result limit.
   */
  private resolveLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
      return 20;
    }

    return Math.min(Math.floor(limit), 50);
  }
}
