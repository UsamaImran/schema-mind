import express, { type Express } from "express";
import type { ExecutorFactory } from "./modules/execution/executor.factory.js";
import schemaRoutes from "./routes/schema.routes.js";

export class App {
  public readonly app: Express;

  constructor(executorFactory?: ExecutorFactory) {
    this.app = express();
    this.initializeMiddleware();
    this.initializeRoutes(executorFactory);
  }

  private initializeMiddleware(): void {
    this.app.use(express.json());
  }

  private initializeRoutes(executorFactory?: ExecutorFactory): void {
    this.app.get("/health", (_req, res) => {
      res.status(200).json({ status: "ok", service: "schema-mind" });
    });

    // Pass factory into routes if provided
    this.app.use("/api/schema", schemaRoutes(executorFactory));
  }
}
