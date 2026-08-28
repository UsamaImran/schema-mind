import { Schema, model, Types, type HydratedDocument } from "mongoose";
import { SqlDialect } from "../../../modules/schema/schema.types.js";

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
    dialect: {
      type: String,
      enum: ["postgresql", "mysql", "sqlite", "mssql"],
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

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

export interface SemanticUnit {
  _id: Types.ObjectId;

  sourceId: Types.ObjectId;

  databaseName: string;

  schemaName: string;

  tableName: string;

  type: "table";

  content: string;

  tokenCount: number;

  embedding: number[];

  createdAt: Date;

  updatedAt: Date;
  dialect: SqlDialect;
}

export type SemanticUnitDocument = HydratedDocument<SemanticUnit>;

export const SemanticUnitModel = model<SemanticUnit>(
  "SemanticUnit",
  semanticUnitSchema,
  "semantic_units",
);
