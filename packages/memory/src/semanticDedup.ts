/**
 * Semantic Deduplication using Local Embeddings
 *
 * Uses @xenova/transformers to compute embeddings locally and
 * deduplicate semantically similar facts using cosine similarity.
 */

import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import { getLogger } from "@pippa/observability";

// Singleton embedding pipeline (lazy loaded)
let embeddingPipeline: FeatureExtractionPipeline | null = null;
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Get or initialize the embedding pipeline
 * Uses all-MiniLM-L6-v2 - a fast, small model good for semantic similarity
 */
async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (embeddingPipeline) {
    return embeddingPipeline;
  }

  if (pipelinePromise) {
    return pipelinePromise;
  }

  const logger = getLogger().child({ component: "semanticDedup" });
  logger.debug("Initializing embedding pipeline...");

  pipelinePromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    // Use quantized model for faster inference
    quantized: true,
  });

  embeddingPipeline = await pipelinePromise;
  logger.debug("Embedding pipeline initialized");

  return embeddingPipeline;
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Extract embedding vector from pipeline output
 */
function extractEmbedding(output: { data: Float32Array }): number[] {
  return Array.from(output.data);
}

export interface DedupOptions {
  /** Similarity threshold (0-1). Facts above this are considered duplicates. Default: 0.80 */
  threshold?: number;
  /** Maximum facts to return. Default: no limit */
  maxFacts?: number;
}

export interface FactWithEmbedding {
  text: string;
  embedding: number[];
  score?: number; // Original relevance score from Mem0
}

/**
 * Deduplicate facts using semantic similarity
 *
 * Algorithm:
 * 1. Compute embeddings for all facts
 * 2. For each fact, check if it's similar to any already-selected fact
 * 3. If similar (above threshold), skip it
 * 4. If not similar, add it to selected facts
 *
 * This is a greedy approach that preserves the order (first fact wins)
 */
export async function deduplicateFacts(
  facts: string[],
  options: DedupOptions = {},
): Promise<string[]> {
  const logger = getLogger().child({ component: "semanticDedup" });
  const threshold = options.threshold ?? 0.80;
  const maxFacts = options.maxFacts;

  if (facts.length <= 1) {
    return facts;
  }

  try {
    const pipe = await getEmbeddingPipeline();

    // Compute embeddings for all facts
    const embeddings: number[][] = [];
    for (const fact of facts) {
      const output = await pipe(fact, { pooling: "mean", normalize: true });
      embeddings.push(extractEmbedding(output as { data: Float32Array }));
    }

    // Greedy deduplication
    const selected: number[] = [0]; // Always keep first fact

    for (let i = 1; i < facts.length; i++) {
      let isDuplicate = false;

      for (const j of selected) {
        const similarity = cosineSimilarity(embeddings[i], embeddings[j]);
        if (similarity >= threshold) {
          isDuplicate = true;
          logger.trace(
            { fact: facts[i], similarTo: facts[j], similarity },
            "Skipping duplicate fact",
          );
          break;
        }
      }

      if (!isDuplicate) {
        selected.push(i);
        if (maxFacts && selected.length >= maxFacts) {
          break;
        }
      }
    }

    const result = selected.map((i) => facts[i]);
    logger.debug(
      { before: facts.length, after: result.length, threshold },
      "Semantic deduplication complete",
    );

    return result;
  } catch (error) {
    logger.error({ error }, "Semantic deduplication failed, returning original facts");
    return facts;
  }
}

/**
 * Deduplicate facts with scores, preferring higher-scored facts
 *
 * When duplicates are found, keeps the one with the higher score
 */
export async function deduplicateFactsWithScores(
  factsWithScores: Array<{ text: string; score: number }>,
  options: DedupOptions = {},
): Promise<Array<{ text: string; score: number }>> {
  const logger = getLogger().child({ component: "semanticDedup" });
  const threshold = options.threshold ?? 0.80;
  const maxFacts = options.maxFacts;

  if (factsWithScores.length <= 1) {
    return factsWithScores;
  }

  try {
    const pipe = await getEmbeddingPipeline();

    // Compute embeddings for all facts
    const items: Array<{ text: string; score: number; embedding: number[] }> = [];
    for (const fact of factsWithScores) {
      const output = await pipe(fact.text, { pooling: "mean", normalize: true });
      items.push({
        text: fact.text,
        score: fact.score,
        embedding: extractEmbedding(output as { data: Float32Array }),
      });
    }

    // Sort by score descending (higher scores first)
    items.sort((a, b) => b.score - a.score);

    // Greedy deduplication - higher scored facts win
    const selected: typeof items = [items[0]];

    for (let i = 1; i < items.length; i++) {
      let isDuplicate = false;

      for (const existing of selected) {
        const similarity = cosineSimilarity(items[i].embedding, existing.embedding);
        if (similarity >= threshold) {
          isDuplicate = true;
          logger.trace(
            { fact: items[i].text, similarTo: existing.text, similarity },
            "Skipping duplicate fact (lower score)",
          );
          break;
        }
      }

      if (!isDuplicate) {
        selected.push(items[i]);
        if (maxFacts && selected.length >= maxFacts) {
          break;
        }
      }
    }

    const result = selected.map(({ text, score }) => ({ text, score }));
    logger.debug(
      { before: factsWithScores.length, after: result.length, threshold },
      "Semantic deduplication with scores complete",
    );

    return result;
  } catch (error) {
    logger.error({ error }, "Semantic deduplication failed, returning original facts");
    return factsWithScores;
  }
}
