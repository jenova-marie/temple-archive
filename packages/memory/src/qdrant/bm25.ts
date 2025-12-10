/**
 * BM25 Sparse Vector Generator
 *
 * Lightweight local implementation for hybrid search.
 * Generates sparse vectors from text using BM25-style term weighting.
 *
 * Resource usage: <1ms per query, ~50MB memory (just tokenization, no ML)
 */

// Common English stop words to filter out
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'were', 'will', 'with', 'the', 'this', 'but', 'they',
  'have', 'had', 'what', 'when', 'where', 'who', 'which', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 'just', 'can', 'could', 'should', 'would', 'may', 'might', 'must',
  'shall', 'will', 'do', 'does', 'did', 'doing', 'done', 'been', 'being',
  'am', 'is', 'are', 'was', 'were', 'be', 'have', 'has', 'had', 'having',
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she',
  'her', 'hers', 'herself', 'it', 'its', 'itself', 'them', 'their', 'theirs',
])

// Simple hash function to convert terms to indices
// Uses FNV-1a hash for good distribution
function hashTerm(term: string): number {
  let hash = 2166136261 // FNV offset basis
  for (let i = 0; i < term.length; i++) {
    hash ^= term.charCodeAt(i)
    hash = (hash * 16777619) >>> 0 // FNV prime, keep as 32-bit
  }
  // Map to a reasonable index range (0 to 30000)
  // This matches typical sparse vector vocabulary sizes
  return hash % 30000
}

// Simple stemmer - removes common suffixes
// Not as good as Porter stemmer but zero dependencies
function simpleStem(word: string): string {
  if (word.length < 4) return word

  // Common suffix removals
  if (word.endsWith('ing') && word.length > 5) {
    return word.slice(0, -3)
  }
  if (word.endsWith('ed') && word.length > 4) {
    return word.slice(0, -2)
  }
  if (word.endsWith('ly') && word.length > 4) {
    return word.slice(0, -2)
  }
  if (word.endsWith('ness') && word.length > 6) {
    return word.slice(0, -4)
  }
  if (word.endsWith('ment') && word.length > 6) {
    return word.slice(0, -4)
  }
  if (word.endsWith('tion') && word.length > 6) {
    return word.slice(0, -4)
  }
  if (word.endsWith('sion') && word.length > 6) {
    return word.slice(0, -4)
  }
  if (word.endsWith('ies') && word.length > 4) {
    return word.slice(0, -3) + 'y'
  }
  if (word.endsWith('es') && word.length > 4) {
    return word.slice(0, -2)
  }
  if (word.endsWith('s') && word.length > 3 && !word.endsWith('ss')) {
    return word.slice(0, -1)
  }

  return word
}

/**
 * Tokenize text into normalized terms
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    // Replace non-alphanumeric with spaces (keep hyphens for compound words)
    .replace(/[^a-z0-9\-]/g, ' ')
    // Split on whitespace
    .split(/\s+/)
    // Filter empty strings and stop words
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
    // Apply simple stemming
    .map(simpleStem)
}

/**
 * Sparse vector representation for Qdrant
 */
export interface SparseVector {
  /** Term indices (hashed) */
  indices: number[]
  /** Term weights (TF-IDF style) */
  values: number[]
}

/**
 * BM25 parameters
 */
export interface BM25Config {
  /** Term frequency saturation (default: 1.2) */
  k1?: number
  /** Length normalization (default: 0.75) */
  b?: number
  /** Average document length estimate (default: 50) */
  avgDocLength?: number
}

/**
 * Generate a sparse vector from text using BM25-style weighting
 *
 * @param text - Input text to vectorize
 * @param config - BM25 parameters
 * @returns Sparse vector with indices and values
 */
export function generateSparseVector(text: string, config: BM25Config = {}): SparseVector {
  const { k1 = 1.2, b = 0.75, avgDocLength = 50 } = config

  const tokens = tokenize(text)
  if (tokens.length === 0) {
    return { indices: [], values: [] }
  }

  // Count term frequencies
  const termFreqs = new Map<string, number>()
  for (const token of tokens) {
    termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1)
  }

  // Calculate BM25-style weights
  const docLength = tokens.length
  const lengthNorm = 1 - b + b * (docLength / avgDocLength)

  const indices: number[] = []
  const values: number[] = []

  for (const [term, tf] of termFreqs) {
    const index = hashTerm(term)

    // BM25 term frequency saturation
    // TF component: (tf * (k1 + 1)) / (tf + k1 * lengthNorm)
    const tfScore = (tf * (k1 + 1)) / (tf + k1 * lengthNorm)

    // We don't have corpus-wide IDF, so use a simple log dampening
    // This approximates IDF behavior for common vs rare terms
    const weight = tfScore * Math.log(1 + tf)

    indices.push(index)
    values.push(weight)
  }

  return { indices, values }
}

/**
 * BM25 Sparse Embedding Provider
 *
 * Stateless provider for generating sparse vectors.
 * Can be extended to maintain IDF statistics if needed.
 */
export class BM25SparseEmbedding {
  private readonly config: Required<BM25Config>

  constructor(config: BM25Config = {}) {
    this.config = {
      k1: config.k1 ?? 1.2,
      b: config.b ?? 0.75,
      avgDocLength: config.avgDocLength ?? 50,
    }
  }

  /**
   * Generate sparse vector for a single text
   */
  embed(text: string): SparseVector {
    return generateSparseVector(text, this.config)
  }

  /**
   * Generate sparse vectors for multiple texts
   */
  embedBatch(texts: string[]): SparseVector[] {
    return texts.map((text) => this.embed(text))
  }
}

// Default singleton instance
let defaultInstance: BM25SparseEmbedding | null = null

/**
 * Get the default BM25 sparse embedding instance
 */
export function getBM25Embedder(): BM25SparseEmbedding {
  if (!defaultInstance) {
    defaultInstance = new BM25SparseEmbedding()
  }
  return defaultInstance
}
