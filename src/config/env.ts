import "dotenv/config";
import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    PORT: z.coerce.number().int().positive().default(3000),

    // Database dialect selection
    DATABASE_DIALECT: z
      .enum(["postgresql", "mysql", "sqlite", "mssql"])
      .default("postgresql"),

    // PostgreSQL
    POSTGRES_HOST: z.string().min(1),
    POSTGRES_PORT: z.coerce.number().int().positive(),
    POSTGRES_DATABASE: z.string().min(1),
    POSTGRES_USER: z.string().min(1),
    POSTGRES_PASSWORD: z.string(),

    // MySQL
    MYSQL_HOST: z.string().min(1),
    MYSQL_PORT: z.coerce.number().int().positive(),
    MYSQL_DATABASE: z.string().min(1),
    MYSQL_USER: z.string().min(1),
    MYSQL_PASSWORD: z.string(),

    // MongoDB
    MONGO_HOST: z.string().min(1),
    MONGO_PORT: z.coerce.number().int().positive(),
    MONGO_ROOT_USERNAME: z.string().min(1),
    MONGO_ROOT_PASSWORD: z.string().min(1),
    MONGO_DATABASE: z.string().min(1),

    GEMINI_API_KEY: z.string().min(1),

    EXECUTOR_MAX_ROWS: z.coerce.number().int().positive().default(100),
    EVALUATION_THRESHOLD: z.coerce.number().int().min(0).max(100).default(70),
  })
  .refine(
    (data) => {
      if (data.DATABASE_DIALECT === "postgresql") {
        return (
          data.POSTGRES_HOST &&
          data.POSTGRES_PORT &&
          data.POSTGRES_DATABASE &&
          data.POSTGRES_USER !== undefined
        );
      }
      if (data.DATABASE_DIALECT === "mysql") {
        return (
          data.MYSQL_HOST &&
          data.MYSQL_PORT &&
          data.MYSQL_DATABASE &&
          data.MYSQL_USER !== undefined
        );
      }
      return true;
    },
    {
      message:
        "PostgreSQL or MySQL connection variables must be provided based on DATABASE_DIALECT",
    },
  );

export const env = envSchema.parse(process.env);
