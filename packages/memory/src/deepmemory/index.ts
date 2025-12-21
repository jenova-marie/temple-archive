/**
 * Deep Memory Module
 *
 * Provides conversation context enrichment for L3 entities.
 * Retrieves original messages from L2 based on sourceHistory.
 */

export {
  DeepMemoryService,
  type IDeepMemorySessionStore,
  type ContextStrategy,
  type DeepMemoryServiceConfig,
} from './DeepMemoryService.js'
