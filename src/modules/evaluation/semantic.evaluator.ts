import { gemini, GEMINI_TEXT_MODEL } from "../../config/gemini.js";
import type { CheckResult, EvaluationInput } from "./evaluation.types.js";

export class SemanticEvaluator {
  async evaluate(input: EvaluationInput): Promise<CheckResult> {
    const { question, sql, dialect, schemaContext } = input;

    const prompt = `
You are a SQL quality evaluator. Assess whether the generated SQL correctly answers the user's question.

DATABASE DIALECT: ${dialect}
USER QUESTION: "${question}"
GENERATED SQL:
${sql}

AVAILABLE SCHEMA:
${schemaContext}

Evaluate these criteria (score 1-5 each):
1. INTENT_MATCH — Does the SQL answer what the user asked?
2. TABLE_SELECTION — Are the right tables used?
3. JOIN_LOGIC — Are JOINs correct for the relationships?
4. AGGREGATION — Is GROUP BY / COUNT / SUM used correctly?
5. FILTERING — Is WHERE appropriate?
6. SORTING_LIMIT — Is ORDER BY and LIMIT correct?

Respond ONLY with JSON:
{
  "score": number (0-100),
  "passed": boolean (score >= 75),
  "reasoning": string,
  "issues": [{"severity": "error|warning", "message": string}]
}
`;

    const response = await gemini.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: prompt,
      config: { responseMimeType: "application/json" },
    });

    const result = JSON.parse(response.text || "{}");

    return {
      passed: result.passed ?? false,
      score: result.score ?? 0,
      details: [
        result.reasoning || "No reasoning provided",
        ...(result.issues || []).map((i: any) => `${i.severity}: ${i.message}`),
      ],
    };
  }
}
