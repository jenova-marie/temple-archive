/**
 * Redis Key Schema
 *
 * Defines the key patterns used for L1 context caching.
 */

/**
 * Redis key generators for session data
 */
export const RedisKeys = {
  /**
   * Session state key (Hash)
   * Stores: startTime, lastActivity, messageCount, crisisLevel, currentTopic, etc.
   */
  sessionState: (conversationId: string): string =>
    `session:${conversationId}:state`,

  /**
   * Session messages key (Sorted Set)
   * Score: message timestamp
   * Value: JSON-serialized Message
   */
  sessionMessages: (conversationId: string): string =>
    `session:${conversationId}:messages`,

  /**
   * Post-process stats key (String - JSON)
   * Stores the previous exchange's post-process statistics for phase-shifted diagnostics
   */
  postProcessStats: (conversationId: string): string =>
    `session:${conversationId}:postprocess`,
} as const

/**
 * Default TTL values (in seconds)
 */
export const RedisTTL = {
  /** Session TTL: 4 hours */
  SESSION: 4 * 60 * 60, // 14400 seconds

  /** Extended TTL for active sessions: 8 hours */
  SESSION_EXTENDED: 8 * 60 * 60, // 28800 seconds
} as const

/**
 * Redis configuration defaults
 */
export const RedisDefaults = {
  /** Maximum messages to keep per session in cache */
  MAX_MESSAGES_PER_SESSION: 100,
} as const
