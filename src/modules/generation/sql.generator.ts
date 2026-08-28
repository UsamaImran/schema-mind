import { gemini, GEMINI_TEXT_MODEL } from "../../config/gemini.js";
import type { SemanticSearchResult } from "../../infrastructure/mongo/repositories/semanticUnit.repository.js";
import type { SqlDialect } from "../schema/schema.types.js";

export class SqlGenerator {
  async generate(
    question: string,
    semanticUnits: SemanticSearchResult[],
    dialect: SqlDialect = "postgresql", // ← NEW
  ): Promise<string> {
    if (semanticUnits.length === 0) {
      throw new Error("No schema context available for SQL generation");
    }

    const schemaContext = semanticUnits
      .map((unit) => unit.content)
      .join("\n\n---\n\n");

    const prompt = `
You are an expert ${dialect} SQL generator.

Generate a SQL query that answers the user's question using ONLY
the database schema provided below.

USER QUESTION:
${question}

DATABASE SCHEMA:
${schemaContext}

RULES:
- Generate ${dialect}-compatible SQL.
- Use only tables and columns present in the schema.
- Use the provided foreign keys to determine relationships.
- Do not invent tables, columns, or relationships.
- Generate only a read-only SELECT query.
- Never generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE,
  TRUNCATE, GRANT, REVOKE, or other modifying statements.
- Do not include explanations.
- Do not use markdown code fences.
- Return ONLY the SQL query.
`;

    const response = await gemini.models.generateContent({
      model: GEMINI_TEXT_MODEL,
      contents: prompt,
    });

    const sql = response.text?.trim();

    if (!sql) {
      throw new Error("Gemini returned an empty SQL query");
    }

    return this.cleanSql(sql);
  }

  private cleanSql(sql: string): string {
    return sql
      .replace(/^```(?:sql)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }
}
