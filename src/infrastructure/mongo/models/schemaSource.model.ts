import { Schema, model, Types, type HydratedDocument } from "mongoose";

const schemaSourceSchema = new Schema(
  {
    databaseName: {
      type: String,
      required: true,
    },

    databaseType: {
      type: String,
      enum: ["postgresql", "mysql", "sqlite", "mssql"],
      required: true,
    },

    schemaCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    tableCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },

    schemaFingerprint: {
      type: String,
      default: null,
      index: true,
    },

    lastSyncedAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ["pending", "processing", "ready", "failed"],
      required: true,
      default: "pending",
    },
  },
  {
    timestamps: true,
  },
);

schemaSourceSchema.index(
  {
    databaseName: 1,
    databaseType: 1,
  },
  {
    unique: true,
  },
);

export interface SchemaSource {
  _id: Types.ObjectId;

  databaseName: string;

  databaseType: "postgresql" | "mysql" | "sqlite" | "mssql";

  schemaCount: number;

  tableCount: number;

  schemaFingerprint: string | null;

  lastSyncedAt: Date | null;

  status: "pending" | "processing" | "ready" | "failed";

  createdAt: Date;

  updatedAt: Date;
}

export type SchemaSourceDocument = HydratedDocument<SchemaSource>;

export const SchemaSourceModel = model<SchemaSource>(
  "SchemaSource",
  schemaSourceSchema,
  "schema_sources",
);
