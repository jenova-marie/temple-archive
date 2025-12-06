# Context Flow: How Agent "Remembers" the User

## The Context Assembly Process

```
┌─────────────────────────────────────────────────────────────┐
│                    USER SENDS MESSAGE                       │
│              "I'm feeling anxious today"                    │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 1. LOAD SESSION CONTEXT                     │
│                    (from Redis L1)                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
                    [Cache Hit?]
                    /          \
                 YES            NO
                  │              │
                  │              ▼
                  │     ┌────────────────────────┐
                  │     │ 2a. LOAD FROM L2       │
                  │     │ (PostgreSQL)           │
                  │     │                        │
                  │     │ • User profile         │
                  │     │ • Recent messages      │
                  │     │ • Preferences          │
                  │     │ • Session summaries    │
                  │     └───────────┬────────────┘
                  │                 │
                  │                 ▼
                  │     ┌────────────────────────┐
                  │     │ 2b. ENRICH FROM L3/L4  │
                  │     │ (Optional - if needed) │
                  │     │                        │
                  │     │ Neo4j: Get related     │
                  │     │   entities & patterns  │
                  │     │ Qdrant: Semantic       │
                  │     │   search if relevant   │
                  │     └───────────┬────────────┘
                  │                 │
                  │                 ▼
                  │     ┌────────────────────────┐
                  │     │ 2c. WARM L1 CACHE      │
                  │     │ Store in Redis         │
                  │     └───────────┬────────────┘
                  │                 │
                  └────────┬────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│            3. ASSEMBLED CONTEXT STRUCTURE                   │
│                                                             │
│  {                                                          │
│    messages: [                                              │
│      { role: 'user', content: 'How do I cope?', ... },    │
│      { role: 'assistant', content: 'Try...', ... },       │
│      { role: 'user', content: "I'm anxious", ... }        │
│    ],                                                       │
│                                                             │
│    userProfile: {                                           │
│      recoveryPhase: 'early',                               │
│      sobrietyDate: '2024-11-15',                           │
│      triggers: ['stress', 'social situations'],            │
│      copingStrategies: ['deep breathing', 'calling sponsor']│
│    },                                                       │
│                                                             │
│    sessionEntities: {                                       │
│      emotions: ['anxious', 'stressed'],                    │
│      people: ['sponsor John'],                             │
│      events: ['job interview tomorrow']                    │
│    },                                                       │
│                                                             │
│    sessionState: {                                          │
│      currentTopic: 'anxiety management',                   │
│      crisisLevel: 4,                                       │
│      conversationGoal: 'seeking coping strategies'         │
│    },                                                       │
│                                                             │
│    previousSessionsSummary: {                              │
│      lastWeekTopics: ['relapse concerns', 'family'],      │
│      recurringConcerns: ['anxiety', 'insomnia']           │
│    }                                                        │
│  }                                                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         4. GENERATE AI RESPONSE WITH FULL CONTEXT          │
│                                                             │
│  System Prompt:                                             │
│  "You are a compassionate recovery assistant.              │
│   User context:                                             │
│   - Name: Sarah                                             │
│   - Recovery phase: Early (2 weeks sober)                  │
│   - Known triggers: stress, social situations              │
│   - Current emotion: anxious                               │
│   - Upcoming: job interview tomorrow                       │
│   - Previous topics: relapse concerns, family issues       │
│   - Preferred strategies: deep breathing, sponsor contact  │
│                                                             │
│   Respond with empathy, suggest relevant coping strategies."│
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         5. EXTRACT NEW INFORMATION FROM EXCHANGE           │
│                                                             │
│  User: "I'm anxious about my job interview tomorrow"       │
│  Assistant: "I understand... try calling your sponsor..."  │
│                                                             │
│  Extracted:                                                 │
│  • Entity: "job interview" (event, tomorrow)               │
│  • Emotion: "anxious" (current state)                      │
│  • Context: work-related anxiety                           │
│  • Crisis level: 4/10 (elevated but not critical)          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              6. UPDATE CONTEXT IN L1 (Redis)               │
│                    EPHEMERAL UPDATES                        │
│                                                             │
│  • Add new messages to conversation history                 │
│  • Update sessionEntities with "job interview"             │
│  • Update sessionState.crisisLevel = 4                     │
│  • Update sessionState.currentTopic = "work anxiety"       │
│  • Update sessionState.lastActivity = NOW()                │
│  • Increment sessionState.messageCount                     │
│                                                             │
│  TTL: 4 hours (auto-expires if inactive)                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         7. PERSIST IMPORTANT DATA TO L2 (PostgreSQL)       │
│                    ASYNC - NON-BLOCKING                     │
│                                                             │
│  messages table:                                            │
│    INSERT new user message                                  │
│    INSERT new assistant message                             │
│                                                             │
│  user_memory table:                                         │
│    UPDATE SET                                               │
│      last_emotion = 'anxious',                             │
│      last_activity = NOW()                                  │
│                                                             │
│  events table: (if schema exists)                           │
│    INSERT 'job interview' event for tomorrow               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         8. UPDATE KNOWLEDGE GRAPH (L3 - Neo4j)             │
│                    ASYNC - BACKGROUND                       │
│                                                             │
│  Create/Update nodes:                                       │
│    (:Message {content: "I'm anxious...", timestamp: ...})  │
│    (:Event {name: "job interview", date: tomorrow})        │
│    (:Emotion {name: "anxiety", intensity: 4})              │
│                                                             │
│  Create relationships:                                      │
│    (Message)-[:MENTIONS]->(Event)                          │
│    (Message)-[:EXPRESSES]->(Emotion)                       │
│    (User)-[:EXPERIENCED]->(Emotion)-[:AT_TIME]->(NOW)      │
│    (Event)-[:CAUSES]->(Emotion)                            │
│                                                             │
│  Update entity co-occurrences:                              │
│    (Anxiety)-[:RELATES_TO]->(JobInterview)                 │
│      strength += 1                                          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         9. INDEX IN VECTOR STORE (L4 - Qdrant)             │
│                    ASYNC - BACKGROUND                       │
│                                                             │
│  Generate embeddings:                                       │
│    user_msg_embedding = embed("I'm anxious today...")      │
│    assistant_msg_embedding = embed("I understand...")      │
│                                                             │
│  Upsert to Qdrant:                                          │
│    {                                                        │
│      id: msg_id,                                            │
│      vector: [0.234, -0.123, ...],                         │
│      payload: {                                             │
│        userId: 'user_123',                                  │
│        content: "I'm anxious...",                          │
│        entities: ['job interview', 'anxiety'],             │
│        crisisLevel: 4,                                      │
│        timestamp: NOW()                                     │
│      }                                                      │
│    }                                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation: Context Assembly

```typescript
// lib/context/context-assembler.ts

interface AssembledContext {
  // Core conversation
  messages: Message[];
  
  // User identity and state
  userProfile: UserProfile;
  
  // Session-specific extractions
  sessionEntities: SessionEntities;
  sessionState: SessionState;
  
  // Historical context
  previousSessions: SessionSummary[];
  
  // Real-time tracking
  tracking: TrackingData;
}

export class ContextAssembler {
  private l1: L1RedisMemory;
  private l2: L2PostgreSQLMemory;
  private l3: L3Neo4jMemory;
  private l4: L4QdrantMemory;
  
  /**
   * Assemble full context for a conversation turn
   */
  async assembleContext(
    conversationId: string,
    userId: string,
    options: {
      includeHistory?: boolean;
      includeSemanticSearch?: boolean;
      searchQuery?: string;
    } = {}
  ): Promise<AssembledContext> {
    const startTime = Date.now();
    
    // STEP 1: Try to get from L1 cache (Redis)
    const cachedContext = await this.l1.getFullContext(conversationId);
    
    if (cachedContext && this.isContextFresh(cachedContext)) {
      console.log(`✓ Context from L1 cache (${Date.now() - startTime}ms)`);
      return cachedContext;
    }
    
    // STEP 2: Build context from scratch
    console.log('⚠ Cache miss - building context from L2/L3/L4');
    
    const [
      recentMessages,
      userProfile,
      sessionSummaries,
      semanticResults
    ] = await Promise.all([
      // Recent conversation messages
      this.l2.getConversationHistory(conversationId, 20),
      
      // User profile (cached in Redis after first load)
      this.l1.getUserPreferences(userId) || 
        await this.l2.getUserMemory(userId),
      
      // Previous session summaries (if requested)
      options.includeHistory 
        ? this.l2.getSessionSummaries(conversationId, 5)
        : [],
      
      // Semantic search (if query provided)
      options.includeSemanticSearch && options.searchQuery
        ? this.l4.semanticSearch(
            await generateEmbedding(options.searchQuery),
            { userId, limit: 5 }
          )
        : []
    ]);
    
    // STEP 3: Extract session-level entities
    const sessionEntities = await this.extractSessionEntities(recentMessages);
    
    // STEP 4: Build session state
    const sessionState = await this.buildSessionState(
      conversationId,
      recentMessages,
      sessionEntities
    );
    
    // STEP 5: Get tracking data
    const tracking = await this.getTrackingData(userId);
    
    // STEP 6: Assemble full context
    const context: AssembledContext = {
      messages: recentMessages,
      userProfile,
      sessionEntities,
      sessionState,
      previousSessions: sessionSummaries,
      tracking,
    };
    
    // STEP 7: Cache in L1 (Redis) for fast access
    await this.l1.cacheFullContext(conversationId, context, 3600); // 1 hour TTL
    
    console.log(`✓ Context assembled in ${Date.now() - startTime}ms`);
    
    return context;
  }
  
  /**
   * Extract entities from recent messages
   */
  private async extractSessionEntities(
    messages: Message[]
  ): Promise<SessionEntities> {
    // Could use LLM for extraction or regex patterns
    const entities: SessionEntities = {
      people: [],
      places: [],
      events: [],
      emotions: [],
      medications: [],
    };
    
    for (const msg of messages) {
      // Simple extraction (in production, use NER model)
      const text = msg.content.toLowerCase();
      
      // Emotions
      const emotions = ['anxious', 'stressed', 'depressed', 'happy', 'calm'];
      for (const emotion of emotions) {
        if (text.includes(emotion)) {
          entities.emotions.push(emotion);
        }
      }
      
      // Events (simple pattern matching)
      if (text.match(/interview|meeting|appointment/)) {
        entities.events.push(msg.content.match(/\b\w+(?:\s+\w+){0,4}\b/)?.[0] || '');
      }
    }
    
    return entities;
  }
  
  /**
   * Build current session state
   */
  private async buildSessionState(
    conversationId: string,
    messages: Message[],
    entities: SessionEntities
  ): Promise<SessionState> {
    // Calculate crisis level based on entities and patterns
    const crisisLevel = this.calculateCrisisLevel(messages, entities);
    
    // Detect current topic
    const currentTopic = await this.detectCurrentTopic(messages);
    
    // Analyze emotional trend
    const emotionalTrend = this.analyzeEmotionalTrend(entities.emotions);
    
    return {
      startTime: messages[0]?.timestamp || Date.now(),
      lastActivity: messages[messages.length - 1]?.timestamp || Date.now(),
      messageCount: messages.length,
      currentTopic,
      crisisLevel,
      emotionalTrend,
      conversationGoal: await this.inferConversationGoal(messages),
    };
  }
  
  /**
   * Check if cached context is still fresh
   */
  private isContextFresh(context: AssembledContext): boolean {
    const AGE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
    const age = Date.now() - context.sessionState.lastActivity;
    return age < AGE_THRESHOLD;
  }
  
  // ... other helper methods
}
```

---

## Context Update Flow

```typescript
// lib/context/context-updater.ts

export class ContextUpdater {
  /**
   * Update context after each conversation turn
   */
  async updateContext(
    conversationId: string,
    userId: string,
    newMessage: Message,
    aiResponse: Message,
    extractedData: {
      entities?: string[];
      emotions?: string[];
      crisisLevel?: number;
      facts?: string[];
    }
  ): Promise<void> {
    // IMMEDIATE: Update L1 (Redis) - synchronous for fast access
    await Promise.all([
      // Add messages to conversation history
      this.l1.storeMessage(newMessage),
      this.l1.storeMessage(aiResponse),
      
      // Update session entities
      this.l1.updateSessionEntities(conversationId, {
        emotions: extractedData.emotions,
        entities: extractedData.entities,
      }),
      
      // Update session state
      this.l1.updateSessionState(conversationId, {
        lastActivity: Date.now(),
        messageCount: await this.l1.incrementMessageCount(conversationId),
        crisisLevel: extractedData.crisisLevel,
      }),
    ]);
    
    // ASYNC: Persist to L2 (PostgreSQL) - non-blocking
    this.persistToL2(conversationId, newMessage, aiResponse, extractedData)
      .catch(err => console.error('L2 persistence error:', err));
    
    // ASYNC: Update L3 (Neo4j) - background
    this.updateKnowledgeGraph(userId, newMessage, extractedData)
      .catch(err => console.error('L3 update error:', err));
    
    // ASYNC: Index in L4 (Qdrant) - background
    this.indexInVectorStore(newMessage, aiResponse)
      .catch(err => console.error('L4 indexing error:', err));
    
    // CONDITIONAL: Trigger summarization if threshold reached
    const messageCount = await this.l1.getMessageCount(conversationId);
    if (messageCount > 0 && messageCount % 10 === 0) {
      this.triggerSummarization(conversationId)
        .catch(err => console.error('Summarization error:', err));
    }
  }
  
  // ... implementation methods
}
```

---

## Putting It All Together: API Endpoint

```typescript
// app/api/chat/route.ts

export async function POST(request: Request) {
  const { userId, conversationId, message } = await request.json();
  
  const contextAssembler = new ContextAssembler();
  const contextUpdater = new ContextUpdater();
  const entityExtractor = new EntityExtractor();
  
  // 1. LOAD CONTEXT (from L1 or build from L2/L3/L4)
  const context = await contextAssembler.assembleContext(
    conversationId,
    userId,
    {
      includeHistory: true,
      includeSemanticSearch: true,
      searchQuery: message,
    }
  );
  
  // 2. GENERATE AI RESPONSE with full context
  const aiResponse = await generateAIResponse(message, context);
  
  // 3. EXTRACT NEW INFORMATION
  const extractedData = await entityExtractor.extract(message, aiResponse);
  
  // 4. UPDATE CONTEXT across all tiers
  await contextUpdater.updateContext(
    conversationId,
    userId,
    { id: uuidv4(), conversationId, userId, role: 'user', content: message, timestamp: Date.now() },
    { id: uuidv4(), conversationId, userId, role: 'assistant', content: aiResponse, timestamp: Date.now() },
    extractedData
  );
  
  return Response.json({
    response: aiResponse,
    context: {
      messagesInContext: context.messages.length,
      userPhase: context.userProfile.recoveryPhase,
      crisisLevel: context.sessionState.crisisLevel,
      currentTopic: context.sessionState.currentTopic,
    }
  });
}
```

---

## Key Takeaways

✅ **Context is RICH** - not just messages, but user profile, entities, state, history

✅ **Context lives in REDIS** - API fetches it on each request (stateless API)

✅ **Context is ASSEMBLED** - pulled from multiple tiers (L1→L2→L3→L4)

✅ **Context is UPDATED** - extracted info updates Redis immediately, persisted async

✅ **Context has TTL** - expires after inactivity, rebuilt on next request

✅ **Agent "remembers"** - by loading user profile, past summaries, and entities

This is what makes your chatbot truly intelligent! 🧠
