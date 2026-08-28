import type { CheckResult, EvaluationInput } from "./evaluation.types.js";

export class SafetyEvaluator {
  private readonly forbiddenPatterns = [
    /\bDROP\s+/gi,
    /\bDELETE\s+/gi,
    /\bUPDATE\s+/gi,
    /\bINSERT\s+/gi,
    /\bALTER\s+/gi,
    /\bTRUNCATE\s+/gi,
    /\bGRANT\s+/gi,
    /\bREVOKE\s+/gi,
    /;\s*DROP/gi,
    /UNION\s+SELECT/gi,
  ];

  evaluate(input: EvaluationInput): CheckResult {
    const { sql } = input;
    const details: string[] = [];
    let score = 100;

    const sqlUpper = sql.toUpperCase();

    for (const pattern of this.forbiddenPatterns) {
      if (pattern.test(sql)) {
        details.push(`Forbidden pattern: ${pattern.source}`);
        score -= 25;
      }
    }

    if (/\+\s*['"]/.test(sql) || /\|\|\s*['"]/.test(sql)) {
      details.push("String concatenation detected — injection risk");
      score -= 20;
    }

    if (sql.includes("/*") || sql.includes("--")) {
      details.push("Comments detected — possible obfuscation");
      score -= 10;
    }

    return {
      passed: score >= 90 && !details.some((d) => d.startsWith("Forbidden")),
      score: Math.max(0, score),
      details,
    };
  }
}
