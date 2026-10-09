import type { CheckResult, EvaluationInput } from "./evaluation.types.js";

export class SafetyEvaluator {
  private readonly forbiddenPatterns = [
    /\bDROP\s+/i,
    /\bDELETE\s+/i,
    /\bUPDATE\s+/i,
    /\bINSERT\s+/i,
    /\bALTER\s+/i,
    /\bTRUNCATE\s+/i,
    /\bGRANT\s+/i,
    /\bREVOKE\s+/i,
    /\bCREATE\s+/i,
    /\bEXEC(UTE)?\s+/i,
    /\bCALL\s+/i,
    /\bLOCK\s+TABLES?\b/i,
  ];

  evaluate(input: EvaluationInput): CheckResult {
    const { sql } = input;
    const details: string[] = [];
    let score = 100;

    for (const pattern of this.forbiddenPatterns) {
      if (pattern.test(sql)) {
        details.push(`Forbidden modifying pattern detected: ${pattern.source}`);
        score = 0;
      }
    }

    if (sql.includes("/*") || /--(?!\s*$)[\s\S]*$/.test(sql)) {
      details.push("Comments detected in query");
      score -= 10;
    }

    const hasForbidden = details.some((d) => d.startsWith("Forbidden"));

    return {
      passed: !hasForbidden && score >= 80,
      score: Math.max(0, score),
      details,
    };
  }
}
