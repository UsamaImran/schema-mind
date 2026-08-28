import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().positive().default(3000),

  // PostgreSQL
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PORT: z.coerce.number().int().positive(),
  POSTGRES_DATABASE: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string(),

  // MongoDB
  MONGO_HOST: z.string().min(1),
  MONGO_PORT: z.coerce.number().int().positive(),
  MONGO_ROOT_USERNAME: z.string().min(1),
  MONGO_ROOT_PASSWORD: z.string().min(1),
  MONGO_DATABASE: z.string().min(1),

  GEMINI_API_KEY: z.string().min(1),

  EXECUTOR_MAX_ROWS: z.coerce.number().int().positive().default(100),
  EVALUATION_THRESHOLD: z.coerce.number().int().min(0).max(100).default(70),
});

export const env = envSchema.parse(process.env);
