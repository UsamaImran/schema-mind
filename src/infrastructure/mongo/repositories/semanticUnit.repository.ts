import {
  SemanticUnit,
  SemanticUnitModel,
} from "../models/semanticUnit.model.js";

export type SemanticUnitInput = Omit<
  SemanticUnit,
  "_id" | "createdAt" | "updatedAt"
>;

export class SemanticUnitRepository {
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
}
