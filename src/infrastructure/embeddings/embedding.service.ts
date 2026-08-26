import { GEMINI_EMBEDDING_MODEL, gemini } from "../../config/gemini.js";

export class EmbeddingService {
  private readonly model = GEMINI_EMBEDDING_MODEL;

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const result = await gemini.models.embedContent({
      model: this.model,
      contents: texts,
      config: {
        taskType: "RETRIEVAL_DOCUMENT",
      },
    });

    const embeddings = result.embeddings;

    if (!embeddings || embeddings.length !== texts.length) {
      throw new Error(
        `Embedding count mismatch: expected ${texts.length}, got ${
          embeddings?.length ?? 0
        }`,
      );
    }

    const vectors = embeddings.map((embedding, index) => {
      const values = embedding.values;

      if (!values?.length) {
        throw new Error(
          `Empty embedding returned for document at index ${index}`,
        );
      }

      return values;
    });

    return vectors;
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
