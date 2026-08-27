import express, { type Express } from "express";

import schemaRoutes from "./routes/schema.routes.js";

export class App {
  public readonly app: Express;

  constructor() {
    this.app = express();

    this.initializeMiddleware();
    this.initializeRoutes();
  }

  private initializeMiddleware(): void {
    this.app.use(express.json());
  }

  private initializeRoutes(): void {
    this.app.get("/health", (_req, res) => {
      res.status(200).json({
        status: "ok",
        service: "schema-mind",
      });
    });

    this.app.use("/api/schema", schemaRoutes);
  }
}
