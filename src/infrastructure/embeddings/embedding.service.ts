import { GEMINI_EMBEDDING_MODEL, gemini } from "../../config/gemini.js";

export class EmbeddingService {
  private static readonly BATCH_SIZE = 50;
  private readonly model = GEMINI_EMBEDDING_MODEL;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += EmbeddingService.BATCH_SIZE) {
      const chunk = texts.slice(i, i + EmbeddingService.BATCH_SIZE);

      const result = await gemini.models.embedContent({
        model: this.model,
        contents: chunk,
        config: {
          taskType: "RETRIEVAL_DOCUMENT",
        },
      });

      const embeddings = result.embeddings;

      if (!embeddings || embeddings.length !== chunk.length) {
        throw new Error(
          `Embedding count mismatch: expected ${chunk.length}, got ${
            embeddings?.length ?? 0
          }`,
        );
      }

      for (let j = 0; j < embeddings.length; j++) {
        const values = embeddings[j]?.values;
        if (!values?.length) {
          throw new Error(
            `Empty embedding returned for document at index ${i + j}`,
          );
        }
        allVectors.push(values);
      }
    }

    return allVectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    if (!text.trim()) {
      throw new Error("Cannot generate embedding for empty query");
    }

    const result = await gemini.models.embedContent({
      model: this.model,
      contents: text,
      config: {
        taskType: "RETRIEVAL_QUERY",
      },
    });

    const embedding = result.embeddings?.[0]?.values;

    if (!embedding?.length) {
      throw new Error("Failed to generate query embedding");
    }

    return embedding;
  }
}
