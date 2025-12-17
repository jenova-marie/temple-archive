# RecoverySky Agent Architecture

## System Overview

RecoverySky Agent is an AI-powered conversational companion designed to support individuals in addiction recovery. The system uses a **pipeline-based architecture** with **multi-tier memory**, **real-time crisis detection**, and **safety-first response generation**.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RECOVERYSKY AGENT                                 │
│                                                                             │
│  ┌─────────┐    ┌──────────────────────────────────────────────────────┐   │
│  │   CLI   │───▶│                    API SERVER                        │   │
│  └─────────┘    │  ┌────────────────────────────────────────────────┐  │   │
│                 │  │               PIPELINE ORCHESTRATOR             │  │   │
│  ┌─────────┐    │  │  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  │  │   │
│  │   WEB   │───▶│  │  │CRISIS│─▶│MEMORY│─▶│AGENT│─▶│SAFETY│─▶│STORE│  │  │   │
│  └─────────┘    │  │  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘  │  │   │
│                 │  └────────────────────────────────────────────────┘  │   │
│                 └──────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        MEMORY TIERS                                   │  │
│  │  ┌─────────┐  ┌─────────────┐  ┌──────────┐  ┌───────────────────┐   │  │
│  │  │L1 REDIS │  │L2 POSTGRESQL│  │ L3 NEO4J │  │    L4 QDRANT      │   │  │
│  │  │  <10ms  │  │  + pgvector │  │ (future) │  │  semantic search  │   │  │
│  │  └─────────┘  └─────────────┘  └──────────┘  └───────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Package Dependency Graph

```
                              ┌─────────────┐
                              │  apps/api   │
                              └──────┬──────┘
                                     │
                                     ▼
                         ┌───────────────────────┐
                         │  @recoverysky/pipeline │
                         └───────────┬───────────┘
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
          ▼                          ▼                          ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│@recoverysky/    │      │@recoverysky/    │      │@recoverysky/    │
│    crisis       │      │    memory       │      │    agent        │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         │               ┌────────┴────────┐               │
         │               │                 │               │
         ▼               ▼                 ▼               ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│@recoverysky/    │  │@recoverysky/    │  │@recoverysky/    │
│    safety       │  │  evaluation     │  │    tools        │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │@recoverysky/        │
                   │   observability     │
                   └──────────┬──────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │  @recoverysky/types │
                   └─────────────────────┘
```

---

## Pipeline Flow

The pipeline processes each user message through 6 sequential stages:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MESSAGE PROCESSING PIPELINE                          │
└─────────────────────────────────────────────────────────────────────────────┘

   USER MESSAGE
        │
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  STAGE 1: CRISIS CHECK                                        Target: <10ms│
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │  • Pattern matching against 9 crisis categories                      │  │
│  │  • Confidence scoring with boost/dampener keywords                   │  │
│  │  • Level calculation (1-10 scale)                                    │  │
│  │                                                                       │  │
│  │  Levels 9-10: EMERGENCY → Short-circuit to crisis response           │  │
│  │  Levels 7-8:  HIGH      → Inject crisis resources                    │  │
│  │  Levels 4-6:  ELEVATED  → Monitor, adjust tone                       │  │
│  │  Levels 1-3:  NORMAL    → Continue standard flow                     │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
        │
        │ (if level < 9)
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  STAGE 2: MEMORY RETRIEVAL                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │   L1 Redis ──▶ MISS ──▶ L2 PostgreSQL ──▶ MISS ──▶ L4 Qdrant        │  │
│  │      │                        │                        │              │  │
│  │      ▼                        ▼                        ▼              │  │
│  │   Session                  Full                    Semantic           │  │
│  │   Messages               History +                 Search             │  │
│  │   (20 msgs)              Profile                  (optional)          │  │
│  │                                                                       │  │
│  │   Result: AssembledContext                                            │  │
│  │   • messages[]                                                        │  │
│  │   • userProfile                                                       │  │
│  │   • sessionState                                                      │  │
│  │   • sessionEntities                                                   │  │
│  │   • previousSessions                                                  │  │
│  │   • semanticMatches                                                   │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  STAGE 3: AGENT PROCESSING                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │   ┌──────────────────────┐       ┌──────────────────────────────┐   │  │
│  │   │  System Prompt       │       │        LLM (Claude)          │   │  │
│  │   │  Builder             │──────▶│                              │   │  │
│  │   │                      │       │  • Sky persona               │   │  │
│  │   │  Sections:           │       │  • Recovery-focused          │   │  │
│  │   │  1. Base identity    │       │  • Context-aware             │   │  │
│  │   │  2. User context     │       │  • Crisis-adjusted tone      │   │  │
│  │   │  3. Session context  │       │                              │   │  │
│  │   │  4. Crisis adjust    │       └──────────────────────────────┘   │  │
│  │   │  5. Guidelines       │                    │                      │  │
│  │   │  6. Tool usage       │                    ▼                      │  │
│  │   │  7. Safety bounds    │             Agent Response                │  │
│  │   └──────────────────────┘                                           │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  STAGE 4: PARALLEL VALIDATION                                              │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐ │
│  │        SAFETY CHECK             │  │         EVALUATION              │ │
│  │                                 │  │                                 │ │
│  │  • Content policy              │  │  • Quality score                │ │
│  │  • Recovery appropriateness    │  │  • Empathy score                │ │
│  │  • No enablement check         │  │  • Recovery score               │ │
│  │  • Resource accuracy           │  │  • Relevance score              │ │
│  │                                 │  │                                 │ │
│  │  Output: SafetyValidationResult │  │  Output: EvaluationResult       │ │
│  │  • passed: boolean              │  │  • overallScore: 0-1           │ │
│  │  • violations[]                 │  │  • feedback?: string           │ │
│  │  • sanitizedOutput?             │  │                                 │ │
│  └─────────────────────────────────┘  └─────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│  STAGE 5: PERSIST + RESPOND                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │                                                                       │  │
│  │   Store to Memory Tiers (async):                                      │  │
│  │   • L1: Update session cache                                          │  │
│  │   • L2: Persist messages + update user profile                        │  │
│  │   • L4: Index embeddings for semantic search                          │  │
│  │                                                                       │  │
│  │   Return to User:                                                     │  │
│  │   • response: string                                                  │  │
│  │   • crisisLevel: number                                               │  │
│  │   • emergencyTriggered: boolean                                       │  │
│  │   • metrics: { totalDuration, memorySource }                          │  │
│  │                                                                       │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ▼
   RESPONSE TO USER
```

---

## Memory Architecture

### Four-Tier Memory System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MEMORY HIERARCHY                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  L1: REDIS                                              Latency: <10ms      │
│  ═══════════                                            TTL: 4 hours        │
│                                                                             │
│  Purpose: Hot session cache for active conversations                        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  session:{conversationId}:messages → SortedSet<Message>             │   │
│  │  session:{conversationId}:state    → Hash { userId, lastActivity }  │   │
│  │  user:{userId}:preferences         → Hash { tone, topics }          │   │
│  │  session:{conversationId}:entities → Hash { extracted entities }    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Operations:                                                                │
│  • getRecentMessages(conversationId, limit)                                 │
│  • warmCache(conversationId, messages)                                      │
│  • updateSessionState(conversationId, state)                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     │ MISS
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  L2: POSTGRESQL + pgvector                              Latency: 10-50ms    │
│  ═════════════════════════                              Retention: 90 days  │
│                                                                             │
│  Purpose: Persistent conversation history + user profiles                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Tables:                                                             │   │
│  │                                                                       │   │
│  │  conversations │ conversation_id, user_id, created_at, summary       │   │
│  │  messages      │ message_id, conversation_id, role, content,         │   │
│  │                │ embedding vector(1536), timestamp                   │   │
│  │  user_memory   │ user_id, recovery_phase, triggers[], coping[],      │   │
│  │                │ preferences, milestones                             │   │
│  │  summaries     │ summary_id, conversation_id, summary_text,          │   │
│  │                │ key_topics[], embedding                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Operations:                                                                │
│  • getConversationHistory(conversationId, limit)                            │
│  • getUserProfile(userId)                                                   │
│  • persistMessage(message)                                                  │
│  • updateUserProfile(userId, updates)                                       │
│  • hybridSearch(embedding, userId, filters)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
                    ▼                                 ▼
┌────────────────────────────────────┐  ┌────────────────────────────────────┐
│  L3: NEO4J (Future)                │  │  L4: QDRANT                        │
│  ═════════════════                 │  │  ═══════════                       │
│  Latency: 20-100ms                 │  │  Latency: 5-20ms                   │
│                                    │  │                                    │
│  Purpose: Knowledge graph for      │  │  Purpose: Semantic similarity      │
│  entity relationships              │  │  search across all history         │
│                                    │  │                                    │
│  ┌──────────────────────────────┐ │  │  ┌──────────────────────────────┐  │
│  │  Nodes:                      │ │  │  │  Collection: messages         │  │
│  │  • (:User)                   │ │  │  │                               │  │
│  │  • (:Message)                │ │  │  │  Vector: embedding[1536]      │  │
│  │  • (:Entity)                 │ │  │  │                               │  │
│  │  • (:Emotion)                │ │  │  │  Payload:                     │  │
│  │  • (:Event)                  │ │  │  │  • userId                     │  │
│  │                              │ │  │  │  • conversationId             │  │
│  │  Relationships:              │ │  │  │  • content                    │  │
│  │  • (User)-[:EXPERIENCED]->   │ │  │  │  • role                       │  │
│  │  • (Message)-[:MENTIONS]->   │ │  │  │  • timestamp                  │  │
│  │  • (Entity)-[:RELATES_TO]->  │ │  │  │  • entities[]                 │  │
│  │                              │ │  │  │  • crisisLevel                │  │
│  └──────────────────────────────┘ │  │  └──────────────────────────────┘  │
│                                    │  │                                    │
│  Operations:                       │  │  Operations:                       │
│  • getRelatedEntities()            │  │  • semanticSearch(embedding, k)    │
│  • findPatterns()                  │  │  • upsertVector(id, embedding)     │
│  • temporalQuery()                 │  │  • filterByUser(userId)            │
└────────────────────────────────────┘  └────────────────────────────────────┘
```

### Context Assembly

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ASSEMBLED CONTEXT STRUCTURE                          │
└─────────────────────────────────────────────────────────────────────────────┘

{
  messages: [                           // Recent conversation history
    { role: 'user', content: '...', timestamp: ... },
    { role: 'assistant', content: '...', timestamp: ... },
    ...
  ],

  userProfile: {                        // Long-term user understanding
    userId: 'user_123',
    recoveryPhase: 'early' | 'middle' | 'maintenance',
    sobrietyDate: '2024-11-15',
    triggers: ['stress', 'social situations', 'loneliness'],
    copingStrategies: ['deep breathing', 'calling sponsor', 'exercise'],
    preferences: {
      tone: 'supportive' | 'direct' | 'gentle',
      topics: ['anxiety', 'relationships'],
    },
    milestones: [...],
  },

  sessionState: {                       // Current session context
    currentTopic: 'anxiety management',
    conversationGoal: 'seeking coping strategies',
    crisisLevel: 4,
    lastActivity: 1234567890,
    messageCount: 12,
  },

  sessionEntities: {                    // Extracted from current session
    emotions: ['anxious', 'hopeful'],
    people: ['sponsor John', 'sister Mary'],
    events: ['job interview tomorrow'],
    places: ['AA meeting'],
  },

  previousSessions: {                   // Summary of past interactions
    lastWeekTopics: ['relapse concerns', 'family dynamics'],
    recurringConcerns: ['anxiety', 'insomnia', 'work stress'],
    effectiveInterventions: ['breathing exercises', 'grounding'],
  },

  semanticMatches: [                    // Relevant past messages (from L4)
    { content: '...', similarity: 0.92, timestamp: ... },
    ...
  ],
}
```

---

## Crisis Detection System

### Crisis Levels & Actions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          CRISIS LEVEL MATRIX                                │
└─────────────────────────────────────────────────────────────────────────────┘

  Level │ Category │ Example Patterns           │ System Response
 ═══════╪══════════╪════════════════════════════╪════════════════════════════
   10   │ CRITICAL │ Active suicide plan        │ EMERGENCY PROTOCOL
    9   │ CRITICAL │ Suicidal ideation,         │ • Short-circuit pipeline
        │          │ overdose risk, violence    │ • Immediate crisis response
        │          │                            │ • Hotline numbers included
 ───────┼──────────┼────────────────────────────┼────────────────────────────
    8   │ HIGH     │ Active relapse             │ INJECT RESOURCES
    7   │ HIGH     │ Imminent relapse risk      │ • Add crisis resources
        │          │                            │ • Heightened monitoring
 ───────┼──────────┼────────────────────────────┼────────────────────────────
    6   │ ELEVATED │ Severe distress            │ MONITOR
    5   │ ELEVATED │ Hopelessness               │ • Adjust response tone
    4   │ ELEVATED │ Isolation indicators       │ • Log for review
 ───────┼──────────┼────────────────────────────┼────────────────────────────
   1-3  │ NORMAL   │ General conversation       │ STANDARD FLOW
        │          │                            │ • Normal processing
```

### Detection Algorithm

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CRISIS DETECTION FLOW (<10ms)                           │
└─────────────────────────────────────────────────────────────────────────────┘

                         INPUT MESSAGE
                              │
                              ▼
                    ┌─────────────────┐
                    │  Normalize to   │
                    │   lowercase     │
                    └────────┬────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │   For each CRISIS_PATTERN:    │◀──────────┐
              │                               │           │
              │   • suicidal_ideation (10)    │           │
              │   • overdose_risk (10)        │           │
              │   • violence_risk (9)         │           │
              │   • self_harm (9)             │           │
              │   • active_relapse (8)        │           │
              │   • imminent_relapse (7)      │           │
              │   • severe_distress (6)       │           │
              │   • hopelessness (5)          │           │
              │   • isolation (4)             │           │
              └───────────────┬───────────────┘           │
                              │                           │
                              ▼                           │
                    ┌─────────────────┐                   │
                    │  Regex match?   │──── NO ──────────►│
                    └────────┬────────┘                   │
                             │                            │
                            YES                           │
                             │                            │
                             ▼                            │
                    ┌─────────────────┐                   │
                    │ Check dampeners │                   │
                    │ (false positive │                   │
                    │  reducers)      │                   │
                    └────────┬────────┘                   │
                             │                            │
                     Has dampener?                        │
                      /        \                          │
                    YES        NO                         │
                     │          │                         │
                     │          ▼                         │
                     │  ┌─────────────────┐               │
                     │  │ Count boost     │               │
                     │  │ keywords        │               │
                     │  └────────┬────────┘               │
                     │           │                        │
                     │           ▼                        │
                     │  ┌─────────────────┐               │
                     │  │ Calculate:      │               │
                     │  │ confidence =    │               │
                     │  │ 0.6 + (boosts   │               │
                     │  │ * 0.1)          │               │
                     │  │                 │               │
                     │  │ level =         │               │
                     │  │ base + boosts/2 │               │
                     │  │ - dampeners     │               │
                     │  └────────┬────────┘               │
                     │           │                        │
                     └─────┬─────┘                        │
                           │                              │
                           ▼                              │
                   Add to detectedPatterns ───────────────┘
                           │
                           ▼
              ┌───────────────────────────────┐
              │  Take highest level across    │
              │  all detected patterns        │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │  Determine action:            │
              │  • >= 9: emergency_protocol   │
              │  • >= 7: inject_resources     │
              │  • >= 4: monitor              │
              │  • else: none                 │
              └───────────────┬───────────────┘
                              │
                              ▼
                    CrisisCheckResult
```

---

## Agent & Response Generation

### System Prompt Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM PROMPT COMPOSITION                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  1. BASE IDENTITY                                                           │
│  ════════════════                                                           │
│  "You are Sky, a compassionate and supportive AI companion for people       │
│   in addiction recovery..."                                                 │
│                                                                             │
│  Core behaviors:                                                            │
│  • Listen with empathy and without judgment                                 │
│  • Support users through their recovery journey                             │
│  • Help identify triggers and develop coping strategies                     │
│  • Never enable substance use                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. USER CONTEXT (from AssembledContext.userProfile)                        │
│  ═════════════════                                                          │
│  ## User Context                                                            │
│  - **Recovery Phase**: early                                                │
│  - **Sobriety**: 23 days (since 2024-11-15)                                 │
│  - **Known Triggers**: stress, social situations                            │
│  - **Effective Coping Strategies**: deep breathing, calling sponsor         │
│  - **Preferred Communication Style**: supportive                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. SESSION CONTEXT (from sessionState + sessionEntities)                   │
│  ═══════════════════                                                        │
│  ## Current Session                                                         │
│  - **Topic**: anxiety management                                            │
│  - **Emotions detected**: anxious, stressed                                 │
│  - **Relevant events**: job interview tomorrow                              │
│  - **Message count**: 8                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. CRISIS INSTRUCTIONS (if crisisLevel >= 4)                               │
│  ══════════════════════                                                     │
│  ## Crisis Response Guidelines                                              │
│                                                                             │
│  Current crisis level: 6 (ELEVATED)                                         │
│  Detected patterns: severe_distress                                         │
│                                                                             │
│  Instructions:                                                              │
│  • Acknowledge feelings explicitly                                          │
│  • Offer concrete coping options                                            │
│  • Gently check on safety if appropriate                                    │
│  • Include relevant resources                                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  5. RECOVERY GUIDELINES                                                     │
│  ═════════════════════                                                      │
│  Guidelines for recovery-appropriate responses:                             │
│  • Celebrate all progress, no matter how small                              │
│  • Avoid triggering language                                                │
│  • Suggest SMART recovery / 12-step concepts when relevant                  │
│  • Encourage professional help for serious concerns                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  6. TOOL INSTRUCTIONS                                                       │
│  ════════════════════                                                       │
│  Available tools:                                                           │
│  • findMeetings: Search for nearby AA/NA/SMART meetings                     │
│  • logMood: Record user's current emotional state                           │
│  • setReminder: Create recovery-related reminders                           │
│  • getCopingStrategy: Suggest evidence-based strategies                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  7. SAFETY BOUNDARIES                                                       │
│  ════════════════════                                                       │
│  Absolute restrictions:                                                     │
│  • Never provide information that could enable substance use                │
│  • Never minimize the dangers of addiction                                  │
│  • Never suggest stopping medication without medical advice                 │
│  • Always encourage professional help for medical/psychiatric concerns      │
│  • Never share content that glorifies substance use                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Safety & Evaluation

### Parallel Validation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PARALLEL SAFETY + EVALUATION                             │
└─────────────────────────────────────────────────────────────────────────────┘

                     Agent Response
                           │
           ┌───────────────┴───────────────┐
           │                               │
           ▼                               ▼
 ┌─────────────────────┐       ┌─────────────────────┐
 │   SAFETY VALIDATOR  │       │     EVALUATOR       │
 │                     │       │                     │
 │ Checks:             │       │ Scores (0-1):       │
 │ • Content policy    │       │ • qualityScore      │
 │ • No enablement     │       │ • empathyScore      │
 │ • Appropriate tone  │       │ • relevanceScore    │
 │ • Resource accuracy │       │ • recoveryScore     │
 │                     │       │                     │
 │ Output:             │       │ Output:             │
 │ {                   │       │ {                   │
 │   passed: boolean   │       │   overallScore: 0.85│
 │   violations: []    │       │   feedback: '...'   │
 │   sanitized?: str   │       │ }                   │
 │ }                   │       │                     │
 └──────────┬──────────┘       └──────────┬──────────┘
            │                             │
            └──────────────┬──────────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │  If safety.passed   │
                │  AND no critical    │
                │  violations:        │
                │                     │
                │  Return response    │
                │  + store + metrics  │
                └─────────────────────┘
```

---

## Observability

### Instrumentation Stack

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       OBSERVABILITY LAYER                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  LOGGING (Pino)                                                             │
│  ══════════════                                                             │
│                                                                             │
│  const logger = getLogger().child({                                         │
│    conversationId,                                                          │
│    userId,                                                                  │
│    requestId: ctx.requestId,                                                │
│  })                                                                         │
│                                                                             │
│  logger.info('Processing message')                                          │
│  logger.warn({ crisisLevel }, 'Elevated crisis detected')                   │
│  logger.error({ error }, 'Pipeline stage failed')                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TRACING (OpenTelemetry)                                                    │
│  ════════════════════════                                                   │
│                                                                             │
│  return withSpan('Pipeline.process', async () => {                          │
│    // Stage 1                                                               │
│    await withSpan('Pipeline.crisisCheck', async () => { ... })              │
│    // Stage 2                                                               │
│    await withSpan('Pipeline.memoryRetrieval', async () => { ... })          │
│    // ...                                                                   │
│  })                                                                         │
│                                                                             │
│  Trace structure:                                                           │
│  ├─ Pipeline.process                                                        │
│  │  ├─ Pipeline.crisisCheck                                                 │
│  │  │  └─ KeywordCrisisDetector.detect                                      │
│  │  ├─ Pipeline.memoryRetrieval                                             │
│  │  │  ├─ MemoryOrchestrator.retrieveContext                                │
│  │  │  │  ├─ L1.getRecentMessages                                           │
│  │  │  │  └─ L2.getConversationHistory                                      │
│  │  ├─ Pipeline.agentProcessing                                             │
│  │  │  └─ AgentProvider.generate                                            │
│  │  └─ Pipeline.persist                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  METRICS (Prometheus)                                                       │
│  ════════════════════                                                       │
│                                                                             │
│  pipelineMetrics.stageDuration.record(duration, { stage: 'crisis_check' })  │
│  pipelineMetrics.crisisLevel.record(level, { action: 'monitor' })           │
│  pipelineMetrics.memorySource.add(1, { source: 'L1_REDIS' })                │
│  pipelineMetrics.errors.add(1, { error_kind: 'MemoryError' })               │
│                                                                             │
│  Exposed at: GET /health/metrics                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API Surface

### Endpoints

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            API ENDPOINTS                                    │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  POST /api/chat                                                             │
│  ══════════════                                                             │
│                                                                             │
│  Request:                                                                   │
│  {                                                                          │
│    "message": "I'm feeling anxious today",                                  │
│    "conversationId": "conv_abc123",                                         │
│    "userId": "user_xyz789"                                                  │
│  }                                                                          │
│                                                                             │
│  Headers:                                                                   │
│  - x-trace-id (optional): Correlation ID for distributed tracing            │
│  - x-request-id (optional): Request identifier                              │
│                                                                             │
│  Response (200):                                                            │
│  {                                                                          │
│    "response": "I hear you. Anxiety can be really...",                      │
│    "conversationId": "conv_abc123",                                         │
│    "messageId": "msg_def456",                                               │
│    "metrics": {                                                             │
│      "totalDuration": 234,                                                  │
│      "memorySource": "L1_REDIS"                                             │
│    },                                                                       │
│    "crisisLevel": 4,                                                        │
│    "emergencyTriggered": false                                              │
│  }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  GET /health                                                                │
│  ═══════════                                                                │
│                                                                             │
│  Response (200):                                                            │
│  {                                                                          │
│    "status": "ok",                                                          │
│    "timestamp": "2024-12-06T12:00:00.000Z",                                 │
│    "version": "1.0.0"                                                       │
│  }                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  GET /health/metrics                                                        │
│  ══════════════════                                                         │
│                                                                             │
│  Response: Prometheus text format                                           │
│                                                                             │
│  # HELP pipeline_stage_duration_seconds Duration of pipeline stages         │
│  # TYPE pipeline_stage_duration_seconds histogram                           │
│  pipeline_stage_duration_seconds_bucket{stage="crisis_check",le="0.01"}     │
│  ...                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Result-Based Error Handling

All fallible operations return `Result<T, E>` instead of throwing exceptions:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        RESULT PATTERN                                       │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌───────────────────┐
                    │    Result<T, E>   │
                    │                   │
                    │  ok: boolean      │
                    └─────────┬─────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
    ┌─────────────────┐             ┌─────────────────┐
    │     Ok<T>       │             │     Err<E>      │
    │                 │             │                 │
    │  ok: true       │             │  ok: false      │
    │  value: T       │             │  error: E       │
    └─────────────────┘             └─────────────────┘

Usage:
────────────────────────────────────────────────────────────────────────────────
const result = await crisisDetector.detect(message, ctx)

if (!result.ok) {
  // Handle error
  logger.error({ error: result.error }, 'Detection failed')
  return err({ kind: 'CrisisError', message: result.error.message, context: {} })
}

// Use success value
const crisisLevel = result.value.level
────────────────────────────────────────────────────────────────────────────────

Error Types per Domain:
────────────────────────────────────────────────────────────────────────────────
CrisisError     │ DetectionError, PatternError, UnexpectedError
MemoryError     │ RetrievalError, PersistError, ConfigError
AgentError      │ ProviderError, RateLimitError, ContextLengthError, TimeoutError
SafetyError     │ ValidationError, ConfigError, UnexpectedError
EvaluationError │ EvaluationFailed, TimeoutError, UnexpectedError
PipelineError   │ CrisisError, MemoryError, AgentError, SafetyError, TimeoutError
────────────────────────────────────────────────────────────────────────────────
```

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     DEPLOYMENT TOPOLOGY                                     │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │           LOAD BALANCER             │
                    │         (nginx / cloud LB)          │
                    └─────────────────┬───────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
    ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
    │   API Pod #1    │     │   API Pod #2    │     │   API Pod #N    │
    │                 │     │                 │     │                 │
    │  ┌───────────┐  │     │  ┌───────────┐  │     │  ┌───────────┐  │
    │  │ Pipeline  │  │     │  │ Pipeline  │  │     │  │ Pipeline  │  │
    │  └───────────┘  │     │  └───────────┘  │     │  └───────────┘  │
    └────────┬────────┘     └────────┬────────┘     └────────┬────────┘
             │                       │                       │
             └───────────────────────┼───────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
        ▼                            ▼                            ▼
┌───────────────┐          ┌─────────────────┐          ┌───────────────┐
│    REDIS      │          │   POSTGRESQL    │          │    QDRANT     │
│   (L1 Cache)  │          │   + pgvector    │          │  (Vectors)    │
│               │          │    (L2 Store)   │          │   (L4 Store)  │
│  Cluster mode │          │                 │          │               │
│  for HA       │          │  Primary +      │          │  Replicated   │
└───────────────┘          │  Read replicas  │          │  cluster      │
                           └─────────────────┘          └───────────────┘

Infrastructure (docker-compose for dev):
────────────────────────────────────────────────────────────────────────────────
services:
  redis:        port 6379
  postgres:     port 5432
  qdrant:       port 6333 (HTTP), 6334 (gRPC)
  neo4j:        port 7474 (HTTP), 7687 (Bolt) - reserved for future
────────────────────────────────────────────────────────────────────────────────
```

---

## Related Documentation

- [`concept/memory-system-architecture.md`](./concept/memory-system-architecture.md) - Deep dive into memory tier design
- [`concept/context-flow-detailed.md`](./concept/context-flow-detailed.md) - Context assembly flow diagrams
- [`concept/memory-implementation-guide.md`](./concept/memory-implementation-guide.md) - Implementation guidelines
- [`../CLAUDE.md`](../CLAUDE.md) - Development commands and coding patterns
