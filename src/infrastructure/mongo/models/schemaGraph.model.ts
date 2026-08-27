import { Schema, model, Types, type HydratedDocument } from "mongoose";

const schemaGraphNodeSchema = new Schema(
  {
    nodeId: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: ["database", "schema", "table", "column"],
      required: true,
    },

    databaseName: {
      type: String,
      required: true,
    },

    schemaName: {
      type: String,
    },

    tableName: {
      type: String,
    },

    columnName: {
      type: String,
    },
  },
  {
    _id: false,
  },
);

const schemaGraphEdgeSchema = new Schema(
  {
    edgeId: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: ["contains", "has_column", "references", "belongs_to"],
      required: true,
    },

    from: {
      type: String,
      required: true,
    },

    to: {
      type: String,
      required: true,
    },

    metadata: {
      columnName: {
        type: String,
      },

      referencedColumn: {
        type: String,
      },
    },
  },
  {
    _id: false,
  },
);

const schemaGraphSchema = new Schema(
  {
    sourceId: {
      type: Schema.Types.ObjectId,
      ref: "SchemaSource",
      required: true,
    },

    databaseName: {
      type: String,
      required: true,
    },

    nodes: {
      type: [schemaGraphNodeSchema],
      required: true,
      default: [],
    },

    edges: {
      type: [schemaGraphEdgeSchema],
      required: true,
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

/*
 * One graph per schema source.
 */
schemaGraphSchema.index(
  {
    sourceId: 1,
  },
  {
    unique: true,
  },
);

/*
 * Used for database-level graph lookup.
 */
schemaGraphSchema.index({
  databaseName: 1,
});

export interface SchemaGraphNode {
  nodeId: string;

  type: "database" | "schema" | "table" | "column";

  databaseName: string;

  schemaName?: string;

  tableName?: string;

  columnName?: string;
}

export interface SchemaGraphEdge {
  edgeId: string;

  type: "contains" | "has_column" | "references" | "belongs_to";

  from: string;

  to: string;

  metadata?: {
    columnName?: string;

    referencedColumn?: string;
  };
}

export interface SchemaGraph {
  _id: Types.ObjectId;

  sourceId: Types.ObjectId;

  databaseName: string;

  nodes: SchemaGraphNode[];

  edges: SchemaGraphEdge[];

  createdAt: Date;

  updatedAt: Date;
}

export type SchemaGraphDocument = HydratedDocument<SchemaGraph>;

export const SchemaGraphModel = model<SchemaGraph>(
  "SchemaGraph",
  schemaGraphSchema,
  "schema_graphs",
);
