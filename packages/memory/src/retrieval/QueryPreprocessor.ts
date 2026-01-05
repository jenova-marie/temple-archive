/**
 * Query Preprocessor for L4 Semantic Search
 *
 * Preprocesses user messages before embedding to improve semantic search quality.
 * Supports 4 modes:
 * - 0: off (use raw message)
 * - 1: simple (remove stop words, extract key terms)
 * - 2: haiku (LLM extracts search terms)
 * - 3: hybrid (short msgs use simple, long use haiku)
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { TraceContext } from '@pippa/types'
import { getLogger, withSpan } from '@pippa/observability'

export type QueryPreprocessingMode = 0 | 1 | 2 | 3

export interface QueryPreprocessorConfig {
  /** Preprocessing mode: 0=off, 1=simple, 2=haiku, 3=hybrid */
  mode: QueryPreprocessingMode
  /** Message length threshold for hybrid mode (chars) */
  hybridThreshold: number
}

export const DEFAULT_PREPROCESSOR_CONFIG: QueryPreprocessorConfig = {
  mode: 0,
  hybridThreshold: 100,
}

/**
 * Common stop words to remove in simple preprocessing
 */
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she',
  'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
  'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an',
  'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just',
  'don', 'should', 'now', 'd', 'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren',
  'couldn', 'didn', 'doesn', 'hadn', 'hasn', 'haven', 'isn', 'ma', 'mightn',
  'mustn', 'needn', 'shan', 'shouldn', 'wasn', 'weren', 'won', 'wouldn',
  'hi', 'hello', 'hey', 'thanks', 'thank', 'please', 'okay', 'ok', 'yeah',
  'yes', 'no', 'maybe', 'like', 'just', 'really', 'actually', 'basically',
  'um', 'uh', 'well', 'so', 'anyway', 'right', 'gonna', 'wanna', 'gotta',
])

/**
 * Query preprocessor for L4 semantic search
 */
export class QueryPreprocessor {
  private readonly config: QueryPreprocessorConfig

  constructor(
    private readonly anthropic: Anthropic | null,
    config?: Partial<QueryPreprocessorConfig>
  ) {
    this.config = { ...DEFAULT_PREPROCESSOR_CONFIG, ...config }
  }

  /**
   * Preprocess a message for semantic search
   * Returns the processed query string to embed
   */
  async preprocess(message: string, ctx: TraceContext): Promise<string> {
    return withSpan('QueryPreprocessor.preprocess', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId })

      // Mode 0: off - return raw message
      if (this.config.mode === 0) {
        logger.debug('Query preprocessing disabled (mode=0)')
        return message
      }

      // Mode 1: Simple only
      if (this.config.mode === 1) {
        logger.debug('Using simple preprocessing (mode=1)')
        return this.preprocessSimple(message)
      }

      // Mode 2: Haiku only
      if (this.config.mode === 2) {
        logger.debug('Using Haiku preprocessing (mode=2)')
        return this.preprocessWithHaiku(message, ctx)
      }

      // Mode 3: Hybrid
      if (this.config.mode === 3) {
        if (message.length < this.config.hybridThreshold) {
          logger.debug({ length: message.length, threshold: this.config.hybridThreshold },
            'Using simple preprocessing (mode=3, under threshold)')
          return this.preprocessSimple(message)
        }
        logger.debug({ length: message.length, threshold: this.config.hybridThreshold },
          'Using Haiku preprocessing (mode=3, over threshold)')
        return this.preprocessWithHaiku(message, ctx)
      }

      // Unknown mode - return raw message
      logger.warn({ mode: this.config.mode }, 'Unknown preprocessing mode, using raw message')
      return message
    })
  }

  /**
   * Simple preprocessing: remove stop words, extract key terms
   */
  private preprocessSimple(message: string): string {
    // Normalize: lowercase, remove punctuation except apostrophes
    const normalized = message
      .toLowerCase()
      .replace(/[^\w\s']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Split into words and filter stop words
    const words = normalized.split(' ')
    const keyTerms = words.filter(word => {
      // Keep words that are:
      // - Not stop words
      // - At least 2 characters
      // - Not just numbers
      return word.length >= 2 &&
        !STOP_WORDS.has(word) &&
        !/^\d+$/.test(word)
    })

    // Return unique terms, space-separated
    const uniqueTerms = [...new Set(keyTerms)]
    const result = uniqueTerms.join(' ')

    getLogger().debug({
      original: message.slice(0, 50),
      processed: result.slice(0, 50),
      termCount: uniqueTerms.length,
    }, 'Simple preprocessing complete')

    // If we filtered out everything, return the original
    return result.length > 0 ? result : message
  }

  /**
   * Haiku preprocessing: use LLM to extract search terms
   * Falls back to simple preprocessing on error
   */
  private async preprocessWithHaiku(message: string, ctx: TraceContext): Promise<string> {
    const logger = getLogger().child({ requestId: ctx.requestId })

    if (!this.anthropic) {
      logger.warn('Anthropic client not available, falling back to simple preprocessing')
      return this.preprocessSimple(message)
    }

    try {
      const prompt = `Extract the key concepts, entities, and topics from this message for semantic search.
Return ONLY the search terms, space-separated, no explanation or formatting.
Focus on: names, places, emotions, events, topics, actions discussed.
Keep it concise - aim for 5-15 key terms.

Message: ${message}

Search terms:`

      const response = await this.anthropic.messages.create(
        {
          model: 'claude-3-haiku-20240307',
          max_tokens: 100,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          signal: AbortSignal.timeout(5000), // 5 second timeout
        }
      )

      const content = response.content[0]
      if (content.type === 'text' && content.text.trim().length > 0) {
        const result = content.text.trim()
        logger.debug({
          original: message.slice(0, 50),
          processed: result.slice(0, 50),
        }, 'Haiku preprocessing complete')
        return result
      }

      // Empty response - fall back to simple
      logger.warn('Haiku returned empty response, falling back to simple')
      return this.preprocessSimple(message)
    } catch (error) {
      logger.warn({ error }, 'Haiku preprocessing failed, falling back to simple')
      return this.preprocessSimple(message)
    }
  }
}
