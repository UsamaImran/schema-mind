import { SqlDialect } from "../../../modules/schema/schema.types.js";
import {
  SchemaSource,
  SchemaSourceModel,
} from "../models/schemaSource.model.js";

export type SchemaSourceInput = {
  databaseName: string;
  databaseType?: SqlDialect;
};

export class SchemaSourceRepository {
  async upsert(source: SchemaSourceInput): Promise<SchemaSource> {
    const databaseType = source.databaseType ?? "postgresql";

    const result = await SchemaSourceModel.findOneAndUpdate(
      {
        databaseName: source.databaseName,
        databaseType,
      },
      {
        $setOnInsert: {
          databaseName: source.databaseName,
          databaseType,
          schemaCount: 0,
          tableCount: 0,

          status: "pending",
        },
      },
      {
        upsert: true,
        new: true,
        lean: true,
      },
    );

    if (!result) {
      throw new Error("Failed to create schema source");
    }

    return result;
  }

  async findByDatabase(
    databaseName: string,
    databaseType: SqlDialect,
  ): Promise<SchemaSource | null> {
    return SchemaSourceModel.findOne({
      databaseName,
      databaseType,
    }).lean();
  }

  async updateStatus(
    databaseName: string,
    status: SchemaSource["status"],
    databaseType: SqlDialect,
  ): Promise<void> {
    await SchemaSourceModel.updateOne(
      {
        databaseName,
        databaseType,
      },
      {
        $set: { status },
      },
    );
  }

  async markSynced(
    databaseName: string,
    tableCount: number,
    schemaCount: number,
    schemaFingerprint: string,
    databaseType: SqlDialect,
  ): Promise<void> {
    await SchemaSourceModel.updateOne(
      {
        databaseName,
        databaseType,
      },
      {
        $set: {
          status: "ready",
          tableCount,
          schemaCount,
          schemaFingerprint,
          lastSyncedAt: new Date(),
        },
      },
    );
  }
}
