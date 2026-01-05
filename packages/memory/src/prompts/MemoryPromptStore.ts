/**
 * Memory Prompt Store
 *
 * Stores memory prompts in Redis L1 with per-key TTL.
 * Each memory_prompt is a narrativized context string that expires based on topic relevance.
 */

import type { Redis } from "ioredis";
import { nanoid } from "nanoid";
import { getLogger } from "@pippa/observability";
import { ok, err, type Result } from "@pippa/types";

export interface MemoryPrompt {
  id: string;
  content: string;
  createdAt: number;
  ttlMinutes: number;
}

export interface MemoryPromptStoreConfig {
  /** Key prefix for memory prompts (default: "memory_prompt") */
  keyPrefix?: string;
}

const DEFAULT_CONFIG: Required<MemoryPromptStoreConfig> = {
  keyPrefix: "memory_prompt",
};

/**
 * Redis-based storage for memory prompts with per-key TTL
 */
export class MemoryPromptStore {
  private readonly config: Required<MemoryPromptStoreConfig>;
  private readonly logger = getLogger().child({ component: "MemoryPromptStore" });

  constructor(
    private readonly redis: Redis,
    config: MemoryPromptStoreConfig = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Build Redis key for a memory prompt
   */
  private buildKey(userId: string, conversationId: string, promptId: string): string {
    return `${this.config.keyPrefix}:${userId}:${conversationId}:${promptId}`;
  }

  /**
   * Build key pattern for scanning all prompts in a conversation
   */
  private buildPattern(userId: string, conversationId: string): string {
    return `${this.config.keyPrefix}:${userId}:${conversationId}:*`;
  }

  /**
   * Store a memory prompt with TTL
   *
   * @param userId - User ID
   * @param conversationId - Conversation ID
   * @param content - Narrativized memory content
   * @param ttlMinutes - Time-to-live in minutes (0 = don't store)
   */
  async store(
    userId: string,
    conversationId: string,
    content: string,
    ttlMinutes: number
  ): Promise<Result<string, Error>> {
    if (ttlMinutes <= 0) {
      this.logger.debug("Skipping store - TTL is 0");
      return ok("");
    }

    const promptId = nanoid();
    const key = this.buildKey(userId, conversationId, promptId);
    const ttlSeconds = Math.round(ttlMinutes * 60);

    const data: MemoryPrompt = {
      id: promptId,
      content,
      createdAt: Date.now(),
      ttlMinutes,
    };

    try {
      await this.redis.setex(key, ttlSeconds, JSON.stringify(data));
      this.logger.debug(
        { promptId, ttlMinutes, ttlSeconds, contentLength: content.length },
        "Memory prompt stored"
      );
      return ok(promptId);
    } catch (error) {
      this.logger.error({ error, key }, "Failed to store memory prompt");
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Retrieve all non-expired memory prompts for a conversation
   *
   * @param userId - User ID
   * @param conversationId - Conversation ID
   * @returns Array of memory prompt content strings
   */
  async getAll(
    userId: string,
    conversationId: string
  ): Promise<Result<string[], Error>> {
    const pattern = this.buildPattern(userId, conversationId);

    try {
      // Use SCAN to find all matching keys (safer than KEYS for large datasets)
      const keys: string[] = [];
      let cursor = "0";

      do {
        const [newCursor, foundKeys] = await this.redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100
        );
        cursor = newCursor;
        keys.push(...foundKeys);
      } while (cursor !== "0");

      if (keys.length === 0) {
        this.logger.debug({ pattern }, "No memory prompts found");
        return ok([]);
      }

      // MGET all values
      const values = await this.redis.mget(...keys);

      const prompts: string[] = [];
      for (const value of values) {
        if (value) {
          try {
            const data = JSON.parse(value) as MemoryPrompt;
            prompts.push(data.content);
          } catch {
            // Skip malformed entries
            this.logger.warn("Skipping malformed memory prompt");
          }
        }
      }

      this.logger.debug(
        { pattern, keysFound: keys.length, promptsReturned: prompts.length },
        "Memory prompts retrieved"
      );

      return ok(prompts);
    } catch (error) {
      this.logger.error({ error, pattern }, "Failed to retrieve memory prompts");
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Delete all memory prompts for a conversation
   * Useful for clearing memory on conversation reset
   */
  async deleteAll(
    userId: string,
    conversationId: string
  ): Promise<Result<number, Error>> {
    const pattern = this.buildPattern(userId, conversationId);

    try {
      const keys: string[] = [];
      let cursor = "0";

      do {
        const [newCursor, foundKeys] = await this.redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100
        );
        cursor = newCursor;
        keys.push(...foundKeys);
      } while (cursor !== "0");

      if (keys.length === 0) {
        return ok(0);
      }

      const deleted = await this.redis.del(...keys);
      this.logger.debug({ pattern, deleted }, "Memory prompts deleted");

      return ok(deleted);
    } catch (error) {
      this.logger.error({ error, pattern }, "Failed to delete memory prompts");
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get count of active memory prompts for a conversation
   */
  async count(userId: string, conversationId: string): Promise<number> {
    const pattern = this.buildPattern(userId, conversationId);

    try {
      let count = 0;
      let cursor = "0";

      do {
        const [newCursor, foundKeys] = await this.redis.scan(
          cursor,
          "MATCH",
          pattern,
          "COUNT",
          100
        );
        cursor = newCursor;
        count += foundKeys.length;
      } while (cursor !== "0");

      return count;
    } catch {
      return 0;
    }
  }
}
