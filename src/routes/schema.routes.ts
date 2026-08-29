import { Router } from "express";
import { EmbeddingService } from "../infrastructure/embeddings/embedding.service.js";
import { SemanticUnitRepository } from "../infrastructure/mongo/repositories/semanticUnit.repository.js";
import { SchemaRetriever } from "../modules/schema/retrieval/schema.retriever.js";
import { SchemaController } from "../controllers/schema.controller.js";
import { SqlGenerator } from "../modules/generation/sql.generator.js";
import { SchemaGraphRepository } from "../infrastructure/mongo/repositories/schemaGraph.repository.js";
import { ExecutorFactory } from "../modules/execution/executor.factory.js";

export default function createSchemaRoutes(executorFactory?: ExecutorFactory) {
  const router = Router();

  const embeddingService = new EmbeddingService();
  const semanticUnitRepository = new SemanticUnitRepository();
  const schemaGraphRepository = new SchemaGraphRepository();

  const schemaRetriever = new SchemaRetriever(
    embeddingService,
    semanticUnitRepository,
    schemaGraphRepository,
  );

  const sqlGenerator = new SqlGenerator();

  const schemaController = new SchemaController(
    schemaRetriever,
    sqlGenerator,
    executorFactory ?? new ExecutorFactory(),
  );

  router.post("/retrieve", schemaController.retrieve);

  return router;
}
