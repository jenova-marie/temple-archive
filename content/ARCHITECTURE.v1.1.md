# RecoverySky Agent Architecture v1.1

**Version**: 1.1
**Updated**: 2025-12-17
**Changes from v1.0**: Authentication flow, context compaction, user personalization, improved observability

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
│  │  │  <10ms  │  │  + pgvector │  │ entities │  │  semantic search  │   │  │
│  │  └─────────┘  └─────────────┘  └──────────┘  └───────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     EXTERNAL SERVICES                                 │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐   │  │
│  │  │   ZITADEL   │  │  ANTHROPIC  │  │         OPENAI              │   │  │
│  │  │  Auth/IdP   │  │   Claude    │  │  Embeddings (ada-3-small)   │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Authentication & User Identity

### Zitadel Integration (NEW in v1.1)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     AUTHENTICATION FLOW                                     │
└─────────────────────────────────────────────────────────────────────────────┘

   Frontend (recoverysky-web)
        │
        │ 1. OAuth login with scopes: openid, email, profile
        │
        ▼
   ┌─────────────────┐
   │     ZITADEL     │
   │   (auth.rso)    │
   └────────┬────────┘
            │
            │ 2. Returns access_token (JWT)
            │    Note: Access token has minimal claims
            │
            ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                      API SERVER (auth.ts)                               │
   │  ┌───────────────────────────────────────────────────────────────────┐  │
   │  │  3. Verify JWT signature via JWKS endpoint                        │  │
   │  │     GET {issuer}/oauth/v2/keys                                    │  │
   │  │                                                                    │  │
   │  │  4. Fetch user profile from userinfo endpoint                     │  │
   │  │     GET {issuer}/oidc/v1/userinfo                                 │  │
   │  │     Authorization: Bearer {access_token}                          │  │
   │  │                                                                    │  │
   │  │  5. Build AuthenticatedUser:                                      │  │
   │  │     {                                                              │  │
   │  │       id: claims.sub,                                             │  │
   │  │       email: userinfo.email,                                      │  │
   │  │       name: userinfo.name || userinfo.given_name,                 │  │
   │  │       roles: extractRoles(claims)                                 │  │
   │  │     }                                                              │  │
   │  └───────────────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────────────┘
            │
            │ 6. req.user available throughout request lifecycle
            ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │                      REQUEST LIFECYCLE                                  │
   │                                                                          │
   │  loadUserData(userId, email, displayName)                               │
   │       │                                                                  │
   │       ├── Ensure user exists in PostgreSQL                              │
   │       ├── Load UserProfile from cache/database                          │
   │       └── Return { userId, email, displayName, profile }                │
   │                                                                          │
   │  PipelineInput includes:                                                 │
   │       • userProfile: UserProfile | null                                 │
   │       • displayName: string (from Zitadel)                              │
   └─────────────────────────────────────────────────────────────────────────┘
```

### User Profile Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    USER DATA → AGENT PERSONALIZATION                        │
└─────────────────────────────────────────────────────────────────────────────┘

   Zitadel userinfo                    PostgreSQL user_profiles
        │                                      │
        │ displayName                          │ UserProfile
        │ email                                │  • recoveryPhase
        │                                      │  • sobrietyDate
        │                                      │  • triggers[]
        │                                      │  • copingStrategies[]
        │                                      │  • preferences
        │                                      │  • milestones[]
        │                                      │
        └──────────────┬───────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ AssembledContext │
              │                  │
              │  displayName ────────▶ "Sarah"
              │  userProfile ────────▶ { recoveryPhase: "early", ... }
              └────────┬─────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  System Prompt   │
              │                  │
              │  ## User Context │
              │  - **Name**: Sarah
              │  - **Recovery Phase**: early
              │  - **Sobriety**: 45 days
              │  - **Known Triggers**: stress, isolation
              │  - **Coping Strategies**: meditation, exercise
              │  - **Communication Style**: supportive
              │  - **Response Length**: moderate
              │  - **Interested Topics**: mindfulness
              │  - **Recent Milestones**: 30_days (2025-12-02)
              └─────────────────┘
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

The pipeline processes each user message through sequential stages:

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
│  │  Levels 7-8:  HIGH      → Inject crisis resources + deep eval        │  │
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
│  │   L1 Redis ──▶ MISS ──▶ L2 PostgreSQL ──▶ L4 Qdrant (semantic)      │  │
│  │      │                        │                    │                  │  │
│  │      ▼                        ▼                    ▼                  │  │
│  │   Session                  Full                 Similar               │  │
│  │   Messages               History +              Messages              │  │
│  │   (20 msgs)              Profile               (top-k)               │  │
│  │                                                                       │  │
│  │   + Query embedding generated with label='query'                      │  │
│  │                                                                       │  │
│  │   Result: AssembledContext                                            │  │
│  │   • messages[], userProfile, displayName                              │  │
│  │   • sessionState, sessionEntities                                     │  │
│  │   • previousSessions, semanticMatches                                 │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
        │
        │ (parallel: context compaction fires if needed)
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
│  │   │  2. User context     │       │  • Personalized by name      │   │  │
│  │   │  3. Session context  │       │  • Crisis-adjusted tone      │   │  │
│  │   │  4. Crisis adjust    │       │                              │   │  │
│  │   │  5. Guidelines       │       └──────────────────────────────┘   │  │
│  │   │  6. Tool usage       │                    │                      │  │
│  │   │  7. Safety bounds    │                    ▼                      │  │
│  │   └──────────────────────┘             Agent Response                │  │
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
│  │   Generate embeddings (parallel):                                     │  │
│  │   • User message embedding    (label='user')                          │  │
│  │   • Assistant message embedding (label='assistant')                   │  │
│  │                                                                       │  │
│  │   Store to Memory Tiers (parallel):                                   │  │
│  │   • L1: Update session cache (role logged)                            │  │
│  │   • L2: Persist messages + update user profile (role logged)          │  │
│  │   • L4: Index embeddings for semantic search (role logged)            │  │
│  │                                                                       │  │
│  │   Fire-and-forget (async):                                            │  │
│  │   • Entity extraction → L3 Neo4j                                      │  │
│  │   • Memory bootstrap processing                                       │  │
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
│  │  user:{userId}                     → Cached User record             │   │
│  │  user:{userId}:profile             → Cached UserProfile             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Caching Strategy:                                                          │
│  • User/Profile: TTL 60min (configurable via USER_CACHE_TTL_MINUTES)       │
│  • Session data: TTL 4hr                                                    │
│  • Cache-through pattern: check cache → miss → load from L2 → warm cache   │
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
│  │  users          │ user_id, email, display_name, created_at          │   │
│  │  user_profiles  │ user_id, recovery_phase, triggers[], coping[],    │   │
│  │                 │ preferences JSONB, milestones JSONB               │   │
│  │  conversations  │ conversation_id, user_id, created_at, summary     │   │
│  │  messages       │ message_id, conversation_id, role, content,       │   │
│  │                 │ embedding vector(1536), timestamp                 │   │
│  │  system_prompts │ id, name, content, is_active, created_at          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Operations:                                                                │
│  • getConversationHistory(conversationId, limit)                            │
│  • getUserProfile(userId) - with L1 cache                                   │
│  • persistMessage(message) - logs role for debugging                        │
│  • updateUserProfile(userId, updates)                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
                    ▼                                 ▼
┌────────────────────────────────────┐  ┌────────────────────────────────────┐
│  L3: NEO4J                         │  │  L4: QDRANT                        │
│  ═════════                         │  │  ═══════════                       │
│  Latency: 20-100ms                 │  │  Latency: 5-20ms                   │
│                                    │  │                                    │
│  Purpose: Knowledge graph for      │  │  Purpose: Semantic similarity      │
│  entity relationships              │  │  search across all history         │
│                                    │  │                                    │
│  ┌──────────────────────────────┐ │  │  ┌──────────────────────────────┐  │
│  │  Nodes:                      │ │  │  │  Collection: messages         │  │
│  │  • (:Entity {entityId,       │ │  │  │                               │  │
│  │      name, type, userId})    │ │  │  │  Search Modes:                │  │
│  │                              │ │  │  │  • simple: dense vector only  │  │
│  │  Entity Types:               │ │  │  │  • hybrid: dense + sparse     │  │
│  │  • person, place, emotion    │ │  │  │                               │  │
│  │  • trigger, coping_strategy  │ │  │  │  Payload:                     │  │
│  │  • milestone, medication     │ │  │  │  • userId, conversationId     │  │
│  │                              │ │  │  │  • content, role, timestamp   │  │
│  │  Relationships:              │ │  │  │  • entities[], crisisLevel    │  │
│  │  • TRIGGERS, HELPS_WITH      │ │  │  │                               │  │
│  │  • SUPPORTS, RELATES_TO      │ │  │  │  Indexed: role logged for     │  │
│  │                              │ │  │  │  user vs assistant tracking   │  │
│  │  Per-user database mode      │ │  │  └──────────────────────────────┘  │
│  │  available (databasePerUser) │ │  │                                    │
│  └──────────────────────────────┘ │  │  Operations:                       │
│                                    │  │  • semanticSearch(embedding, k)    │
│  Operations:                       │  │  • filterByUser(userId)            │
│  • upsertEntity(entity) - logged  │  │  • indexMessage() - logs role      │
│  • createRelationship() - logged  │  └────────────────────────────────────┘
│  • getRelatedEntities()            │
└────────────────────────────────────┘
```

### Context Compaction (NEW in v1.1)

When conversations grow long, the context compactor summarizes older messages:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        CONTEXT COMPACTION                                   │
└─────────────────────────────────────────────────────────────────────────────┘

   Conversation Messages (e.g., 50 messages)
        │
        ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  maybeCompact(conversationId, messages, ctx)                            │
   │                                                                          │
   │  Trigger Conditions:                                                     │
   │  • Message count exceeds threshold                                       │
   │  • Token count exceeds limit                                             │
   │                                                                          │
   │  Process:                                                                 │
   │  1. Identify older messages beyond recent window                         │
   │  2. Generate summary via LLM                                             │
   │  3. Replace old messages with summary                                    │
   │  4. Preserve recent messages in full                                     │
   │                                                                          │
   │  Result:                                                                  │
   │  [Summary of messages 1-30] + [Full messages 31-50]                      │
   └─────────────────────────────────────────────────────────────────────────┘

   Fire-and-forget: Runs in parallel with agent processing
   Does not block response generation
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
        │          │                            │ • Deep crisis evaluation
        │          │                            │ • Heightened monitoring
 ───────┼──────────┼────────────────────────────┼────────────────────────────
    6   │ ELEVATED │ Severe distress            │ MONITOR
    5   │ ELEVATED │ Hopelessness               │ • Adjust response tone
    4   │ ELEVATED │ Isolation indicators       │ • Log for review
 ───────┼──────────┼────────────────────────────┼────────────────────────────
   1-3  │ NORMAL   │ General conversation       │ STANDARD FLOW
        │          │                            │ • Normal processing
```

---

## Agent & Response Generation

### System Prompt Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM PROMPT COMPOSITION                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  1. BASE IDENTITY (from database: system_prompts table)                     │
│  ════════════════                                                           │
│  "You are Sky, a compassionate and supportive AI companion for people       │
│   in addiction recovery..."                                                 │
│                                                                             │
│  Fetched fresh each request via getSystemPrompt(name) or                    │
│  getDefaultSystemPrompt() for base-identity                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. USER CONTEXT (from AssembledContext) - ENHANCED in v1.1                 │
│  ═════════════════                                                          │
│  ## User Context                                                            │
│  - **Name**: Sarah                          ← NEW: from Zitadel userinfo   │
│  - **Recovery Phase**: early                                                │
│  - **Sobriety**: 45 days (since 2024-11-02)                                │
│  - **Known Triggers**: stress, social isolation                            │
│  - **Effective Coping Strategies**: meditation, calling sponsor            │
│  - **Preferred Communication Style**: supportive    ← NEW: preferences     │
│  - **Preferred Response Length**: moderate          ← NEW: preferences     │
│  - **Interested Topics**: mindfulness, fitness      ← NEW: preferences     │
│  - **Topics to Avoid**: family drama                ← NEW: preferences     │
│  - **Recent Milestones**: 30_days (2025-12-02)      ← NEW: milestones      │
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
│  5-7. GUIDELINES, TOOLS, SAFETY BOUNDARIES                                  │
│  ══════════════════════════════════════════                                 │
│  (unchanged from v1.0)                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Observability

### Instrumentation Stack - ENHANCED in v1.1

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       OBSERVABILITY LAYER                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  LOGGING (Pino via wonder-logger)                                           │
│  ════════════════════════════════                                           │
│                                                                             │
│  Configuration: wonder-logger.yaml                                          │
│  • variant: aligned (single-line output)                                    │
│  • dataFormat: inline (key=value pairs)                                     │
│                                                                             │
│  Enhanced logging with context (NEW in v1.1):                               │
│  ─────────────────────────────────────────────────────────────────────────  │
│  // Embedding generation - distinguishes purpose                            │
│  logger.debug({ dimension: 1536, label: 'user' }, 'Embedding generated')    │
│  logger.debug({ dimension: 1536, label: 'assistant' }, 'Embedding generated')│
│  logger.debug({ dimension: 1536, label: 'query' }, 'Embedding generated')   │
│                                                                             │
│  // Message storage - distinguishes role                                    │
│  logger.debug({ role: 'user' }, 'Message stored in Redis L1 cache')         │
│  logger.debug({ role: 'assistant' }, 'Message stored in L2')                │
│  logger.debug({ role: 'user' }, 'Message indexed with dense + sparse')      │
│                                                                             │
│  // Entity operations - shows what's being processed                        │
│  logger.debug({ entity: 'john', type: 'person' }, 'Entity upserted')        │
│  logger.debug({ from: 'john', to: 'stress', type: 'TRIGGERS' },             │
│              'Relationship created')                                        │
│                                                                             │
│  // Noise reduction                                                         │
│  logger.trace('Database already initialized, skipping') // was debug        │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  Output example:                                                             │
│  [2025-12-17 09:20:34] DEBUG: Embedding generated dimension=1536 label=user │
│  [2025-12-17 09:20:34] DEBUG: Message stored in L2 role=user hasEmbed=true  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  TRACING (OpenTelemetry)                                                    │
│  ════════════════════════                                                   │
│                                                                             │
│  Trace structure:                                                           │
│  ├─ Pipeline.process                                                        │
│  │  ├─ Pipeline.crisisCheck                                                 │
│  │  │  └─ KeywordCrisisDetector.detect                                      │
│  │  ├─ Pipeline.memoryRetrieval                                             │
│  │  │  ├─ OpenAIEmbeddingProvider.embed (label=query)                       │
│  │  │  ├─ MemoryOrchestrator.retrieveContext                                │
│  │  │  │  ├─ RedisContextStore.getRecentMessages                            │
│  │  │  │  └─ PostgresSessionStore.getConversationHistory                    │
│  │  ├─ Pipeline.agentProcessing                                             │
│  │  │  └─ VercelAIAgentProvider.stream                                      │
│  │  └─ Pipeline.persist                                                     │
│  │     ├─ OpenAIEmbeddingProvider.embed (label=user)                        │
│  │     ├─ OpenAIEmbeddingProvider.embed (label=assistant)                   │
│  │     ├─ MemoryOrchestrator.storeMessage (role=user)                       │
│  │     └─ MemoryOrchestrator.storeMessage (role=assistant)                  │
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
│  POST /api/v1/chat                                                          │
│  ═════════════════                                                          │
│                                                                             │
│  Authentication: Bearer token (Zitadel JWT)                                 │
│  • Token validated via JWKS                                                 │
│  • User profile fetched from userinfo endpoint                              │
│                                                                             │
│  Request (Vercel AI SDK UIMessage format):                                  │
│  {                                                                          │
│    "messages": [                                                            │
│      { "role": "user", "parts": [{"type": "text", "text": "..."}] }        │
│    ],                                                                       │
│    "guide": "base-identity",        // optional: system prompt name        │
│    "conversation_id": "uuid"        // optional: continue conversation     │
│  }                                                                          │
│                                                                             │
│  Response: UI Message Stream (native assistant-ui format)                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  GET /api/v1/guides                                                         │
│  ══════════════════                                                         │
│                                                                             │
│  Authentication: Bearer token (Zitadel JWT)                                 │
│                                                                             │
│  Response:                                                                  │
│  [                                                                          │
│    { "id": "uuid", "name": "base-identity", "description": "..." },        │
│    { "id": "uuid", "name": "crisis-support", "description": "..." }        │
│  ]                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  GET /health                                                                │
│  GET /health/metrics                                                        │
│  ═══════════════════                                                        │
│  (unchanged from v1.0)                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Environment Configuration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ENVIRONMENT VARIABLES                                  │
└─────────────────────────────────────────────────────────────────────────────┘

# Authentication (Zitadel)
ZITADEL_ISSUER=https://auth.rso
ZITADEL_AUDIENCE=your-client-id

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/recoverysky
DATABASE_SSL=false

# Cache
REDIS_URL=redis://localhost:6379
USER_CACHE_TTL_MINUTES=60           # NEW: User/profile cache TTL

# Vector Store
QDRANT_URL=http://localhost:6333

# Knowledge Graph
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password

# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Feature Flags
USE_STUBS=false                     # true for in-memory testing
MEMORY_TOOL_ACCESS=read             # off|read|write|full
LOG_LEVEL=debug                     # trace|debug|info|warn|error
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
        │
        │
        ▼
┌───────────────┐          ┌─────────────────┐
│    NEO4J      │          │    ZITADEL      │
│  (L3 Graph)   │          │   (Auth IdP)    │
│               │          │                 │
│  Per-user DB  │          │  External       │
│  mode avail.  │          │  service        │
└───────────────┘          └─────────────────┘

Infrastructure (docker-compose for dev):
────────────────────────────────────────────────────────────────────────────────
services:
  redis:        port 6379
  postgres:     port 5432
  qdrant:       port 6333 (HTTP), 6334 (gRPC)
  neo4j:        port 7474 (HTTP), 7687 (Bolt)
────────────────────────────────────────────────────────────────────────────────
```

---

## Changelog from v1.0

### v1.1 (2025-12-17)

**Authentication & User Identity**
- Added Zitadel userinfo endpoint integration for fetching user profile data
- Access tokens no longer need profile claims - fetched separately
- User's display name now flows through to agent system prompt

**Personalization**
- Enhanced User Context section in system prompt with:
  - User's name (from Zitadel)
  - All user preferences (tone, responseLength, preferredTopics, avoidTopics)
  - Recent milestones
- Full UserProfile data passed through AssembledContext

**Memory System**
- Added context compaction for long conversations (fire-and-forget)
- User/profile caching in Redis with configurable TTL
- Request-scoped user data loading (load once, pass through)

**Observability**
- Added `label` parameter to embedding operations (query/user/assistant)
- Added `role` field to message storage logs
- Added entity/type info to Neo4j operation logs
- Reduced noise: "Database already initialized" moved to trace level

**Logging Format**
- Logs now clearly distinguish parallel operations:
  - `Embedding generated label=user` vs `label=assistant`
  - `Message stored role=user` vs `role=assistant`

---

## Related Documentation

- [`CLAUDE.md`](../CLAUDE.md) - Development commands and coding patterns
- [`concept/memory-system-architecture.md`](./concept/memory-system-architecture.md) - Deep dive into memory tier design
- [`concept/memory-implementation-guide.md`](./concept/memory-implementation-guide.md) - Implementation guidelines
