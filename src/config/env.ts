import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_DIALECT: z
    .enum(["postgresql", "mysql", "sqlite", "mssql"])
    .default("postgresql"),

  // Generic SQL database connection (source DB for schema introspection)
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive(),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),

  MONGO_URI: z.string().min(1),

  GEMINI_API_KEY: z.string().min(1),

  EXECUTOR_MAX_ROWS: z.coerce.number().int().positive().default(100),
  EVALUATION_THRESHOLD: z.coerce.number().int().min(0).max(100).default(70),
});

export const env = envSchema.parse(process.env);
