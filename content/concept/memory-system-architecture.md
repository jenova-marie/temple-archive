# Production-Grade Memory System Architecture for Intelligent Chatbots
## Multi-Tier Hybrid Memory System Design

**Author's Note:** This architecture synthesizes the latest research (2024-2025) on LLM memory systems, combining vector databases, graph databases, and traditional data stores to create a robust, scalable memory layer for intelligent chatbots.

---

## Executive Summary

Modern chatbot memory requires **four distinct tiers** working in concert:

1. **L1 - Active Context Layer** (Redis): Ultra-fast, in-memory session state
2. **L2 - Session Persistence** (PostgreSQL + pgvector): Mid-term conversational context with semantic search
3. **L3 - Knowledge Graph** (Neo4j): Long-term relationships, entities, and temporal reasoning
4. **L4 - Vector Store** (Qdrant): Semantic similarity search across all historical data

Additionally, **S3** serves as cold storage for complete conversation archives and embeddings backup.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER REQUEST                             │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────────┐
        │     L1: REDIS (Active Context)         │
        │   • Current conversation state          │
        │   • Last 10-20 messages                 │
        │   • User preferences cache              │
        │   • <10ms latency                       │
        └────────────┬──────────────┬─────────────┘
                     │ MISS         │ HIT
                     ▼              └──────────► Fast Path
        ┌────────────────────────────────────────┐
        │   L2: POSTGRESQL + pgvector            │
        │   • Session summaries                   │
        │   • Conversation history (30-90 days)   │
        │   • Metadata filtering                  │
        │   • Embeddings for recent messages      │
        │   • 10-50ms latency                     │
        └────────────┬──────────────┬─────────────┘
                     │              │
                     ▼              ▼
        ┌──────────────────┐    ┌──────────────────┐
        │  L3: NEO4J       │    │  L4: QDRANT      │
        │  (Knowledge      │    │  (Semantic       │
        │   Graph)         │    │   Search)        │
        │                  │    │                  │
        │ • Entities       │    │ • Full vector    │
        │ • Relationships  │    │   corpus         │
        │ • Temporal data  │    │ • Historical     │
        │ • Multi-hop      │    │   messages       │
        │   queries        │    │ • Documents      │
        │ • 20-100ms       │    │ • 5-20ms         │
        └──────────┬───────┘    └──────────┬───────┘
                   │                       │
                   └───────────┬───────────┘
                               ▼
                   ┌──────────────────────┐
                   │  S3 (Cold Storage)   │
                   │  • Full archives     │
                   │  • Embeddings backup │
                   │  • Audit logs        │
                   └──────────────────────┘
```

---

## Detailed Component Design

### **L1: Redis - Active Context Layer**

**Purpose:** Blazing-fast access to current session state

**Data Structures:**
```typescript
// Redis Key Schema
interface RedisSchema {
  // Current conversation window
  `session:${conversationId}:messages`: SortedSet<Message>
  
  // User state
  `session:${conversationId}:state`: Hash {
    userId: string
    startTime: timestamp
    lastActivity: timestamp
    messageCount: number
    entities: JSON<string[]>
  }
  
  // Hot cache for user preferences
  `user:${userId}:preferences`: Hash {
    tone: string
    topics: string[]
    copingStrategies: string[]
  }
  
  // Temporary entities extracted this session
  `session:${conversationId}:entities`: Hash
}
```

**TTL Strategy:**
- Active sessions: 4 hours
- Inactive sessions: Persist to L2 after 30 minutes
- User preferences: 24 hours (refresh on access)

**Operations:**
```typescript
// Streaming writes during conversation
await redis.zadd(`session:${id}:messages`, timestamp, messageJSON)
await redis.expire(`session:${id}:messages`, 14400) // 4 hours

// Fast retrieval
const recentMessages = await redis.zrevrange(
  `session:${id}:messages`, 
  0, 
  19 // Last 20 messages
)
```

**Why Redis:**
- Sub-millisecond latency for reads
- Atomic operations for concurrent users
- Built-in pub/sub for real-time features
- Perfect for ephemeral session state

---

### **L2: PostgreSQL + pgvector - Session Persistence**

**Purpose:** Mid-term storage with SQL queryability and vector search

**Schema Design:**
```sql
-- Conversations table (relational core)
CREATE TABLE conversations (
    conversation_id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'active',
    summary TEXT,
    metadata JSONB,
    INDEX idx_user_updated (user_id, updated_at DESC)
);

-- Messages table with embeddings
CREATE TABLE messages (
    message_id UUID PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(conversation_id),
    role TEXT NOT NULL, -- 'user' | 'assistant' | 'system'
    content TEXT NOT NULL,
    embedding vector(1536), -- OpenAI ada-002 or similar
    created_at TIMESTAMPTZ NOT NULL,
    metadata JSONB,
    
    -- pgvector HNSW index for fast ANN search
    INDEX idx_embedding USING hnsw (embedding vector_cosine_ops)
);

-- Session summaries (compressed context)
CREATE TABLE session_summaries (
    summary_id UUID PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(conversation_id),
    time_window TSTZRANGE NOT NULL,
    summary_text TEXT NOT NULL,
    summary_embedding vector(1536),
    key_topics TEXT[],
    entities_mentioned JSONB,
    created_at TIMESTAMPTZ NOT NULL
);

-- User memory (long-term profile)
CREATE TABLE user_memory (
    user_id UUID PRIMARY KEY,
    recovery_phase TEXT,
    triggers TEXT[],
    coping_strategies TEXT[],
    preferences JSONB,
    milestones JSONB,
    last_updated TIMESTAMPTZ NOT NULL
);
```

**Query Patterns:**

```sql
-- Hybrid search: Vector similarity + metadata filtering
SELECT 
    m.message_id,
    m.content,
    m.created_at,
    1 - (m.embedding <=> $1::vector) AS similarity
FROM messages m
WHERE m.conversation_id = $2
    AND m.created_at > NOW() - INTERVAL '90 days'
    AND (m.metadata->>'crisis_level')::int < 7
ORDER BY m.embedding <=> $1::vector
LIMIT 10;

-- Session history with summaries
SELECT 
    c.conversation_id,
    c.summary,
    ss.summary_text,
    ss.key_topics
FROM conversations c
LEFT JOIN session_summaries ss ON c.conversation_id = ss.conversation_id
WHERE c.user_id = $1
    AND c.updated_at > NOW() - INTERVAL '30 days'
ORDER BY c.updated_at DESC;
```

**Background Jobs:**
1. **Conversation Summarizer** (runs every 10 messages):
   - Compresses conversation into summary
   - Extracts key entities and topics
   - Stores in `session_summaries`

2. **Embedding Generator** (async after message insert):
   - Generate embedding for new messages
   - Update vector index

3. **Archive Job** (nightly):
   - Move conversations older than 90 days to S3
   - Keep summaries in PostgreSQL

**Why PostgreSQL + pgvector:**
- Transactional guarantees (ACID)
- Rich SQL querying with JOINs
- Vector search without separate system
- Mature backup/replication
- Cost-effective for moderate scale (<10M vectors)

---

### **L3: Neo4j - Knowledge Graph Layer**

**Purpose:** Model relationships, temporal reasoning, and entity evolution

**Graph Schema:**

```cypher
// Node types
(:User {
  userId: string,
  name: string,
  joinDate: datetime
})

(:Conversation {
  conversationId: string,
  startTime: datetime,
  endTime: datetime,
  summary: string
})

(:Message {
  messageId: string,
  content: string,
  timestamp: datetime,
  embedding: vector[1536]  // Neo4j 5.x supports vectors
})

(:Entity {
  entityId: string,
  name: string,
  type: string,  // Person, Event, Concept, Location
  firstMentioned: datetime,
  lastMentioned: datetime
})

(:Topic {
  topicId: string,
  name: string,
  category: string
})

(:Milestone {
  milestoneId: string,
  achievement: string,
  date: datetime
})

// Relationships with temporal properties
(:User)-[:HAD_CONVERSATION {startTime, endTime}]->(:Conversation)
(:Conversation)-[:CONTAINS {sequence: int}]->(:Message)
(:Message)-[:MENTIONS {confidence: float}]->(:Entity)
(:Message)-[:DISCUSSES]->(:Topic)
(:User)-[:ACHIEVED]->(:Milestone)
(:Entity)-[:RELATES_TO {strength: float, firstSeen: datetime}]->(:Entity)
(:Topic)-[:INFLUENCED_BY]->(:Topic)
(:Message)-[:REPLIED_TO]->(:Message)
```

**Key Query Patterns:**

```cypher
// 1. Temporal entity evolution
MATCH (u:User {userId: $userId})-[:HAD_CONVERSATION]->(c:Conversation)
      -[:CONTAINS]->(m:Message)-[r:MENTIONS]->(e:Entity)
WHERE m.timestamp >= datetime($startDate) AND m.timestamp <= datetime($endDate)
RETURN e.name, 
       collect(m.timestamp) as mentions,
       count(m) as mentionCount
ORDER BY mentionCount DESC;

// 2. Multi-hop relationship discovery
MATCH path = (e1:Entity {name: "relapse"})-[:RELATES_TO*1..3]-(e2:Entity)
WHERE e1.lastMentioned >= datetime() - duration('P30D')
RETURN path, length(path) as hops
ORDER BY hops ASC
LIMIT 20;

// 3. Conversation thread analysis
MATCH (m1:Message)-[:REPLIED_TO*]->(m2:Message)
WHERE m1.timestamp >= datetime() - duration('P7D')
WITH m1, m2, length(path) as threadDepth
RETURN m1.conversationId, 
       avg(threadDepth) as avgThreadDepth,
       collect(m1.messageId) as messageIds;

// 4. User journey mapping
MATCH (u:User {userId: $userId})-[:ACHIEVED]->(mil:Milestone)
WITH u, mil ORDER BY mil.date ASC
MATCH (u)-[:HAD_CONVERSATION]->(c:Conversation)
      -[:CONTAINS]->(m:Message)-[:DISCUSSES]->(t:Topic)
WHERE c.startTime >= mil.date
RETURN mil.achievement,
       collect(DISTINCT t.name) as topicsDiscussed,
       count(DISTINCT c) as conversationsAfter;

// 5. Crisis pattern detection (graph algorithms)
CALL gds.pageRank.stream('conversation_graph', {
  nodeLabels: ['Entity'],
  relationshipTypes: ['RELATES_TO'],
  dampingFactor: 0.85
})
YIELD nodeId, score
RETURN gds.util.asNode(nodeId).name AS entityName, score
ORDER BY score DESC
LIMIT 10;
```

**Vector Search in Neo4j:**
```cypher
// Semantic search on messages (Neo4j 5.13+)
CALL db.index.vector.queryNodes('message_embeddings', 10, $queryEmbedding)
YIELD node AS message, score
MATCH (message)<-[:CONTAINS]-(c:Conversation)<-[:HAD_CONVERSATION]-(u:User)
WHERE u.userId = $userId
RETURN message.content, score, c.startTime
ORDER BY score DESC;

// Hybrid: Vector search + graph traversal
CALL db.index.vector.queryNodes('message_embeddings', 20, $queryEmbedding)
YIELD node AS m1, score
MATCH (m1)-[:MENTIONS]->(e:Entity)-[:RELATES_TO*1..2]-(related:Entity)
RETURN m1.content, score, 
       collect(DISTINCT related.name) as relatedConcepts
ORDER BY score DESC
LIMIT 5;
```

**Why Neo4j:**
- Native graph traversal (multi-hop queries)
- Temporal relationship tracking
- Entity resolution and deduplication
- Graph algorithms (PageRank, community detection)
- Native vector support (5.13+)
- Excellent for "how did X evolve" questions

---

### **L4: Qdrant - Dedicated Vector Store**

**Purpose:** High-performance semantic similarity search across entire corpus

**Why Qdrant (Best OSS Alternative to Pinecone):**
- ✅ **Open source** (Apache 2.0)
- ✅ **Rust-based** (extremely fast, memory-efficient)
- ✅ **Advanced filtering** (pre-filtering, not post-filtering like some others)
- ✅ **Distributed** (horizontal scaling)
- ✅ **Hybrid search** (dense + sparse vectors)
- ✅ **Quantization** (reduce memory by 4-16x)
- ✅ **Multi-tenancy** (built-in)
- ✅ **gRPC + HTTP APIs**
- ✅ **Active development** (frequent updates)

**Collection Schema:**

```typescript
// Qdrant collection configuration
const collectionConfig = {
  vectors: {
    size: 1536,  // OpenAI ada-002
    distance: "Cosine"
  },
  optimizers_config: {
    indexing_threshold: 10000,
    memmap_threshold: 50000
  },
  hnsw_config: {
    m: 16,
    ef_construct: 100
  },
  quantization_config: {
    scalar: {
      type: "int8",
      quantile: 0.99,
      always_ram: true
    }
  }
}

// Point schema (each vector stored in Qdrant)
interface QdrantPoint {
  id: string,  // message_id or document_id
  vector: number[],
  payload: {
    // Filterable metadata
    userId: string,
    conversationId: string,
    timestamp: number,
    messageRole: "user" | "assistant" | "system",
    
    // Rich metadata for hybrid search
    content: string,
    entities: string[],
    topics: string[],
    crisisLevel: number,
    sentiment: number,
    
    // Document metadata (if RAG documents)
    documentType?: "message" | "knowledge_base" | "resource",
    source?: string
  }
}
```

**Query Patterns:**

```typescript
// 1. Semantic search with complex filters
const searchResults = await qdrantClient.search('chatbot_memory', {
  vector: queryEmbedding,
  filter: {
    must: [
      { key: 'userId', match: { value: userId } },
      { key: 'timestamp', range: { gte: Date.now() - 90 * 86400000 } }
    ],
    must_not: [
      { key: 'crisisLevel', range: { gte: 8 } }  // Exclude high-crisis messages
    ],
    should: [
      { key: 'topics', match: { any: ['recovery', 'support'] } }
    ]
  },
  limit: 20,
  with_payload: true,
  score_threshold: 0.7  // Only high-confidence matches
});

// 2. Hybrid search (dense + sparse BM25)
const hybridResults = await qdrantClient.search('chatbot_memory', {
  query: {
    fusion: "rrf",  // Reciprocal Rank Fusion
    prefetch: [
      {
        query: queryEmbedding,  // Dense vector search
        limit: 50
      },
      {
        query: {
          text: "relapse prevention strategies"  // Sparse keyword search
        },
        using: "text-sparse",
        limit: 50
      }
    ]
  },
  limit: 10
});

// 3. Multi-vector search (query expansion)
const expandedResults = await qdrantClient.searchBatch('chatbot_memory', [
  { vector: originalQueryEmbedding, limit: 10 },
  { vector: expandedQuery1Embedding, limit: 10 },
  { vector: expandedQuery2Embedding, limit: 10 }
], {
  filter: commonFilters
});

// 4. Recommendation (find similar past conversations)
const recommendations = await qdrantClient.recommend('chatbot_memory', {
  positive: [recentMessageIds],  // IDs of current conversation
  negative: [dismissedMessageIds],  // IDs user didn't find helpful
  filter: { key: 'userId', match: { value: userId } },
  limit: 5
});
```

**Quantization for Memory Efficiency:**

```typescript
// Reduce memory footprint by 4x-16x with minimal quality loss
const quantizationConfig = {
  scalar: {
    type: "int8",
    quantile: 0.99,
    always_ram: true  // Keep quantized vectors in RAM for speed
  }
};

// Or product quantization for even more compression
const pqConfig = {
  product: {
    compression: "x16",  // 16x compression
    always_ram: true
  }
};
```

**Why Qdrant over Alternatives:**

| Feature | Qdrant | Pinecone | Weaviate | Chroma |
|---------|--------|----------|----------|---------|
| **Open Source** | ✅ Yes | ❌ No | ✅ Yes | ✅ Yes |
| **Self-hosted** | ✅ Yes | ❌ No | ✅ Yes | ✅ Yes |
| **Advanced Filtering** | ✅ Pre-filter | ⚠️ Post-filter | ✅ Pre-filter | ⚠️ Limited |
| **Hybrid Search** | ✅ Native | ❌ No | ✅ Yes | ❌ No |
| **Quantization** | ✅ Yes | ✅ Yes | ⚠️ Limited | ❌ No |
| **Distributed** | ✅ Native | ✅ Yes | ✅ Yes | ❌ No |
| **Performance** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Maturity** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Cost (self-hosted)** | $ | N/A | $$ | $ |

---

### **S3 - Cold Storage Layer**

**Purpose:** Archival storage, backups, and audit trail

**Data Organization:**

```
s3://chatbot-memory-archive/
├── conversations/
│   ├── year=2024/
│   │   ├── month=01/
│   │   │   ├── day=01/
│   │   │   │   └── conversation_{uuid}.json.gz
│   ├── year=2025/
│
├── embeddings/
│   ├── snapshots/
│   │   ├── 2024-01-01/
│   │   │   ├── qdrant_backup.tar.gz
│   │   │   └── pgvector_embeddings.parquet
│
├── analytics/
│   ├── daily_summaries/
│   │   └── 2024-01-01.parquet
│
└── audit_logs/
    └── 2024/01/conversation_access_log.jsonl.gz
```

**Lifecycle Policies:**
```json
{
  "Rules": [
    {
      "Id": "TransitionOldConversations",
      "Status": "Enabled",
      "Transitions": [
        {
          "Days": 90,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 365,
          "StorageClass": "GLACIER"
        }
      ]
    },
    {
      "Id": "DeleteAuditLogs",
      "Expiration": {
        "Days": 2555  // 7 years for compliance
      }
    }
  ]
}
```

---

## Data Flow & Orchestration

### **Write Path (Incoming Message)**

```typescript
async function handleIncomingMessage(message: Message) {
  const conversationId = message.conversationId;
  const userId = message.userId;
  
  // 1. IMMEDIATE: Write to L1 (Redis)
  await redis.zadd(
    `session:${conversationId}:messages`,
    Date.now(),
    JSON.stringify(message)
  );
  
  // 2. ASYNC: Extract entities and update session state
  const entities = await extractEntities(message.content);
  await redis.hset(
    `session:${conversationId}:entities`,
    ...entities.flatMap(e => [e.name, JSON.stringify(e)])
  );
  
  // 3. ASYNC: Persist to L2 (PostgreSQL)
  await db.query(`
    INSERT INTO messages (message_id, conversation_id, role, content, created_at, metadata)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [message.id, conversationId, message.role, message.content, new Date(), message.metadata]);
  
  // 4. ASYNC: Generate and store embedding
  const embedding = await generateEmbedding(message.content);
  
  // 4a. Update PostgreSQL
  await db.query(`
    UPDATE messages SET embedding = $1 WHERE message_id = $2
  `, [pgvector.toSql(embedding), message.id]);
  
  // 4b. Index in Qdrant
  await qdrantClient.upsert('chatbot_memory', {
    points: [{
      id: message.id,
      vector: embedding,
      payload: {
        userId,
        conversationId,
        timestamp: Date.now(),
        messageRole: message.role,
        content: message.content,
        entities: entities.map(e => e.name),
        topics: message.metadata.topics || []
      }
    }]
  });
  
  // 5. ASYNC: Update knowledge graph (Neo4j)
  await updateKnowledgeGraph(message, entities);
  
  // 6. CONDITIONAL: Check if session needs summarization
  const messageCount = await redis.zcard(`session:${conversationId}:messages`);
  if (messageCount > 0 && messageCount % 10 === 0) {
    await triggerSessionSummary(conversationId);
  }
}
```

### **Read Path (Query for Context)**

```typescript
async function retrieveContext(query: string, conversationId: string, userId: string) {
  const startTime = Date.now();
  
  // STAGE 1: L1 Cache (Redis) - <10ms
  const recentMessages = await redis.zrevrange(
    `session:${conversationId}:messages`,
    0,
    19
  );
  
  if (recentMessages.length > 0) {
    console.log(`L1 hit: ${Date.now() - startTime}ms`);
    return {
      source: 'L1_REDIS',
      messages: recentMessages.map(m => JSON.parse(m)),
      latency: Date.now() - startTime
    };
  }
  
  // STAGE 2: L2 Database (PostgreSQL + pgvector) - 10-50ms
  const queryEmbedding = await generateEmbedding(query);
  
  const pgResults = await db.query(`
    SELECT 
      m.message_id,
      m.content,
      m.created_at,
      1 - (m.embedding <=> $1::vector) AS similarity
    FROM messages m
    WHERE m.conversation_id = $2
      AND m.created_at > NOW() - INTERVAL '30 days'
    ORDER BY m.created_at DESC
    LIMIT 20
  `, [pgvector.toSql(queryEmbedding), conversationId]);
  
  if (pgResults.rows.length > 0) {
    console.log(`L2 hit: ${Date.now() - startTime}ms`);
    
    // Warm L1 cache
    await warmRedisCache(conversationId, pgResults.rows);
    
    return {
      source: 'L2_POSTGRESQL',
      messages: pgResults.rows,
      latency: Date.now() - startTime
    };
  }
  
  // STAGE 3: Parallel search in L3 (Neo4j) and L4 (Qdrant)
  const [graphResults, vectorResults] = await Promise.all([
    // Neo4j: Relationship-based context
    searchKnowledgeGraph(query, userId),
    
    // Qdrant: Semantic similarity across all history
    qdrantClient.search('chatbot_memory', {
      vector: queryEmbedding,
      filter: {
        must: [
          { key: 'userId', match: { value: userId } }
        ]
      },
      limit: 10,
      with_payload: true
    })
  ]);
  
  console.log(`L3/L4 search: ${Date.now() - startTime}ms`);
  
  // Combine and rank results
  const combinedContext = mergeAndRankResults(
    graphResults,
    vectorResults,
    query
  );
  
  return {
    source: 'L3_NEO4J_L4_QDRANT',
    messages: combinedContext,
    latency: Date.now() - startTime
  };
}
```

---

## Memory Management Strategies

### **1. Conversation Summarization**

```typescript
async function summarizeConversation(conversationId: string) {
  // Fetch last 50 messages
  const messages = await db.query(`
    SELECT content, role, created_at
    FROM messages
    WHERE conversation_id = $1
    ORDER BY created_at DESC
    LIMIT 50
  `, [conversationId]);
  
  // Use LLM to generate summary
  const summary = await llm.generate({
    prompt: `Summarize this conversation, focusing on:
    1. Key topics discussed
    2. User's emotional state progression
    3. Important decisions or commitments
    4. Entities mentioned (people, places, events)
    
    Conversation:
    ${messages.rows.map(m => `${m.role}: ${m.content}`).join('\n')}`,
    model: 'claude-haiku-4-20250514',
    max_tokens: 500
  });
  
  // Extract entities and topics
  const entities = extractEntitiesFromText(summary);
  const topics = extractTopicsFromText(summary);
  
  // Store summary in PostgreSQL
  await db.query(`
    INSERT INTO session_summaries 
    (summary_id, conversation_id, time_window, summary_text, key_topics, entities_mentioned)
    VALUES ($1, $2, tstzrange($3, $4), $5, $6, $7)
  `, [
    uuidv4(),
    conversationId,
    messages.rows[messages.rows.length - 1].created_at,
    messages.rows[0].created_at,
    summary,
    topics,
    JSON.stringify(entities)
  ]);
  
  // Generate summary embedding for semantic search
  const summaryEmbedding = await generateEmbedding(summary);
  await db.query(`
    UPDATE session_summaries 
    SET summary_embedding = $1 
    WHERE conversation_id = $2
  `, [pgvector.toSql(summaryEmbedding), conversationId]);
}
```

### **2. Entity Resolution & Knowledge Graph Updates**

```typescript
async function updateKnowledgeGraph(message: Message, entities: Entity[]) {
  const session = neo4jDriver.session();
  
  try {
    // 1. Create or update message node
    await session.run(`
      MERGE (m:Message {messageId: $messageId})
      SET m.content = $content,
          m.timestamp = datetime($timestamp),
          m.embedding = $embedding
      
      WITH m
      MATCH (c:Conversation {conversationId: $conversationId})
      MERGE (c)-[:CONTAINS {sequence: $sequence}]->(m)
    `, {
      messageId: message.id,
      content: message.content,
      timestamp: message.timestamp,
      embedding: message.embedding,
      conversationId: message.conversationId,
      sequence: message.sequence
    });
    
    // 2. Entity resolution: Find or create entities
    for (const entity of entities) {
      await session.run(`
        MERGE (e:Entity {name: $name})
        ON CREATE SET 
          e.entityId = $entityId,
          e.type = $type,
          e.firstMentioned = datetime($timestamp)
        ON MATCH SET
          e.lastMentioned = datetime($timestamp)
        
        WITH e
        MATCH (m:Message {messageId: $messageId})
        MERGE (m)-[r:MENTIONS]->(e)
        SET r.confidence = $confidence
      `, {
        name: entity.name,
        entityId: entity.id,
        type: entity.type,
        timestamp: message.timestamp,
        messageId: message.id,
        confidence: entity.confidence
      });
    }
    
    // 3. Create entity co-occurrence relationships
    if (entities.length > 1) {
      for (let i = 0; i < entities.length; i++) {
        for (let j = i + 1; j < entities.length; j++) {
          await session.run(`
            MATCH (e1:Entity {name: $entity1})
            MATCH (e2:Entity {name: $entity2})
            MERGE (e1)-[r:RELATES_TO]-(e2)
            ON CREATE SET 
              r.strength = 1,
              r.firstSeen = datetime($timestamp)
            ON MATCH SET
              r.strength = r.strength + 1,
              r.lastSeen = datetime($timestamp)
          `, {
            entity1: entities[i].name,
            entity2: entities[j].name,
            timestamp: message.timestamp
          });
        }
      }
    }
  } finally {
    await session.close();
  }
}
```

### **3. Intelligent Memory Pruning**

```typescript
// Decide what to keep in each tier based on access patterns
async function pruneMemory() {
  // L1 Redis: Natural TTL expiration (4 hours)
  
  // L2 PostgreSQL: Archive conversations older than 90 days
  const oldConversations = await db.query(`
    SELECT conversation_id, user_id, created_at, updated_at
    FROM conversations
    WHERE updated_at < NOW() - INTERVAL '90 days'
      AND status = 'active'
  `);
  
  for (const conv of oldConversations.rows) {
    // 1. Export to S3
    const messages = await db.query(`
      SELECT * FROM messages WHERE conversation_id = $1
    `, [conv.conversation_id]);
    
    await s3.putObject({
      Bucket: 'chatbot-memory-archive',
      Key: `conversations/year=${conv.created_at.getFullYear()}/month=${conv.created_at.getMonth() + 1}/day=${conv.created_at.getDate()}/conversation_${conv.conversation_id}.json.gz`,
      Body: zlib.gzipSync(JSON.stringify({
        conversation: conv,
        messages: messages.rows
      }))
    });
    
    // 2. Keep summary in PostgreSQL, delete full messages
    await db.query(`
      DELETE FROM messages WHERE conversation_id = $1
    `, [conv.conversation_id]);
    
    await db.query(`
      UPDATE conversations SET status = 'archived' WHERE conversation_id = $1
    `, [conv.conversation_id]);
  }
  
  // L3 Neo4j: Prune low-strength relationships
  const session = neo4jDriver.session();
  await session.run(`
    MATCH ()-[r:RELATES_TO]-()
    WHERE r.strength < 2 
      AND r.lastSeen < datetime() - duration('P180D')
    DELETE r
  `);
  await session.close();
  
  // L4 Qdrant: Delete points older than 1 year (keep summaries)
  await qdrantClient.delete('chatbot_memory', {
    filter: {
      must: [
        { 
          key: 'timestamp', 
          range: { 
            lt: Date.now() - (365 * 86400000) 
          } 
        },
        {
          key: 'documentType',
          match: { value: 'message' }
        }
      ]
    }
  });
}
```

---

## Performance Optimization

### **Caching Strategy**

```typescript
// Multi-tier caching
class MemoryCache {
  private l1Cache: Redis; // In-memory, sub-ms
  private l2Cache: PostgreSQL; // Disk, 10-50ms
  
  async get(key: string, options: CacheOptions) {
    // Try L1 first
    const l1Result = await this.l1Cache.get(key);
    if (l1Result) {
      return { data: JSON.parse(l1Result), source: 'L1', latency: 1 };
    }
    
    // Try L2
    const l2Result = await this.l2Cache.query(`
      SELECT data FROM cache WHERE key = $1 AND expires_at > NOW()
    `, [key]);
    
    if (l2Result.rows.length > 0) {
      // Promote to L1
      await this.l1Cache.setex(key, 3600, JSON.stringify(l2Result.rows[0].data));
      return { data: l2Result.rows[0].data, source: 'L2', latency: 15 };
    }
    
    return null;
  }
  
  async set(key: string, value: any, ttl: number) {
    // Write to both L1 and L2
    await Promise.all([
      this.l1Cache.setex(key, ttl, JSON.stringify(value)),
      this.l2Cache.query(`
        INSERT INTO cache (key, data, expires_at)
        VALUES ($1, $2, NOW() + INTERVAL '${ttl} seconds')
        ON CONFLICT (key) DO UPDATE SET data = $2, expires_at = NOW() + INTERVAL '${ttl} seconds'
      `, [key, value])
    ]);
  }
}
```

### **Batch Operations**

```typescript
// Batch embedding generation
async function batchGenerateEmbeddings(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 100;
  const embeddings: number[][] = [];
  
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = await openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: batch
    });
    embeddings.push(...batchEmbeddings.data.map(e => e.embedding));
  }
  
  return embeddings;
}

// Batch Qdrant upsert
async function batchIndexToQdrant(messages: Message[], embeddings: number[][]) {
  const BATCH_SIZE = 100;
  
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = embeddings.slice(i, i + BATCH_SIZE);
    
    await qdrantClient.upsert('chatbot_memory', {
      points: batch.map((msg, idx) => ({
        id: msg.id,
        vector: batchEmbeddings[idx],
        payload: {
          userId: msg.userId,
          conversationId: msg.conversationId,
          timestamp: msg.timestamp,
          content: msg.content
        }
      }))
    });
  }
}
```

### **Query Optimization**

```sql
-- PostgreSQL indexes for common queries
CREATE INDEX CONCURRENTLY idx_messages_conversation_time 
  ON messages(conversation_id, created_at DESC);

CREATE INDEX CONCURRENTLY idx_messages_user_time 
  ON messages(user_id, created_at DESC)
  WHERE role = 'user';

-- Partial index for recent messages (hot path)
CREATE INDEX CONCURRENTLY idx_messages_recent 
  ON messages(created_at DESC)
  WHERE created_at > NOW() - INTERVAL '7 days';

-- GIN index for JSONB metadata queries
CREATE INDEX CONCURRENTLY idx_messages_metadata_gin 
  ON messages USING GIN (metadata jsonb_path_ops);
```

```cypher
// Neo4j indexes and constraints
CREATE CONSTRAINT entity_name_unique IF NOT EXISTS
  FOR (e:Entity) REQUIRE e.name IS UNIQUE;

CREATE INDEX entity_last_mentioned IF NOT EXISTS
  FOR (e:Entity) ON (e.lastMentioned);

CREATE INDEX message_timestamp IF NOT EXISTS
  FOR (m:Message) ON (m.timestamp);

// Vector index for similarity search
CREATE VECTOR INDEX message_embedding_index IF NOT EXISTS
  FOR (m:Message) ON (m.embedding)
  OPTIONS {indexConfig: {
    `vector.dimensions`: 1536,
    `vector.similarity_function`: 'cosine'
  }};
```

---

## Monitoring & Observability

### **Key Metrics to Track**

```typescript
// OpenTelemetry instrumentation
const metrics = {
  // Latency metrics
  'memory.l1.latency': histogram({ unit: 'ms', description: 'L1 Redis latency' }),
  'memory.l2.latency': histogram({ unit: 'ms', description: 'L2 PostgreSQL latency' }),
  'memory.l3.latency': histogram({ unit: 'ms', description: 'L3 Neo4j latency' }),
  'memory.l4.latency': histogram({ unit: 'ms', description: 'L4 Qdrant latency' }),
  
  // Hit rates
  'memory.l1.hit_rate': gauge({ unit: '%', description: 'L1 cache hit rate' }),
  'memory.l2.hit_rate': gauge({ unit: '%', description: 'L2 cache hit rate' }),
  
  // Storage metrics
  'memory.redis.memory_usage': gauge({ unit: 'bytes' }),
  'memory.postgresql.size': gauge({ unit: 'bytes' }),
  'memory.neo4j.nodes': gauge({ unit: 'count' }),
  'memory.qdrant.vectors': gauge({ unit: 'count' }),
  
  // Quality metrics
  'memory.retrieval.relevance_score': histogram({ unit: 'score' }),
  'memory.embedding.similarity': histogram({ unit: 'score' }),
  
  // Operational metrics
  'memory.archival.messages_per_day': counter({ unit: 'messages' }),
  'memory.summarization.duration': histogram({ unit: 'ms' })
};
```

### **Grafana Dashboards**

```
Memory System Health Dashboard:
├─ L1 Redis Panel
│  ├─ Hit Rate (target: >80%)
│  ├─ P50/P95/P99 Latency (target: <5ms)
│  └─ Memory Usage
├─ L2 PostgreSQL Panel
│  ├─ Query Latency (target: <50ms)
│  ├─ Connection Pool Saturation
│  └─ Active Conversations
├─ L3 Neo4j Panel
│  ├─ Graph Size (nodes, relationships)
│  ├─ Query Latency (target: <100ms)
│  └─ Entity Resolution Rate
└─ L4 Qdrant Panel
   ├─ Vector Count
   ├─ Search Latency (target: <20ms)
   └─ Memory Usage with Quantization
```

---

## Cost Analysis

### **Estimated Monthly Costs (10K Active Users, 1M Messages/Month)**

| Component | Resources | Monthly Cost |
|-----------|-----------|--------------|
| **Redis (L1)** | 8GB cluster | $50 |
| **PostgreSQL (L2)** | 100GB storage, 4vCPU | $150 |
| **Neo4j (L3)** | 50GB storage, 4vCPU | $200 |
| **Qdrant (L4)** | 50GB vectors (quantized), 8vCPU | $300 |
| **S3 (Archive)** | 500GB Standard-IA | $15 |
| **Embeddings API** | 1M messages @ $0.0001/1K tokens | $100 |
| **Bandwidth** | Data transfer | $50 |
| **Total** | | **~$865/month** |

**Scaling to 100K Users:**
- Redis: Scale to 32GB cluster (~$200)
- PostgreSQL: Scale to 500GB, 16vCPU (~$600)
- Neo4j: Scale to 200GB, 16vCPU (~$800)
- Qdrant: Scale to 200GB, 32vCPU (~$1,200)
- S3: Scale to 5TB (~$150)
- **Total: ~$3,350/month**

**Cost Optimization Tips:**
1. Use Qdrant quantization (reduce memory 4-16x)
2. Aggressive archival policies (move to Glacier after 1 year)
3. Lazy embedding generation (only embed when needed)
4. Connection pooling for PostgreSQL and Neo4j
5. Read replicas for PostgreSQL/Neo4j if read-heavy

---

## Migration & Deployment Strategy

### **Phase 1: Foundation (Week 1-2)**
- Set up PostgreSQL with pgvector
- Implement basic Redis caching
- Deploy simple message storage

### **Phase 2: Vector Search (Week 3-4)**
- Deploy Qdrant cluster
- Implement embedding pipeline
- Add semantic search capability

### **Phase 3: Knowledge Graph (Week 5-6)**
- Deploy Neo4j
- Implement entity extraction
- Build relationship models

### **Phase 4: Optimization (Week 7-8)**
- Add multi-tier caching
- Implement archival strategies
- Performance tuning

### **Phase 5: Production Hardening (Week 9-12)**
- Load testing
- Disaster recovery setup
- Monitoring and alerting
- Documentation

---

## Testing Strategy

### **Unit Tests**
```typescript
describe('MemorySystem', () => {
  it('should retrieve from L1 cache first', async () => {
    const memory = new MemorySystem();
    await memory.store(message);
    
    const result = await memory.retrieve(query);
    expect(result.source).toBe('L1_REDIS');
    expect(result.latency).toBeLessThan(10);
  });
  
  it('should fall back to L2 on L1 miss', async () => {
    const memory = new MemorySystem();
    await redis.flushall(); // Clear L1
    
    const result = await memory.retrieve(query);
    expect(result.source).toBe('L2_POSTGRESQL');
  });
});
```

### **Integration Tests**
```typescript
describe('End-to-End Memory Flow', () => {
  it('should handle full write-read cycle', async () => {
    // Write
    await handleIncomingMessage(testMessage);
    
    // Wait for async processing
    await sleep(1000);
    
    // Read
    const context = await retrieveContext(testQuery, conversationId, userId);
    
    expect(context.messages).toContainEqual(
      expect.objectContaining({ id: testMessage.id })
    );
  });
});
```

### **Load Tests**
```typescript
// Using k6 for load testing
import http from 'k6/http';
import { check, sleep } from 'k6';

export let options = {
  stages: [
    { duration: '5m', target: 100 }, // Ramp to 100 users
    { duration: '10m', target: 100 }, // Stay at 100
    { duration: '5m', target: 0 }, // Ramp down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'], // 95% of requests <500ms
    'http_req_failed': ['rate<0.01'], // <1% failure rate
  },
};

export default function() {
  const payload = JSON.stringify({
    query: 'How do I handle relapse triggers?',
    conversationId: 'test-conv-123',
    userId: 'test-user-456'
  });
  
  const res = http.post('http://localhost:3333/api/memory/retrieve', payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 500ms': (r) => r.timings.duration < 500,
    'has messages': (r) => JSON.parse(r.body).messages.length > 0,
  });
  
  sleep(1);
}
```

---

## Security Considerations

### **Data Encryption**
```typescript
// At-rest encryption
- PostgreSQL: Enable TDE (Transparent Data Encryption)
- Redis: Use encryption module (redis-encryption)
- Neo4j: Enable at-rest encryption in enterprise edition
- Qdrant: Use encrypted volumes
- S3: Enable SSE-S3 or SSE-KMS

// In-transit encryption
- All connections use TLS 1.3
- Certificate rotation every 90 days
- Mutual TLS for service-to-service
```

### **Access Control**
```typescript
// Role-based access
const roles = {
  CHATBOT_SERVICE: {
    redis: ['READ', 'WRITE'],
    postgresql: ['READ', 'WRITE'],
    neo4j: ['READ', 'WRITE'],
    qdrant: ['READ', 'WRITE'],
    s3: ['WRITE']
  },
  ANALYTICS_SERVICE: {
    postgresql: ['READ'],
    neo4j: ['READ'],
    s3: ['READ']
  },
  ADMIN: {
    all: ['READ', 'WRITE', 'DELETE']
  }
};
```

### **PII Handling**
```typescript
// Anonymization pipeline
async function anonymizeForAnalytics(message: Message) {
  const anonymized = { ...message };
  
  // Detect and redact PII
  anonymized.content = await detectAndRedactPII(message.content, {
    entities: ['PERSON', 'PHONE_NUMBER', 'EMAIL', 'SSN', 'ADDRESS']
  });
  
  // Hash user ID
  anonymized.userId = crypto
    .createHash('sha256')
    .update(message.userId + SALT)
    .digest('hex');
  
  return anonymized;
}
```

---

## Future Enhancements

### **Advanced Features Roadmap**

1. **Multi-Modal Memory (Q3 2025)**
   - Store image, audio, video embeddings
   - Cross-modal retrieval (text query → find images)
   - Implement CLIP-like embeddings

2. **Federated Memory (Q4 2025)**
   - Share knowledge across users (with consent)
   - Collective intelligence from anonymized data
   - Privacy-preserving federated learning

3. **Temporal Reasoning (Q1 2026)**
   - Time-series analysis of entity evolution
   - Predict user needs based on historical patterns
   - Seasonal pattern detection

4. **Explainable Memory (Q2 2026)**
   - Show users why certain memories were retrieved
   - Visualize knowledge graph connections
   - Memory provenance tracking

5. **Memory Consolidation (Q3 2026)**
   - Sleep-inspired memory consolidation
   - Identify and strengthen important patterns
   - Forget irrelevant details automatically

---

## Conclusion

This memory architecture provides:

✅ **Sub-10ms latency** for active conversations (Redis L1)  
✅ **Semantic search** across all history (Qdrant L4)  
✅ **Relationship intelligence** (Neo4j L3)  
✅ **SQL queryability** (PostgreSQL L2)  
✅ **Infinite scalability** (S3 archive)  
✅ **Cost efficiency** (~$865/month for 10K users)  
✅ **Open source** (no vendor lock-in)  

**Key Design Principles:**
1. **Layered Caching**: Hot data in Redis, warm in PostgreSQL, cold in S3
2. **Hybrid Search**: Combine vector similarity (Qdrant) with graph relationships (Neo4j)
3. **Temporal Awareness**: Track entity evolution and relationship dynamics over time
4. **Fail-Safe Design**: Graceful degradation if any tier fails
5. **Observable**: Every layer instrumented with metrics and traces

This is a **production-ready** architecture that can scale from prototype to enterprise.

---

## References

- Zep: A Temporal Knowledge Graph Architecture for Agent Memory (2025)
- Graphiti: Building AI Agents with Knowledge Graph Memory (2024)
- MemGPT: Towards LLMs as Operating Systems (2023)
- Comparing Memory Systems for LLM Agents (MarkTechPost, 2025)
- Layered Memory Architecture for Intelligent AI Agents (2025)
- Vector Database Comparison Studies (2024-2025)
- PostgreSQL pgvector Documentation
- Neo4j Vector Search Documentation
- Qdrant Documentation
- Redis Memory Optimization Guide

---

**Next Steps:**
1. Review this architecture with your team
2. Prioritize features based on your RecoverySky use case
3. Start with Phase 1 (Foundation) - PostgreSQL + Redis
4. Iterate and add layers based on performance needs
5. Monitor and optimize based on real usage patterns

Would you like me to drill deeper into any specific component?
