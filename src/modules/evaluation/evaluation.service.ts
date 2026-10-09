import type {
  EvaluationInput,
  EvaluationResult,
  EvaluationIssue,
} from "./evaluation.types.js";
import { StructuralEvaluator } from "./structural.evaluator.js";
import { SemanticEvaluator } from "./semantic.evaluator.js";
import { SafetyEvaluator } from "./safety.evaluator.js";

export class EvaluationService {
  private structural = new StructuralEvaluator();
  private semantic = new SemanticEvaluator();
  private safety = new SafetyEvaluator();

  async evaluate(input: EvaluationInput): Promise<EvaluationResult> {
    const start = Date.now();

    const [structural, safety] = await Promise.all([
      this.structural.evaluate(input),
      this.safety.evaluate(input),
    ]);

    const shouldRunSemantic = Boolean(
      input.deepEvaluation ?? process.env.ENABLE_SEMANTIC_EVALUATION === "true",
    );

    let semantic: { passed: boolean; score: number; details: string[] };

    if (!shouldRunSemantic) {
      semantic = {
        passed: true,
        score: 100,
        details: ["Bypassed (Fast path: Structural + Safety guardrails active)"],
      };
    } else if (structural.passed) {
      semantic = await this.semantic.evaluate(input);
    } else {
      semantic = {
        passed: false,
        score: 0,
        details: ["Skipped — structural validation failed"],
      };
    }

    const issues: EvaluationIssue[] = [
      ...this.toIssues(structural, "structural"),
      ...this.toIssues(semantic, "semantic"),
      ...this.toIssues(safety, "safety"),
    ];

    const overallScore = shouldRunSemantic
      ? Math.round(
          structural.score * 0.3 + semantic.score * 0.5 + safety.score * 0.2,
        )
      : Math.round(structural.score * 0.6 + safety.score * 0.4);

    const passed =
      structural.passed &&
      safety.passed &&
      (!shouldRunSemantic || semantic.passed);

    return {
      passed,
      overallScore,
      checks: { structural, semantic, safety },
      issues,
      metadata: {
        evaluatedAt: new Date().toISOString(),
        sqlLength: input.sql.length,
        estimatedComplexity: this.estimateComplexity(input.sql),
      },
    };
  }

  private toIssues(
    check: { passed: boolean; details: string[] },
    category: string,
  ): EvaluationIssue[] {
    return check.details.map((d) => ({
      severity: check.passed ? "warning" : "error",
      category: category as any,
      message: d,
    }));
  }

  private estimateComplexity(sql: string): "simple" | "moderate" | "complex" {
    const lower = sql.toLowerCase();
    let score = 0;
    if (lower.includes("join")) score++;
    if (lower.includes("group by")) score++;
    if ((lower.match(/select/g) || []).length > 1) score++;
    if (lower.includes("union")) score++;
    if (lower.includes("window") || lower.includes("over(")) score++;
    return score <= 1 ? "simple" : score <= 3 ? "moderate" : "complex";
  }
}
