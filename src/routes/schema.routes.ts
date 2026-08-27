import { Router } from "express";

import { EmbeddingService } from "../infrastructure/embeddings/embedding.service.js";
import { SemanticUnitRepository } from "../infrastructure/mongo/repositories/semanticUnit.repository.js";
import { SchemaRetriever } from "../modules/schema/retrieval/schema.retriever.js";
import { SchemaController } from "../controllers/schema.controller.js";
import { SqlGenerator } from "../modules/generation/sql.generator.js";

const router = Router();

const embeddingService = new EmbeddingService();

const semanticUnitRepository = new SemanticUnitRepository();

const schemaRetriever = new SchemaRetriever(
  embeddingService,
  semanticUnitRepository,
);

const sqlGenerator = new SqlGenerator();

const schemaController = new SchemaController(schemaRetriever, sqlGenerator);

router.post("/retrieve", schemaController.retrieve);

export default router;
