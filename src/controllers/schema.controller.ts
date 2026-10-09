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
      const { question, databaseName, deepEvaluation } = req.body;

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
      const schemaContext = results.final
        .map((u) => u.content)
        .join("\n\n---\n\n");

      let sql = await this.sqlGenerator.generate(
        question,
        results.final,
        dialect,
      );

      let evaluation = await this.evaluator.evaluate({
        question,
        sql,
        dialect,
        schemaContext,
        deepEvaluation: Boolean(deepEvaluation),
      });

      let selfHealed = false;
      const executor = this.executorFactory.getExecutor(databaseName, dialect);
      const executeOptions = {
        maxRows: 100,
        readOnly: true,
        timeoutMs: 10000,
      };

      // ─── SELF-CORRECTION ON EVALUATION FAILURE (1 attempt) ───
      if (!evaluation.passed) {
        const errorDetails = evaluation.issues
          .map((i) => `${i.category}: ${i.message}`)
          .join("; ");

        try {
          const fixedSql = await this.sqlGenerator.fix(
            question,
            sql,
            errorDetails,
            results.final,
            dialect,
          );

          const fixedEvaluation = await this.evaluator.evaluate({
            question,
            sql: fixedSql,
            dialect,
            schemaContext,
            deepEvaluation: Boolean(deepEvaluation),
          });

          if (fixedEvaluation.passed) {
            sql = fixedSql;
            evaluation = fixedEvaluation;
            selfHealed = true;
          }
        } catch (healError) {
          console.warn("Self-correction on evaluation failure failed:", healError);
        }
      }

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

      // ─── EXECUTION LAYER WITH SELF-HEALING ───
      let executionResult;

      try {
        executionResult = await executor.execute(sql, executeOptions);
      } catch (execError: any) {
        // Attempt automated recovery from database execution error
        try {
          const fixedSql = await this.sqlGenerator.fix(
            question,
            sql,
            `Database Execution Error: ${execError.message || String(execError)}`,
            results.final,
            dialect,
          );

          const fixedEvaluation = await this.evaluator.evaluate({
            question,
            sql: fixedSql,
            dialect,
            schemaContext,
            deepEvaluation: Boolean(deepEvaluation),
          });

          if (fixedEvaluation.passed) {
            executionResult = await executor.execute(fixedSql, executeOptions);
            sql = fixedSql;
            evaluation = fixedEvaluation;
            selfHealed = true;
          } else {
            throw execError;
          }
        } catch {
          res.status(400).json({
            success: false,
            question,
            sql,
            error: `Execution failed: ${execError.message || String(execError)}`,
            results: null,
          });
          return;
        }
      }

      res.status(200).json({
        success: true,
        question,
        sql,
        selfHealed,
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
