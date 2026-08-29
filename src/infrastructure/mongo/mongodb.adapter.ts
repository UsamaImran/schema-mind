import mongoose from "mongoose";

import { SchemaGraphModel } from "./models/schemaGraph.model.js";
import { SchemaSourceModel } from "./models/schemaSource.model.js";
import { SemanticUnitModel } from "./models/semanticUnit.model.js";
import { env } from "../../config/env.js";

export class MongoAdapter {
  async connect(): Promise<void> {
    const uri = env.MONGO_URI;

    if (!uri) {
      throw new Error("MONGO_URI is not defined");
    }

    try {
      await mongoose.connect(uri);

      console.log("MongoDB connected");

      await this.initialize();

      console.log("MongoDB initialized");
    } catch (error) {
      console.error("MongoDB startup failed:", error);

      await mongoose.disconnect();

      throw error;
    }
  }

  private async initialize(): Promise<void> {
    if (mongoose.connection.readyState !== 1) {
      throw new Error("MongoDB must be connected before initialization");
    }

    /*
     * ==================================================
     * COLLECTIONS
     * ==================================================
     */

    await this.ensureCollection(SchemaSourceModel);
    await this.ensureCollection(SemanticUnitModel);
    await this.ensureCollection(SchemaGraphModel);

    /*
     * ==================================================
     * MONGOOSE INDEXES
     * ==================================================
     */

    await SchemaSourceModel.createIndexes();
    await SemanticUnitModel.createIndexes();
    await SchemaGraphModel.createIndexes();

    /*
     * ==================================================
     * ATLAS SEARCH INDEXES
     * ==================================================
     */

    await this.initializeSemanticSearchIndexes();
    await this.initializeGraphSearchIndexes();
  }

  private async ensureCollection(model: mongoose.Model<any>): Promise<void> {
    const db = mongoose.connection.db;

    if (!db) {
      throw new Error("MongoDB database connection is not available");
    }

    const exists = await db
      .listCollections({
        name: model.collection.name,
      })
      .hasNext();

    if (!exists) {
      await model.createCollection();

      console.log(`MongoDB collection created: ${model.collection.name}`);
    }
  }

  private async initializeSemanticSearchIndexes(): Promise<void> {
    await this.ensureSearchIndex(
      SemanticUnitModel.collection,
      "semantic_units_vector_index",
      "vectorSearch",
      {
        fields: [
          {
            type: "vector",
            path: "embedding",
            numDimensions: 3072,
            similarity: "cosine",
          },
          {
            type: "filter",
            path: "databaseName",
          },
          {
            type: "filter",
            path: "type",
          },
        ],
      },
    );

    await this.ensureSearchIndex(
      SemanticUnitModel.collection,
      "semantic_units_keyword_index",
      "search",
      {
        mappings: {
          dynamic: false,
          fields: {
            content: {
              type: "string",
            },
            tableName: {
              type: "string",
            },
            schemaName: {
              type: "string",
            },
            databaseName: {
              type: "token",
            },
            type: {
              type: "token",
            },
          },
        },
      },
    );
  }

  private async initializeGraphSearchIndexes(): Promise<void> {
    await this.ensureSearchIndex(
      SchemaGraphModel.collection,
      "schema_graph_node_search_index",
      "search",
      {
        mappings: {
          dynamic: false,
          fields: {
            databaseName: {
              type: "token",
            },
            "nodes.type": {
              type: "token",
            },
            "nodes.databaseName": {
              type: "token",
            },
            "nodes.schemaName": {
              type: "string",
            },
            "nodes.tableName": {
              type: "string",
            },
            "nodes.columnName": {
              type: "string",
            },
          },
        },
      },
    );
  }

  private async ensureSearchIndex(
    collection: mongoose.Collection,
    name: string,
    type: "search" | "vectorSearch",
    definition: Record<string, unknown>,
  ): Promise<void> {
    const indexes = await collection.listSearchIndexes().toArray();

    if (indexes.some((index) => index.name === name)) {
      return;
    }

    await collection.createSearchIndex({
      name,
      type,
      definition,
    });

    console.log(`MongoDB search index created: ${name}`);
  }

  async disconnect(): Promise<void> {
    await mongoose.disconnect();

    console.log("MongoDB disconnected");
  }
}
