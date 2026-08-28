import { Parser } from "node-sql-parser";
import type { CheckResult, EvaluationInput } from "./evaluation.types.js";

export class StructuralEvaluator {
  private parser = new Parser();

  evaluate(input: EvaluationInput): CheckResult {
    const { sql, dialect, schemaContext } = input;
    const details: string[] = [];
    let score = 100;

    try {
      const ast = this.parser.astify(sql, {
        database: this.mapDialect(dialect),
      });

      const statements = Array.isArray(ast) ? ast : [ast];

      for (const stmt of statements) {
        if (stmt.type !== "select") {
          details.push(`Non-SELECT statement detected: ${stmt.type}`);
          score -= 50;
        }
      }

      const referencedTables = this.extractTables(ast);
      const validTables = this.extractValidTables(schemaContext);

      for (const table of referencedTables) {
        if (!validTables.has(table.toLowerCase())) {
          details.push(`Table '${table}' not in retrieved schema context`);
          score -= 15;
        }
      }

      if (
        sql.includes(";") &&
        sql.split(";").filter((s) => s.trim()).length > 1
      ) {
        details.push("Multiple statements detected");
        score -= 20;
      }
    } catch (err: any) {
      details.push(`Syntax error: ${err.message}`);
      score = 0;
    }

    return {
      passed: score >= 80,
      score: Math.max(0, score),
      details,
    };
  }

  private mapDialect(dialect: string): string {
    const map: Record<string, string> = {
      postgresql: "postgresql",
      mysql: "mysql",
      sqlite: "sqlite",
      mssql: "transactsql",
    };
    return map[dialect] || "postgresql";
  }

  private extractTables(ast: any): string[] {
    const tables: string[] = [];
    const walk = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (node.table) tables.push(node.table);
      if (node.from) {
        const sources = Array.isArray(node.from) ? node.from : [node.from];
        for (const src of sources) walk(src);
      }
      for (const key of Object.keys(node)) walk(node[key]);
    };
    walk(ast);
    return [...new Set(tables)];
  }

  private extractValidTables(schemaContext: string): Set<string> {
    const tables = new Set<string>();
    const regex = /Table:\s*(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(schemaContext)) !== null) {
      if (!!match[1]) tables.add(match[1].toLowerCase());
    }
    return tables;
  }
}
