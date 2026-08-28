import type { SqlDialect } from "../schema/schema.types.js";

export interface EvaluationResult {
  passed: boolean;
  overallScore: number;
  checks: {
    structural: CheckResult;
    semantic: CheckResult;
    safety: CheckResult;
  };
  issues: EvaluationIssue[];
  suggestedFix?: string;
  metadata: EvaluationMetadata;
}

export interface CheckResult {
  passed: boolean;
  score: number;
  details: string[];
}

export interface EvaluationIssue {
  severity: "error" | "warning" | "info";
  category: "structural" | "semantic" | "safety";
  message: string;
  suggestion?: string;
}

export interface EvaluationMetadata {
  evaluatedAt: string;
  sqlLength: number;
  estimatedComplexity: "simple" | "moderate" | "complex";
}

export interface EvaluationInput {
  question: string;
  sql: string;
  dialect: SqlDialect;
  schemaContext: string; // joined semantic units
}
