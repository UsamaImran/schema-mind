import type { Request, Response } from "express";
import type { SchemaRetriever } from "../modules/schema/retrieval/schema.retriever.js";
import type { SqlGenerator } from "../modules/generation/sql.generator.js";
import { EvaluationService } from "../modules/evaluation/evaluation.service.js";
import { ExecutorFactory } from "../modules/execution/executor.factory.js";
import { SqlDialect } from "../modules/schema/schema.types.js";

export class SchemaController {
  private readonly evaluator = new EvaluationService();

  constructor(
    private readonly schemaRetriever: SchemaRetriever,
    private readonly sqlGenerator: SqlGenerator,
    private readonly executorFactory: ExecutorFactory,
  ) {}

  retrieve = async (req: Request, res: Response): Promise<void> => {
    try {
      const { question, databaseName } = req.body;

      if (typeof question !== "string" || !question.trim()) {
        res.status(400).json({ error: "question is required" });
        return;
      }

      if (typeof databaseName !== "string" || !databaseName.trim()) {
        res.status(400).json({ error: "databaseName is required" });
        return;
      }

      const results = await this.schemaRetriever.retrieve(
        question,
        databaseName,
      );

      // Get dialect from first semantic unit or default
      const dialect: SqlDialect = results.final[0]?.dialect || "postgresql";

      const sql = await this.sqlGenerator.generate(
        question,
        results.final,
        dialect,
      );

      // ─── EVALUATION LAYER ───
      const evaluation = await this.evaluator.evaluate({
        question,
        sql,
        dialect,
        schemaContext: results.final.map((u) => u.content).join("\n\n---\n\n"),
      });

      if (!evaluation.passed) {
        res.status(400).json({
          success: false,
          question,
          sql,
          evaluation,
          results: null,
        });
        return;
      }

      // ─── EXECUTION LAYER ───
      const executor = this.executorFactory.getExecutor(databaseName, dialect);
      const executionResult = await executor.execute(sql, {
        maxRows: 100,
        readOnly: true,
        timeoutMs: 10000,
      });

      res.status(200).json({
        success: true,
        question,
        sql,
        evaluation: {
          passed: true,
          score: evaluation.overallScore,
        },
        execution: executionResult,
      });
    } catch (error) {
      console.error("Schema retrieval failed:", error);
      res.status(500).json({ error: "Schema retrieval failed" });
    }
  };
}
