import { Types } from "mongoose";

import {
  SchemaGraphModel,
  type SchemaGraph,
  type SchemaGraphDocument,
  type SchemaGraphNode,
} from "../models/schemaGraph.model.js";

export interface SchemaGraphInput {
  sourceId: Types.ObjectId;
  databaseName: string;
  nodes: SchemaGraph["nodes"];
  edges: SchemaGraph["edges"];
}

export interface GraphSearchResult {
  nodeId: string;
  databaseName: string;
  schemaName?: string;
  tableName?: string;
  columnName?: string;

  graphRank: number;
  score: number;
}

export interface GraphTraversalResult extends GraphSearchResult {
  distance: number;
}

export interface GraphSearchOptions {
  limit?: number;
}

export interface GraphTraversalOptions {
  maxDepth?: number;
  limit?: number;
}

export class SchemaGraphRepository {
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

  async findByDatabase(
    databaseName: string,
  ): Promise<SchemaGraphDocument | null> {
    return SchemaGraphModel.findOne({
      databaseName,
    }).exec();
  }

  async findBySourceId(
    sourceId: Types.ObjectId,
  ): Promise<SchemaGraphDocument | null> {
    return SchemaGraphModel.findOne({
      sourceId,
    }).exec();
  }

  async existsForSource(sourceId: Types.ObjectId): Promise<boolean> {
    const result = await SchemaGraphModel.exists({
      sourceId,
    });

    return result !== null;
  }

  async deleteForSource(sourceId: Types.ObjectId): Promise<void> {
    await SchemaGraphModel.deleteOne({
      sourceId,
    }).exec();
  }

  /**
   * Search graph nodes using MongoDB Atlas Search.
   *
   * This is the graph retrieval step.
   *
   * We do NOT load the entire graph here.
   *
   * MongoDB identifies the nodes that are relevant to the
   * natural-language question.
   */
  async keywordSearch(
    databaseName: string,
    query: string,
    options: GraphSearchOptions = {},
  ): Promise<GraphSearchResult[]> {
    const limit = this.resolveLimit(options.limit);

    const pipeline: any = [
      {
        $search: {
          index: "schema_graph_node_search_index",

          compound: {
            filter: [
              {
                text: {
                  query: databaseName,
                  path: "databaseName",
                },
              },
            ],

            should: [
              {
                text: {
                  query,
                  path: "nodes.schemaName",
                },
              },

              {
                text: {
                  query,
                  path: "nodes.tableName",
                },
              },

              {
                text: {
                  query,
                  path: "nodes.columnName",
                },
              },
            ],

            minimumShouldMatch: 1,
          },
        },
      },

      {
        $unwind: "$nodes",
      },

      {
        $project: {
          _id: 0,

          node: "$nodes",

          score: {
            $meta: "searchScore",
          },
        },
      },

      {
        $match: {
          "node.type": "table",
        },
      },

      {
        $sort: {
          score: -1,
        },
      },

      {
        $limit: limit,
      },
    ];

    const results = await SchemaGraphModel.aggregate(pipeline).exec();

    return results.map(
      (
        result: {
          node: SchemaGraphNode;
          score: number;
        },
        index: number,
      ) => ({
        nodeId: result.node.nodeId,
        databaseName: result.node.databaseName,
        ...(result.node.schemaName !== undefined && {
          schemaName: result.node.schemaName,
        }),
        ...(result.node.tableName !== undefined && {
          tableName: result.node.tableName,
        }),
        ...(result.node.columnName !== undefined && {
          columnName: result.node.columnName,
        }),
        graphRank: index + 1,
        score: result.score,
      }),
    );
  }

  /**
   * Traverse the graph from previously retrieved seed nodes.
   *
   * MongoDB is used to retrieve the graph document.
   * The actual traversal happens in memory.
   *
   * This should happen AFTER graph retrieval.
   */
  async traverse(
    databaseName: string,
    seedNodeIds: string[],
    options: GraphTraversalOptions = {},
  ): Promise<GraphTraversalResult[]> {
    const maxDepth = this.resolveMaxDepth(options.maxDepth);
    const limit = this.resolveLimit(options.limit);

    if (seedNodeIds.length === 0) {
      return [];
    }

    const graph = await this.findByDatabase(databaseName);

    if (!graph) {
      return [];
    }

    const nodeMap = new Map<string, SchemaGraphNode>(
      graph.nodes.map((node) => [node.nodeId, node]),
    );

    /**
     * Build adjacency map from graph edges.
     *
     * Foreign-key relationships are traversed in both
     * directions because a question may start from either
     * side of the relationship.
     */
    const adjacency = new Map<string, string[]>();

    for (const edge of graph.edges) {
      const fromNeighbors = adjacency.get(edge.from) ?? [];
      fromNeighbors.push(edge.to);
      adjacency.set(edge.from, fromNeighbors);

      const toNeighbors = adjacency.get(edge.to) ?? [];
      toNeighbors.push(edge.from);
      adjacency.set(edge.to, toNeighbors);
    }

    /**
     * Multi-source BFS.
     */
    const queue: Array<{
      nodeId: string;
      distance: number;
    }> = [];

    const visited = new Set<string>();

    for (const seedNodeId of seedNodeIds) {
      if (!nodeMap.has(seedNodeId)) {
        continue;
      }

      if (visited.has(seedNodeId)) {
        continue;
      }

      visited.add(seedNodeId);

      queue.push({
        nodeId: seedNodeId,
        distance: 0,
      });
    }

    const discovered: Array<{
      node: SchemaGraphNode;
      distance: number;
    }> = [];

    while (queue.length > 0) {
      const current = queue.shift()!;

      const node = nodeMap.get(current.nodeId);

      if (!node) {
        continue;
      }

      /**
       * Only tables are useful as SQL-generation context.
       */
      if (node.type === "table") {
        discovered.push({
          node,
          distance: current.distance,
        });
      }

      if (current.distance >= maxDepth) {
        continue;
      }

      const neighbors = adjacency.get(current.nodeId) ?? [];

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) {
          continue;
        }

        visited.add(neighborId);

        queue.push({
          nodeId: neighborId,
          distance: current.distance + 1,
        });
      }
    }

    /**
     * Closest nodes first.
     *
     * At this stage graph distance is the traversal ranking
     * signal, not MongoDB search score.
     */
    discovered.sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }

      return a.node.nodeId.localeCompare(b.node.nodeId);
    });

    return discovered.slice(0, limit).map((result, index) => ({
      nodeId: result.node.nodeId,
      databaseName: result.node.databaseName,

      ...(result.node.schemaName !== undefined && {
        schemaName: result.node.schemaName,
      }),

      ...(result.node.tableName !== undefined && {
        tableName: result.node.tableName,
      }),

      ...(result.node.columnName !== undefined && {
        columnName: result.node.columnName,
      }),

      graphRank: index + 1,

      /**
       * Traversal does not have a semantic search score.
       *
       * Distance is the actual graph relevance signal.
       */
      score: 1 / (1 + result.distance),

      distance: result.distance,
    }));
  }

  private resolveMaxDepth(depth: number | undefined): number {
    if (depth === undefined || !Number.isFinite(depth) || depth < 0) {
      return 2;
    }

    return Math.min(Math.floor(depth), 5);
  }

  private resolveLimit(limit: number | undefined): number {
    if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
      return 20;
    }

    return Math.min(Math.floor(limit), 50);
  }
}
