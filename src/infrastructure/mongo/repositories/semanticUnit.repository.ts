import {
  SemanticUnit,
  SemanticUnitModel,
} from "../models/semanticUnit.model.js";

export type SemanticUnitInput = Omit<
  SemanticUnit,
  "_id" | "createdAt" | "updatedAt"
>;

export interface SemanticSearchResult {
  _id: SemanticUnit["_id"];
  sourceId: SemanticUnit["sourceId"];
  databaseName: SemanticUnit["databaseName"];
  schemaName: SemanticUnit["schemaName"];
  tableName: SemanticUnit["tableName"];
  type: SemanticUnit["type"];
  content: SemanticUnit["content"];
  tokenCount: SemanticUnit["tokenCount"];
  score: number;
}

export class SemanticUnitRepository {
  async upsert(unit: SemanticUnitInput): Promise<void> {
    await SemanticUnitModel.updateOne(
      {
        databaseName: unit.databaseName,
        schemaName: unit.schemaName,
        tableName: unit.tableName,
        type: unit.type,
      },
      {
        $set: unit,
      },
      {
        upsert: true,
      },
    );
  }

  async replaceForSource(
    databaseName: string,
    units: SemanticUnitInput[],
  ): Promise<void> {
    await SemanticUnitModel.deleteMany({
      databaseName,
    });

    if (units.length === 0) {
      return;
    }

    await SemanticUnitModel.insertMany(units);
  }

  async findByTable(
    databaseName: string,
    schemaName: string,
    tableName: string,
  ): Promise<SemanticUnit | null> {
    return SemanticUnitModel.findOne({
      databaseName,
      schemaName,
      tableName,
      type: "table",
    }).lean();
  }

  async deleteByTable(
    databaseName: string,
    schemaName: string,
    tableName: string,
  ): Promise<void> {
    await SemanticUnitModel.deleteOne({
      databaseName,
      schemaName,
      tableName,
      type: "table",
    });
  }

  async deleteByDatabase(databaseName: string): Promise<void> {
    await SemanticUnitModel.deleteMany({
      databaseName,
    });
  }

  async hasCompleteIngestion(
    databaseName: string,
    expectedTableCount: number,
  ): Promise<boolean> {
    const [unitCount, unitsWithoutEmbedding] = await Promise.all([
      SemanticUnitModel.countDocuments({
        databaseName,
        type: "table",
      }),

      SemanticUnitModel.countDocuments({
        databaseName,
        type: "table",
        $or: [
          {
            embedding: {
              $exists: false,
            },
          },
          {
            embedding: {
              $size: 0,
            },
          },
        ],
      }),
    ]);

    return unitCount === expectedTableCount && unitsWithoutEmbedding === 0;
  }

  async vectorSearch(
    databaseName: string,
    queryEmbedding: number[],
    limit: number = 5,
  ): Promise<SemanticSearchResult[]> {
    return SemanticUnitModel.aggregate<SemanticSearchResult>([
      {
        $vectorSearch: {
          index: "semantic_units_vector_index",
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: Math.max(limit * 10, 50),
          limit,
          filter: {
            databaseName,
            type: "table",
          },
        },
      },
      {
        $project: {
          _id: 1,
          sourceId: 1,
          databaseName: 1,
          schemaName: 1,
          tableName: 1,
          type: 1,
          content: 1,
          tokenCount: 1,
          score: {
            $meta: "vectorSearchScore",
          },
        },
      },
    ]);
  }
}
