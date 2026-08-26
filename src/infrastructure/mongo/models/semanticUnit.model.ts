import { Schema, model, type InferSchemaType } from "mongoose";

const semanticUnitSchema = new Schema(
  {
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: "SchemaSource",
      required: true,
      index: true,
    },

    databaseName: {
      type: String,
      required: true,
      index: true,
    },

    schemaName: {
      type: String,
      required: true,
    },

    tableName: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: ["table"],
      required: true,
    },

    content: {
      type: String,
      required: true,
    },

    tokenCount: {
      type: Number,
      required: true,
      min: 0,
    },

    embedding: {
      type: [Number],
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Prevent duplicate semantic units for the same table.
 */
semanticUnitSchema.index(
  {
    sourceId: 1,
    schemaName: 1,
    tableName: 1,
    type: 1,
  },
  {
    unique: true,
  },
);

export type SemanticUnit = InferSchemaType<typeof semanticUnitSchema>;

export const SemanticUnitModel = model(
  "SemanticUnit",
  semanticUnitSchema,
  "semantic_units",
);

/**
 * MongoDB Vector Search Index
 */
export async function ensureSemanticUnitVectorIndex(): Promise<void> {
  const indexName = "semantic_units_vector_index";

  const existingIndexes = await SemanticUnitModel.collection
    .listSearchIndexes()
    .toArray();

  const exists = existingIndexes.some((index) => index.name === indexName);

  if (exists) {
    return;
  }

  await SemanticUnitModel.collection.createSearchIndex({
    name: indexName,
    type: "vectorSearch",
    definition: {
      fields: [
        {
          type: "vector",
          path: "embedding",
          numDimensions: 3072,
          similarity: "cosine",
        },
      ],
    },
  });

  console.log(`Created MongoDB vector index: ${indexName}`);
}
