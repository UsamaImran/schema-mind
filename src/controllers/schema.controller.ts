import type { Request, Response } from "express";

import { SchemaRetriever } from "../modules/schema/retrieval/schema.retriever.js";
import { SqlGenerator } from "../modules/generation/sql.generator.js";

export class SchemaController {
  constructor(
    private readonly schemaRetriever: SchemaRetriever,
    private readonly sqlGenerator: SqlGenerator,
  ) {}

  retrieve = async (req: Request, res: Response): Promise<void> => {
    try {
      const { question, databaseName } = req.body;

      if (typeof question !== "string" || !question.trim()) {
        res.status(400).json({
          error: "question is required",
        });
        return;
      }

      if (typeof databaseName !== "string" || !databaseName.trim()) {
        res.status(400).json({
          error: "databaseName is required",
        });
        return;
      }

      const results = await this.schemaRetriever.retrieve(
        question,
        databaseName,
      );

      const sql = await this.sqlGenerator.generate(question, results.final);

      res.status(200).json({
        question,
        sql,
        results: results.final,
      });
    } catch (error) {
      console.error("Schema retrieval failed:", error);

      res.status(500).json({
        error: "Schema retrieval failed",
      });
    }
  };
}
