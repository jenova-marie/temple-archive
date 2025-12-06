# Memory System Quick-Start Implementation Guide

**Practical TypeScript/Node.js Implementation**

This guide provides working code to get your memory system up and running quickly.

---

## Prerequisites

```bash
# Install dependencies
npm install @vercel/postgres pg ioredis neo4j-driver @qdrant/js-client-rest aws-sdk

# Or with pnpm
pnpm add @vercel/postgres pg ioredis neo4j-driver @qdrant/js-client-rest aws-sdk
```

---

## 1. Configuration & Environment

```typescript
// config/memory.config.ts
export const memoryConfig = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: 0,
    keyPrefix: 'chatbot:',
    ttl: {
      session: 14400, // 4 hours
      preferences: 86400, // 24 hours
    }
  },
  
  postgresql: {
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
  
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
    username: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD,
    database: process.env.NEO4J_DATABASE || 'neo4j',
  },
  
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY,
    collectionName: 'chatbot_memory',
    vectorSize: 1536,
  },
  
  s3: {
    region: process.env.AWS_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || 'chatbot-memory-archive',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  
  embedding: {
    provider: 'openai', // or 'anthropic', 'cohere'
    model: 'text-embedding-ada-002',
    apiKey: process.env.OPENAI_API_KEY,
    batchSize: 100,
  }
};
```

---

## 2. L1: Redis Implementation

```typescript
// lib/memory/l1-redis.ts
import Redis from 'ioredis';
import { memoryConfig } from '@/config/memory.config';

export interface Message {
  id: string;
  conversationId: string;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export class L1RedisMemory {
  private redis: Redis;
  
  constructor() {
    this.redis = new Redis(memoryConfig.redis);
  }
  
  /**
   * Store message in Redis with automatic expiry
   */
  async storeMessage(message: Message): Promise<void> {
    const key = `session:${message.conversationId}:messages`;
    
    // Store as sorted set (ordered by timestamp)
    await this.redis.zadd(
      key,
      message.timestamp,
      JSON.stringify(message)
    );
    
    // Set expiry on first message
    await this.redis.expire(key, memoryConfig.redis.ttl.session);
    
    // Update session metadata
    await this.updateSessionState(message.conversationId, {
      userId: message.userId,
      lastActivity: Date.now(),
      messageCount: await this.redis.zcard(key),
    });
  }
  
  /**
   * Retrieve recent messages (hot path)
   */
  async getRecentMessages(
    conversationId: string,
    limit: number = 20
  ): Promise<Message[]> {
    const key = `session:${conversationId}:messages`;
    
    // Get most recent messages (reverse chronological)
    const messages = await this.redis.zrevrange(key, 0, limit - 1);
    
    return messages.map(m => JSON.parse(m)).reverse(); // Return chronological
  }
  
  /**
   * Update session state
   */
  private async updateSessionState(
    conversationId: string,
    state: Record<string, any>
  ): Promise<void> {
    const key = `session:${conversationId}:state`;
    
    await this.redis.hset(
      key,
      ...Object.entries(state).flat()
    );
    
    await this.redis.expire(key, memoryConfig.redis.ttl.session);
  }
  
  /**
   * Get session state
   */
  async getSessionState(conversationId: string): Promise<Record<string, any> | null> {
    const key = `session:${conversationId}:state`;
    const state = await this.redis.hgetall(key);
    
    return Object.keys(state).length > 0 ? state : null;
  }
  
  /**
   * Cache user preferences
   */
  async cacheUserPreferences(
    userId: string,
    preferences: Record<string, any>
  ): Promise<void> {
    const key = `user:${userId}:preferences`;
    
    await this.redis.hset(
      key,
      ...Object.entries(preferences).flat()
    );
    
    await this.redis.expire(key, memoryConfig.redis.ttl.preferences);
  }
  
  /**
   * Get cached preferences
   */
  async getUserPreferences(userId: string): Promise<Record<string, any> | null> {
    const key = `user:${userId}:preferences`;
    const prefs = await this.redis.hgetall(key);
    
    return Object.keys(prefs).length > 0 ? prefs : null;
  }
  
  /**
   * Clear session (for logout, etc.)
   */
  async clearSession(conversationId: string): Promise<void> {
    const pattern = `session:${conversationId}:*`;
    const keys = await this.redis.keys(pattern);
    
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }
  
  /**
   * Get cache statistics
   */
  async getStats() {
    const info = await this.redis.info('memory');
    const dbSize = await this.redis.dbsize();
    
    return {
      memoryUsed: this.parseRedisMemory(info),
      totalKeys: dbSize,
      hitRate: await this.calculateHitRate(),
    };
  }
  
  private parseRedisMemory(info: string): number {
    const match = info.match(/used_memory:(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }
  
  private async calculateHitRate(): Promise<number> {
    const stats = await this.redis.info('stats');
    const hits = this.parseStatValue(stats, 'keyspace_hits');
    const misses = this.parseStatValue(stats, 'keyspace_misses');
    
    return hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;
  }
  
  private parseStatValue(stats: string, key: string): number {
    const match = stats.match(new RegExp(`${key}:(\\d+)`));
    return match ? parseInt(match[1]) : 0;
  }
}
```

---

## 3. L2: PostgreSQL + pgvector Implementation

```typescript
// lib/memory/l2-postgresql.ts
import { Pool, QueryResult } from 'pg';
import { memoryConfig } from '@/config/memory.config';

export class L2PostgreSQLMemory {
  private pool: Pool;
  
  constructor() {
    this.pool = new Pool(memoryConfig.postgresql);
  }
  
  /**
   * Initialize database schema
   */
  async initialize(): Promise<void> {
    await this.pool.query(`
      -- Enable pgvector extension
      CREATE EXTENSION IF NOT EXISTS vector;
      
      -- Conversations table
      CREATE TABLE IF NOT EXISTS conversations (
        conversation_id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status TEXT DEFAULT 'active',
        summary TEXT,
        metadata JSONB
      );
      
      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated 
        ON conversations(user_id, updated_at DESC);
      
      -- Messages table
      CREATE TABLE IF NOT EXISTS messages (
        message_id UUID PRIMARY KEY,
        conversation_id UUID REFERENCES conversations(conversation_id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding vector(1536),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata JSONB
      );
      
      CREATE INDEX IF NOT EXISTS idx_messages_conversation 
        ON messages(conversation_id, created_at DESC);
      
      -- HNSW index for vector similarity search
      CREATE INDEX IF NOT EXISTS idx_messages_embedding 
        ON messages USING hnsw (embedding vector_cosine_ops);
      
      -- Session summaries
      CREATE TABLE IF NOT EXISTS session_summaries (
        summary_id UUID PRIMARY KEY,
        conversation_id UUID REFERENCES conversations(conversation_id),
        time_window TSTZRANGE NOT NULL,
        summary_text TEXT NOT NULL,
        summary_embedding vector(1536),
        key_topics TEXT[],
        entities_mentioned JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      
      -- User memory
      CREATE TABLE IF NOT EXISTS user_memory (
        user_id UUID PRIMARY KEY,
        recovery_phase TEXT,
        triggers TEXT[],
        coping_strategies TEXT[],
        preferences JSONB,
        milestones JSONB,
        last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }
  
  /**
   * Store message with embedding
   */
  async storeMessage(
    message: Message,
    embedding?: number[]
  ): Promise<void> {
    const embeddingValue = embedding 
      ? `[${embedding.join(',')}]` 
      : null;
    
    await this.pool.query(`
      INSERT INTO messages (
        message_id, conversation_id, role, content, 
        embedding, created_at, metadata
      )
      VALUES ($1, $2, $3, $4, $5::vector, $6, $7)
      ON CONFLICT (message_id) DO UPDATE SET
        embedding = EXCLUDED.embedding
    `, [
      message.id,
      message.conversationId,
      message.role,
      message.content,
      embeddingValue,
      new Date(message.timestamp),
      message.metadata || {}
    ]);
    
    // Update conversation updated_at
    await this.pool.query(`
      UPDATE conversations 
      SET updated_at = $1 
      WHERE conversation_id = $2
    `, [new Date(message.timestamp), message.conversationId]);
  }
  
  /**
   * Semantic search with filters
   */
  async semanticSearch(
    conversationId: string,
    queryEmbedding: number[],
    options: {
      limit?: number;
      daysBack?: number;
      minSimilarity?: number;
    } = {}
  ): Promise<Array<Message & { similarity: number }>> {
    const { limit = 10, daysBack = 90, minSimilarity = 0.7 } = options;
    
    const result = await this.pool.query(`
      SELECT 
        m.message_id as id,
        m.conversation_id as "conversationId",
        m.role,
        m.content,
        m.created_at as timestamp,
        m.metadata,
        1 - (m.embedding <=> $1::vector) AS similarity
      FROM messages m
      WHERE m.conversation_id = $2
        AND m.created_at > NOW() - INTERVAL '${daysBack} days'
        AND m.embedding IS NOT NULL
        AND 1 - (m.embedding <=> $1::vector) >= $3
      ORDER BY m.embedding <=> $1::vector
      LIMIT $4
    `, [
      `[${queryEmbedding.join(',')}]`,
      conversationId,
      minSimilarity,
      limit
    ]);
    
    return result.rows.map(row => ({
      ...row,
      timestamp: row.timestamp.getTime(),
    }));
  }
  
  /**
   * Get conversation history
   */
  async getConversationHistory(
    conversationId: string,
    limit: number = 50
  ): Promise<Message[]> {
    const result = await this.pool.query(`
      SELECT 
        message_id as id,
        conversation_id as "conversationId",
        user_id as "userId",
        role,
        content,
        EXTRACT(EPOCH FROM created_at) * 1000 as timestamp,
        metadata
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.conversation_id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at ASC
      LIMIT $2
    `, [conversationId, limit]);
    
    return result.rows;
  }
  
  /**
   * Store session summary
   */
  async storeSummary(
    conversationId: string,
    summary: {
      text: string;
      embedding: number[];
      topics: string[];
      entities: any[];
      timeRange: [Date, Date];
    }
  ): Promise<string> {
    const result = await this.pool.query(`
      INSERT INTO session_summaries (
        summary_id, conversation_id, time_window,
        summary_text, summary_embedding, key_topics, entities_mentioned
      )
      VALUES (gen_random_uuid(), $1, tstzrange($2, $3), $4, $5::vector, $6, $7)
      RETURNING summary_id
    `, [
      conversationId,
      summary.timeRange[0],
      summary.timeRange[1],
      summary.text,
      `[${summary.embedding.join(',')}]`,
      summary.topics,
      JSON.stringify(summary.entities)
    ]);
    
    return result.rows[0].summary_id;
  }
  
  /**
   * Get user memory profile
   */
  async getUserMemory(userId: string): Promise<any | null> {
    const result = await this.pool.query(`
      SELECT * FROM user_memory WHERE user_id = $1
    `, [userId]);
    
    return result.rows[0] || null;
  }
  
  /**
   * Update user memory
   */
  async updateUserMemory(
    userId: string,
    updates: Partial<{
      recoveryPhase: string;
      triggers: string[];
      copingStrategies: string[];
      preferences: any;
      milestones: any[];
    }>
  ): Promise<void> {
    const setClause = Object.keys(updates)
      .map((key, idx) => `${this.toSnakeCase(key)} = $${idx + 2}`)
      .join(', ');
    
    await this.pool.query(`
      INSERT INTO user_memory (user_id, ${Object.keys(updates).map(this.toSnakeCase).join(', ')}, last_updated)
      VALUES ($1, ${Object.keys(updates).map((_, idx) => `$${idx + 2}`).join(', ')}, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        ${setClause},
        last_updated = NOW()
    `, [userId, ...Object.values(updates)]);
  }
  
  private toSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
  
  /**
   * Archive old conversations to prepare for S3 export
   */
  async getConversationsToArchive(daysOld: number = 90): Promise<any[]> {
    const result = await this.pool.query(`
      SELECT 
        c.conversation_id,
        c.user_id,
        c.created_at,
        c.updated_at,
        c.summary,
        c.metadata,
        json_agg(
          json_build_object(
            'message_id', m.message_id,
            'role', m.role,
            'content', m.content,
            'created_at', m.created_at
          ) ORDER BY m.created_at
        ) as messages
      FROM conversations c
      LEFT JOIN messages m ON c.conversation_id = m.conversation_id
      WHERE c.updated_at < NOW() - INTERVAL '${daysOld} days'
        AND c.status = 'active'
      GROUP BY c.conversation_id
    `);
    
    return result.rows;
  }
  
  /**
   * Mark conversation as archived
   */
  async markAsArchived(conversationId: string): Promise<void> {
    await this.pool.query(`
      UPDATE conversations 
      SET status = 'archived' 
      WHERE conversation_id = $1
    `, [conversationId]);
    
    // Delete messages (keep summaries)
    await this.pool.query(`
      DELETE FROM messages WHERE conversation_id = $1
    `, [conversationId]);
  }
}
```

---

## 4. L4: Qdrant Implementation

```typescript
// lib/memory/l4-qdrant.ts
import { QdrantClient } from '@qdrant/js-client-rest';
import { memoryConfig } from '@/config/memory.config';

export class L4QdrantMemory {
  private client: QdrantClient;
  private collectionName: string;
  
  constructor() {
    this.client = new QdrantClient({
      url: memoryConfig.qdrant.url,
      apiKey: memoryConfig.qdrant.apiKey,
    });
    this.collectionName = memoryConfig.qdrant.collectionName;
  }
  
  /**
   * Initialize Qdrant collection
   */
  async initialize(): Promise<void> {
    try {
      await this.client.getCollection(this.collectionName);
      console.log('Collection already exists');
    } catch {
      // Create collection with optimized settings
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: memoryConfig.qdrant.vectorSize,
          distance: 'Cosine',
        },
        optimizers_config: {
          indexing_threshold: 10000,
          memmap_threshold: 50000,
        },
        hnsw_config: {
          m: 16,
          ef_construct: 100,
        },
        quantization_config: {
          scalar: {
            type: 'int8',
            quantile: 0.99,
            always_ram: true,
          }
        }
      });
      
      // Create payload indexes for filtering
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'userId',
        field_schema: 'keyword',
      });
      
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'timestamp',
        field_schema: 'integer',
      });
    }
  }
  
  /**
   * Index message with embedding
   */
  async indexMessage(
    message: Message,
    embedding: number[]
  ): Promise<void> {
    await this.client.upsert(this.collectionName, {
      points: [{
        id: message.id,
        vector: embedding,
        payload: {
          userId: message.userId,
          conversationId: message.conversationId,
          timestamp: message.timestamp,
          messageRole: message.role,
          content: message.content,
          entities: message.metadata?.entities || [],
          topics: message.metadata?.topics || [],
          crisisLevel: message.metadata?.crisisLevel || 0,
        }
      }]
    });
  }
  
  /**
   * Batch index messages
   */
  async batchIndexMessages(
    messages: Message[],
    embeddings: number[][]
  ): Promise<void> {
    const BATCH_SIZE = 100;
    
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const batchEmbeddings = embeddings.slice(i, i + BATCH_SIZE);
      
      await this.client.upsert(this.collectionName, {
        points: batch.map((msg, idx) => ({
          id: msg.id,
          vector: batchEmbeddings[idx],
          payload: {
            userId: msg.userId,
            conversationId: msg.conversationId,
            timestamp: msg.timestamp,
            messageRole: msg.role,
            content: msg.content,
          }
        }))
      });
    }
  }
  
  /**
   * Semantic search with advanced filtering
   */
  async semanticSearch(
    queryEmbedding: number[],
    options: {
      userId?: string;
      conversationId?: string;
      daysBack?: number;
      excludeCrisisLevels?: number[];
      requiredTopics?: string[];
      limit?: number;
      scoreThreshold?: number;
    } = {}
  ) {
    const {
      userId,
      conversationId,
      daysBack = 90,
      excludeCrisisLevels = [],
      requiredTopics = [],
      limit = 20,
      scoreThreshold = 0.7,
    } = options;
    
    const must: any[] = [];
    const mustNot: any[] = [];
    const should: any[] = [];
    
    // User filter
    if (userId) {
      must.push({ key: 'userId', match: { value: userId } });
    }
    
    // Conversation filter
    if (conversationId) {
      must.push({ key: 'conversationId', match: { value: conversationId } });
    }
    
    // Time range filter
    const cutoffTimestamp = Date.now() - (daysBack * 86400000);
    must.push({ 
      key: 'timestamp', 
      range: { gte: cutoffTimestamp } 
    });
    
    // Exclude high crisis levels
    if (excludeCrisisLevels.length > 0) {
      for (const level of excludeCrisisLevels) {
        mustNot.push({ key: 'crisisLevel', match: { value: level } });
      }
    }
    
    // Required topics
    if (requiredTopics.length > 0) {
      should.push({ 
        key: 'topics', 
        match: { any: requiredTopics } 
      });
    }
    
    const results = await this.client.search(this.collectionName, {
      vector: queryEmbedding,
      filter: {
        must,
        must_not: mustNot,
        should: should.length > 0 ? should : undefined,
      },
      limit,
      score_threshold: scoreThreshold,
      with_payload: true,
    });
    
    return results.map(hit => ({
      id: hit.id,
      score: hit.score,
      payload: hit.payload,
    }));
  }
  
  /**
   * Hybrid search (dense + sparse vectors)
   */
  async hybridSearch(
    denseEmbedding: number[],
    keywords: string,
    userId: string,
    limit: number = 10
  ) {
    // Note: Requires Qdrant with sparse vector support
    const results = await this.client.query(this.collectionName, {
      query: {
        fusion: 'rrf', // Reciprocal Rank Fusion
        prefetch: [
          {
            query: denseEmbedding,
            limit: 50,
          },
          {
            query: {
              text: keywords,
            },
            using: 'text-sparse',
            limit: 50,
          }
        ]
      },
      filter: {
        must: [{ key: 'userId', match: { value: userId } }]
      },
      limit,
    });
    
    return results;
  }
  
  /**
   * Get recommendations based on recent messages
   */
  async recommend(
    positiveIds: string[],
    negativeIds: string[] = [],
    userId: string,
    limit: number = 5
  ) {
    const results = await this.client.recommend(this.collectionName, {
      positive: positiveIds,
      negative: negativeIds,
      filter: {
        must: [{ key: 'userId', match: { value: userId } }]
      },
      limit,
      with_payload: true,
    });
    
    return results;
  }
  
  /**
   * Delete old vectors
   */
  async pruneOldVectors(daysOld: number = 365): Promise<void> {
    const cutoffTimestamp = Date.now() - (daysOld * 86400000);
    
    await this.client.delete(this.collectionName, {
      filter: {
        must: [
          { 
            key: 'timestamp', 
            range: { lt: cutoffTimestamp } 
          },
          {
            key: 'messageRole',
            match: { value: 'user' }
          }
        ]
      }
    });
  }
  
  /**
   * Get collection statistics
   */
  async getStats() {
    const info = await this.client.getCollection(this.collectionName);
    
    return {
      vectorsCount: info.vectors_count,
      pointsCount: info.points_count,
      segments: info.segments_count,
      status: info.status,
      optimizerStatus: info.optimizer_status,
    };
  }
}
```

---

## 5. Unified Memory Manager

```typescript
// lib/memory/memory-manager.ts
import { L1RedisMemory } from './l1-redis';
import { L2PostgreSQLMemory } from './l2-postgresql';
import { L4QdrantMemory } from './l4-qdrant';
import { generateEmbedding } from './embedding';

export interface MemoryRetrievalResult {
  messages: Message[];
  source: 'L1_REDIS' | 'L2_POSTGRESQL' | 'L3_NEO4J' | 'L4_QDRANT' | 'COMBINED';
  latency: number;
}

export class MemoryManager {
  private l1: L1RedisMemory;
  private l2: L2PostgreSQLMemory;
  private l4: L4QdrantMemory;
  
  constructor() {
    this.l1 = new L1RedisMemory();
    this.l2 = new L2PostgreSQLMemory();
    this.l4 = new L4QdrantMemory();
  }
  
  /**
   * Store message in all layers
   */
  async storeMessage(message: Message): Promise<void> {
    const startTime = Date.now();
    
    // 1. L1: Immediate write to Redis (synchronous)
    await this.l1.storeMessage(message);
    
    // 2. L2: Persist to PostgreSQL (async)
    const l2Promise = this.l2.storeMessage(message);
    
    // 3. Generate embedding (async)
    const embeddingPromise = generateEmbedding(message.content);
    
    // Wait for embedding, then update L2 and L4
    const embedding = await embeddingPromise;
    
    await Promise.all([
      this.l2.storeMessage(message, embedding),
      this.l4.indexMessage(message, embedding),
      l2Promise,
    ]);
    
    console.log(`Message stored across all layers in ${Date.now() - startTime}ms`);
  }
  
  /**
   * Retrieve context with multi-tier fallback
   */
  async retrieveContext(
    query: string,
    conversationId: string,
    userId: string
  ): Promise<MemoryRetrievalResult> {
    const startTime = Date.now();
    
    // STAGE 1: Try L1 cache (Redis)
    const recentMessages = await this.l1.getRecentMessages(conversationId, 20);
    
    if (recentMessages.length > 0) {
      return {
        messages: recentMessages,
        source: 'L1_REDIS',
        latency: Date.now() - startTime,
      };
    }
    
    // STAGE 2: Try L2 (PostgreSQL)
    const pgMessages = await this.l2.getConversationHistory(conversationId, 50);
    
    if (pgMessages.length > 0) {
      // Warm L1 cache
      for (const msg of pgMessages.slice(-20)) {
        await this.l1.storeMessage(msg);
      }
      
      return {
        messages: pgMessages,
        source: 'L2_POSTGRESQL',
        latency: Date.now() - startTime,
      };
    }
    
    // STAGE 3: Semantic search across all history
    const queryEmbedding = await generateEmbedding(query);
    
    const [pgResults, qdrantResults] = await Promise.all([
      this.l2.semanticSearch(conversationId, queryEmbedding, { limit: 10 }),
      this.l4.semanticSearch(queryEmbedding, { 
        userId, 
        limit: 10,
        scoreThreshold: 0.7 
      }),
    ]);
    
    // Merge and deduplicate results
    const combinedMessages = this.mergeResults(pgResults, qdrantResults);
    
    return {
      messages: combinedMessages,
      source: 'COMBINED',
      latency: Date.now() - startTime,
    };
  }
  
  /**
   * Merge and rank results from multiple sources
   */
  private mergeResults(
    pgResults: Array<Message & { similarity: number }>,
    qdrantResults: Array<{ id: string; score: number; payload: any }>
  ): Message[] {
    const messageMap = new Map<string, Message & { score: number }>();
    
    // Add PostgreSQL results
    for (const msg of pgResults) {
      messageMap.set(msg.id, {
        ...msg,
        score: msg.similarity,
      });
    }
    
    // Add/merge Qdrant results
    for (const result of qdrantResults) {
      const existing = messageMap.get(result.id as string);
      if (existing) {
        // Boost score if found in both
        existing.score = Math.max(existing.score, result.score) * 1.2;
      } else {
        messageMap.set(result.id as string, {
          id: result.id as string,
          conversationId: result.payload.conversationId,
          userId: result.payload.userId,
          role: result.payload.messageRole,
          content: result.payload.content,
          timestamp: result.payload.timestamp,
          score: result.score,
        });
      }
    }
    
    // Sort by score and return
    return Array.from(messageMap.values())
      .sort((a, b) => b.score - a.score)
      .map(({ score, ...msg }) => msg);
  }
  
  /**
   * Initialize all layers
   */
  async initialize(): Promise<void> {
    await Promise.all([
      this.l2.initialize(),
      this.l4.initialize(),
    ]);
  }
}
```

---

## 6. Embedding Generation

```typescript
// lib/memory/embedding.ts
import OpenAI from 'openai';
import { memoryConfig } from '@/config/memory.config';

const openai = new OpenAI({
  apiKey: memoryConfig.embedding.apiKey,
});

/**
 * Generate embedding for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: memoryConfig.embedding.model,
    input: text,
  });
  
  return response.data[0].embedding;
}

/**
 * Generate embeddings in batch
 */
export async function batchGenerateEmbeddings(
  texts: string[]
): Promise<number[][]> {
  const BATCH_SIZE = memoryConfig.embedding.batchSize;
  const embeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    
    const response = await openai.embeddings.create({
      model: memoryConfig.embedding.model,
      input: batch,
    });
    
    embeddings.push(...response.data.map(d => d.embedding));
  }
  
  return embeddings;
}
```

---

## 7. Usage Example

```typescript
// Example: Chatbot handler
import { MemoryManager } from '@/lib/memory/memory-manager';
import { v4 as uuidv4 } from 'uuid';

const memoryManager = new MemoryManager();

async function handleChatMessage(
  userId: string,
  conversationId: string,
  userMessage: string
) {
  // 1. Store user message
  const userMsg: Message = {
    id: uuidv4(),
    conversationId,
    userId,
    role: 'user',
    content: userMessage,
    timestamp: Date.now(),
    metadata: {
      userAgent: 'web',
    }
  };
  
  await memoryManager.storeMessage(userMsg);
  
  // 2. Retrieve relevant context
  const context = await memoryManager.retrieveContext(
    userMessage,
    conversationId,
    userId
  );
  
  console.log(`Context retrieved from ${context.source} in ${context.latency}ms`);
  
  // 3. Generate AI response with context
  const response = await generateAIResponse(userMessage, context.messages);
  
  // 4. Store assistant message
  const assistantMsg: Message = {
    id: uuidv4(),
    conversationId,
    userId,
    role: 'assistant',
    content: response,
    timestamp: Date.now(),
  };
  
  await memoryManager.storeMessage(assistantMsg);
  
  return {
    message: response,
    context: {
      source: context.source,
      latency: context.latency,
      messagesRetrieved: context.messages.length,
    }
  };
}

// Initialize on startup
await memoryManager.initialize();
```

---

## 8. Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
  
  postgres:
    image: pgvector/pgvector:pg16
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: chatbot
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  neo4j:
    image: neo4j:5.13-enterprise
    ports:
      - "7474:7474"
      - "7687:7687"
    environment:
      NEO4J_AUTH: neo4j/password123
      NEO4J_ACCEPT_LICENSE_AGREEMENT: "yes"
      NEO4J_PLUGINS: '["apoc", "graph-data-science"]'
    volumes:
      - neo4j_data:/data
  
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
      - "6334:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      QDRANT__SERVICE__GRPC_PORT: 6334

volumes:
  redis_data:
  postgres_data:
  neo4j_data:
  qdrant_data:
```

**Start services:**
```bash
docker-compose up -d
```

---

## 9. Testing

```typescript
// tests/memory-system.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { MemoryManager } from '@/lib/memory/memory-manager';
import { v4 as uuidv4 } from 'uuid';

describe('Memory System', () => {
  let memoryManager: MemoryManager;
  const testUserId = uuidv4();
  const testConversationId = uuidv4();
  
  beforeAll(async () => {
    memoryManager = new MemoryManager();
    await memoryManager.initialize();
  });
  
  it('should store and retrieve from L1 cache', async () => {
    const message: Message = {
      id: uuidv4(),
      conversationId: testConversationId,
      userId: testUserId,
      role: 'user',
      content: 'Hello, how are you?',
      timestamp: Date.now(),
    };
    
    await memoryManager.storeMessage(message);
    
    const result = await memoryManager.retrieveContext(
      'greeting',
      testConversationId,
      testUserId
    );
    
    expect(result.source).toBe('L1_REDIS');
    expect(result.latency).toBeLessThan(10);
    expect(result.messages).toContainEqual(
      expect.objectContaining({ id: message.id })
    );
  });
  
  it('should perform semantic search across history', async () => {
    // Store multiple messages
    const messages = [
      'I am struggling with my recovery',
      'What are some coping strategies?',
      'Tell me about AA meetings',
    ];
    
    for (const content of messages) {
      await memoryManager.storeMessage({
        id: uuidv4(),
        conversationId: testConversationId,
        userId: testUserId,
        role: 'user',
        content,
        timestamp: Date.now(),
      });
    }
    
    // Search for related content
    const result = await memoryManager.retrieveContext(
      'recovery support',
      testConversationId,
      testUserId
    );
    
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0].content).toContain('recovery');
  });
});
```

---

## Next Steps

1. **Phase 1 (Week 1)**: Deploy Redis + PostgreSQL, implement L1 + L2
2. **Phase 2 (Week 2-3)**: Add Qdrant, implement semantic search
3. **Phase 3 (Week 4-5)**: Add Neo4j for relationship intelligence
4. **Phase 4 (Week 6-7)**: Implement archival pipeline with S3
5. **Phase 5 (Week 8)**: Performance optimization and monitoring

## Performance Targets

- L1 Cache Hit Rate: **>80%**
- L1 Latency: **<10ms**
- L2 Query Latency: **<50ms**
- L4 Search Latency: **<20ms**
- End-to-end context retrieval: **<100ms (p95)**

---

Ready to build! 🚀
