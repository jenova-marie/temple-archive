/**
 * Context Compaction Module
 *
 * Exports for the context compaction system that summarizes older messages
 * to reduce context size while preserving semantic information.
 */

export { ContextCompactor, StubContextCompactor } from './ContextCompactor.js'

export {
  type CompactionConfig,
  type CompactionError,
  type IContextCompactor,
  type SummaryMetadata,
  DEFAULT_COMPACTION_CONFIG,
  loadCompactionConfig,
} from './types.js'
