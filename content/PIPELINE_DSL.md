# Pipeline DSL Design Document

## Overview

This document defines a **declarative Pipeline Domain-Specific Language (DSL)** for the RecoverySky Agent system. The DSL serves multiple purposes:

1. **Runtime Configuration** - Control which components are active and their settings
2. **Documentation** - High-level system overview readable by humans
3. **Orchestration** - Define execution flow, parallelism, and conditional logic
4. **Validation** - Fail fast on invalid configurations at startup

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PIPELINE DSL ARCHITECTURE                           │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │  pipeline.yaml  │
                              │  (Core Flow)    │
                              └────────┬────────┘
                                       │
           ┌───────────────────────────┼───────────────────────────┐
           │                           │                           │
           ▼                           ▼                           ▼
   ┌───────────────┐          ┌───────────────┐          ┌───────────────┐
   │ components/   │          │  profiles/    │          │ schema.json   │
   │               │          │               │          │               │
   │ • memory.yaml │          │ • dev.yaml    │          │ JSON Schema   │
   │ • crisis.yaml │          │ • prod.yaml   │          │ validation    │
   │ • agent.yaml  │          │ • test.yaml   │          │               │
   │ • safety.yaml │          │               │          │               │
   │ • eval.yaml   │          │               │          │               │
   └───────────────┘          └───────────────┘          └───────────────┘
           │                           │                           │
           └───────────────────────────┼───────────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │ Config Loader   │
                              │                 │
                              │ • Parse YAML    │
                              │ • Merge layers  │
                              │ • Interpolate   │
                              │ • Validate      │
                              └────────┬────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │ Pipeline Engine │
                              │                 │
                              │ Execute stages  │
                              │ per DSL spec    │
                              └─────────────────┘
```

---

## File Structure

```
config/
├── pipeline.yaml              # Core pipeline definition
├── components/
│   ├── memory.yaml            # L1-L4 memory tier configs
│   ├── crisis.yaml            # Crisis detection/handling
│   ├── safety.yaml            # Safety validator configs
│   ├── agent.yaml             # Agent/LLM provider configs
│   └── evaluation.yaml        # Evaluator configs
├── profiles/
│   ├── base.yaml              # Default values (always loaded)
│   ├── development.yaml       # In-memory stubs, mock agent
│   ├── production.yaml        # Full production infrastructure
│   ├── testing.yaml           # Test-specific overrides
│   └── minimal.yaml           # Bare minimum for quick starts
└── schema/
    ├── pipeline.schema.json   # JSON Schema for pipeline.yaml
    ├── memory.schema.json     # JSON Schema for memory.yaml
    └── ...
```

### Benefits of Multi-File Structure

| Benefit | Description |
|---------|-------------|
| **Isolation** | Components can be versioned independently |
| **Ownership** | Teams can own their component configs |
| **Readability** | Smaller files are easier to review |
| **Reusability** | Component configs can be shared across projects |
| **Diff-Friendly** | Smaller changesets in version control |

---

## Core Pipeline Definition

### pipeline.yaml

This is the heart of the DSL - it defines the execution flow of the entire system.

```yaml
# config/pipeline.yaml
# RecoverySky Agent Pipeline Definition
#
# This file defines HOW the pipeline executes:
# - Stage ordering and dependencies
# - Parallel execution blocks
# - Conditional gates and early exits
# - Timeout and failure handling

version: "1.0"
name: recoverysky-agent

# Global pipeline settings
settings:
  # Maximum time for entire pipeline execution
  total_timeout_ms: 60000

  # How to handle stage failures
  failure_strategy: abort  # abort | continue | retry

  # Enable distributed tracing
  tracing:
    enabled: true
    service_name: recoverysky-pipeline

  # Metrics collection
  metrics:
    enabled: true
    prefix: pipeline_

# Environment variable interpolation
env:
  # Define which env vars are required vs optional
  required:
    - ANTHROPIC_API_KEY
  optional:
    - REDIS_URL
    - DATABASE_URL
    - QDRANT_URL
    - NEO4J_URI
    - OPENAI_API_KEY

# =============================================================================
# PIPELINE STAGES
# =============================================================================
#
# Stages execute in order. Each stage can be:
#   - A single component invocation
#   - A parallel block (multiple components run concurrently)
#   - A gate (conditional branching)
#   - An async block (fire-and-forget)

stages:
  # ─────────────────────────────────────────────────────────────────────────
  # STAGE 1: Crisis Detection
  # ─────────────────────────────────────────────────────────────────────────
  - name: crisis_check
    description: "Fast keyword-based crisis detection (<10ms target)"
    component: crisis.detector

    # Performance requirements
    timeout_ms: 50
    target_latency_ms: 10

    # Input/output contract
    inputs:
      - message: "$.request.message"
      - userId: "$.request.userId"
    outputs:
      - crisis_level
      - crisis_action
      - detected_patterns
      - requires_emergency

    # Failure handling for this stage
    on_failure: abort
    on_timeout: abort

    # Optional: LLM-based deep analysis
    extensions:
      deep_evaluator:
        enabled: "${ANTHROPIC_API_KEY != ''}"
        component: crisis.deep_evaluator
        trigger_condition: "crisis_level >= 4"

  # ─────────────────────────────────────────────────────────────────────────
  # GATE: Emergency Short-Circuit
  # ─────────────────────────────────────────────────────────────────────────
  - name: emergency_gate
    type: gate
    description: "Short-circuit to emergency response for critical situations"

    condition: "crisis_level >= 9"

    if_true:
      # Execute emergency protocol
      execute:
        - name: emergency_response
          component: crisis.handler
          inputs:
            - crisis_level
            - detected_patterns
          outputs:
            - emergency_response

      # Return immediately, skip remaining stages
      then: return
      return_value:
        response: "$.emergency_response"
        emergency_triggered: true
        crisis_level: "$.crisis_level"

    if_false: continue

  # ─────────────────────────────────────────────────────────────────────────
  # STAGE 2: Memory Retrieval (Parallel)
  # ─────────────────────────────────────────────────────────────────────────
  - name: context_assembly
    type: parallel
    description: "Retrieve context from multiple memory tiers concurrently"

    # All parallel branches must complete (or timeout)
    strategy: wait_all
    timeout_ms: 200

    branches:
      - name: memory_retrieval
        description: "L1/L2 memory orchestration"
        component: memory.orchestrator
        required: true  # Pipeline fails if this fails

        inputs:
          - conversationId: "$.request.conversationId"
          - userId: "$.request.userId"
        outputs:
          - messages
          - user_profile
          - session_state
          - session_entities
          - previous_sessions

      - name: semantic_search
        description: "L4 vector similarity search"
        component: memory.vector_store
        required: false  # Optional enhancement
        enabled: "${config.memory.tiers.l4.enabled}"

        inputs:
          - message: "$.request.message"
          - userId: "$.request.userId"
        outputs:
          - semantic_matches

      - name: knowledge_graph
        description: "L3 entity relationship lookup"
        component: memory.knowledge_store
        required: false
        enabled: "${config.memory.tiers.l3.enabled}"

        inputs:
          - userId: "$.request.userId"
        outputs:
          - related_entities

    # How to merge parallel outputs
    merge:
      strategy: deep_merge
      output: assembled_context

  # ─────────────────────────────────────────────────────────────────────────
  # STAGE 3: Agent Processing
  # ─────────────────────────────────────────────────────────────────────────
  - name: agent_processing
    description: "Generate response via LLM agent"
    component: agent.provider

    timeout_ms: 30000
    target_latency_ms: 3000

    inputs:
      - message: "$.request.message"
      - context: "$.assembled_context"
      - crisis_level: "$.crisis_level"
      - detected_patterns: "$.detected_patterns"
    outputs:
      - agent_response
      - tool_calls
      - token_usage

    on_failure: fallback
    fallback:
      component: agent.fallback_provider
      # Use a simpler/faster model as backup

  # ─────────────────────────────────────────────────────────────────────────
  # STAGE 4: Parallel Validation
  # ─────────────────────────────────────────────────────────────────────────
  - name: validation
    type: parallel
    description: "Safety check and quality evaluation run concurrently"

    strategy: wait_all
    timeout_ms: 5000

    branches:
      - name: safety_check
        description: "Content policy and recovery-appropriateness validation"
        component: safety.validator
        required: true  # Must pass for response to be sent

        inputs:
          - response: "$.agent_response"
          - context: "$.assembled_context"
        outputs:
          - safety_passed
          - violations
          - sanitized_response

      - name: evaluation
        description: "Quality scoring for monitoring and improvement"
        component: evaluation.evaluator
        required: false  # Don't block response on eval

        inputs:
          - message: "$.request.message"
          - response: "$.agent_response"
          - context: "$.assembled_context"
        outputs:
          - overall_score
          - empathy_score
          - relevance_score
          - recovery_score
          - feedback

  # ─────────────────────────────────────────────────────────────────────────
  # GATE: Safety Validation
  # ─────────────────────────────────────────────────────────────────────────
  - name: safety_gate
    type: gate
    description: "Ensure response passes safety validation"

    condition: "safety_passed == true"

    if_true: continue

    if_false:
      # Use sanitized response if available, otherwise generate safe fallback
      execute:
        - name: safe_response
          type: conditional
          condition: "sanitized_response != null"
          if_true:
            set:
              final_response: "$.sanitized_response"
          if_false:
            component: safety.fallback_generator
            outputs:
              - final_response

  # ─────────────────────────────────────────────────────────────────────────
  # STAGE 5: Persistence (Async)
  # ─────────────────────────────────────────────────────────────────────────
  - name: persist
    type: async
    description: "Store messages and extract entities (fire-and-forget)"

    # Don't block response on persistence
    blocking: false

    branches:
      - name: store_messages
        description: "Persist to L1/L2 memory tiers"
        component: memory.store

        inputs:
          - user_message: "$.request.message"
          - assistant_response: "$.final_response"
          - conversationId: "$.request.conversationId"
          - userId: "$.request.userId"
          - metadata:
              crisis_level: "$.crisis_level"
              evaluation_score: "$.overall_score"

      - name: entity_extraction
        description: "LLM-based entity extraction for knowledge graph"
        component: memory.entity_extractor
        enabled: "${config.memory.extraction.mode != 'none'}"

        inputs:
          - user_message: "$.request.message"
          - assistant_response: "$.final_response"
          - crisis_level: "$.crisis_level"

      - name: vector_indexing
        description: "Index embeddings for semantic search"
        component: memory.embedding_indexer
        enabled: "${config.memory.tiers.l4.enabled && OPENAI_API_KEY != ''}"

        inputs:
          - messages:
              - role: user
                content: "$.request.message"
              - role: assistant
                content: "$.final_response"
          - conversationId: "$.request.conversationId"
          - userId: "$.request.userId"

  # ─────────────────────────────────────────────────────────────────────────
  # STAGE 6: Response Assembly
  # ─────────────────────────────────────────────────────────────────────────
  - name: response
    type: return
    description: "Assemble and return final response"

    value:
      response: "$.final_response || $.agent_response"
      conversationId: "$.request.conversationId"
      messageId: "$.generated_message_id"
      crisisLevel: "$.crisis_level"
      emergencyTriggered: false
      metrics:
        totalDuration: "$.pipeline_duration_ms"
        memorySource: "$.memory_source"
        evaluationScore: "$.overall_score"
```

---

## Component Configuration Files

### components/memory.yaml

```yaml
# config/components/memory.yaml
# Memory System Configuration
#
# The memory system uses a 4-tier architecture:
#   L1: Redis     - Hot session cache (<10ms)
#   L2: PostgreSQL - Persistent history (10-50ms)
#   L3: Neo4j     - Knowledge graph (20-100ms)
#   L4: Qdrant    - Semantic search (5-20ms)

version: "1.0"

memory:
  # ─────────────────────────────────────────────────────────────────────────
  # Memory Orchestrator Settings
  # ─────────────────────────────────────────────────────────────────────────
  orchestrator:
    # Maximum messages to retrieve from L1 (session cache)
    l1_message_limit: 20

    # Maximum messages to retrieve from L2 (full history)
    l2_message_limit: 100

    # How far back to search for semantic matches
    semantic_search_days: 30

    # Enable L3 knowledge graph queries
    enable_l3_queries: true

    # Maximum entities to include from L3
    l3_entity_limit: 10

    # Cache warming strategy
    cache_warming:
      enabled: true
      # Warm L1 cache when conversation starts
      on_conversation_start: true
      # Pre-fetch user profile
      prefetch_profile: true

  # ─────────────────────────────────────────────────────────────────────────
  # L1: Session Cache (Redis)
  # ─────────────────────────────────────────────────────────────────────────
  tiers:
    l1:
      enabled: true

      # Provider selection
      # Options: redis | in_memory
      provider: "${REDIS_URL ? 'redis' : 'in_memory'}"

      # Time-to-live for cached sessions
      ttl_seconds: 14400  # 4 hours

      # Redis connection settings
      connection:
        url: "${REDIS_URL}"

        # Connection pool settings
        pool:
          min_connections: 2
          max_connections: 10
          idle_timeout_ms: 30000

        # Retry settings
        retry:
          max_attempts: 3
          initial_delay_ms: 100
          max_delay_ms: 2000

      # Key prefixes for Redis
      keys:
        messages: "session:{conversationId}:messages"
        state: "session:{conversationId}:state"
        entities: "session:{conversationId}:entities"
        preferences: "user:{userId}:preferences"

    # ─────────────────────────────────────────────────────────────────────────
    # L2: Persistent Storage (PostgreSQL)
    # ─────────────────────────────────────────────────────────────────────────
    l2:
      enabled: true

      # Provider selection
      # Options: postgresql | in_memory
      provider: "${DATABASE_URL ? 'postgresql' : 'in_memory'}"

      connection:
        url: "${DATABASE_URL}"

        pool:
          min_connections: 5
          max_connections: 20
          idle_timeout_ms: 60000

      # Data retention settings
      retention:
        # How long to keep conversation history
        conversation_days: 90

        # How long to keep user profiles (indefinite if not set)
        # profile_days: null

        # Archive old conversations instead of deleting
        archive_enabled: true

      # Query optimization
      queries:
        # Use prepared statements
        prepared_statements: true

        # Statement timeout
        statement_timeout_ms: 5000

    # ─────────────────────────────────────────────────────────────────────────
    # L3: Knowledge Graph (Neo4j)
    # ─────────────────────────────────────────────────────────────────────────
    l3:
      enabled: "${NEO4J_URI != ''}"

      # Provider selection
      # Options: neo4j | in_memory
      provider: "${NEO4J_URI ? 'neo4j' : 'in_memory'}"

      connection:
        uri: "${NEO4J_URI}"
        user: "${NEO4J_USER:-neo4j}"
        password: "${NEO4J_PASSWORD}"

        pool:
          max_connection_pool_size: 50
          connection_acquisition_timeout_ms: 60000

      # Schema initialization
      schema:
        # Auto-create constraints and indexes on startup
        auto_initialize: true

        # Constraints to create
        constraints:
          - "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.entityId IS UNIQUE"

        # Indexes to create
        indexes:
          - "CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name)"
          - "CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type)"
          - "CREATE INDEX entity_user IF NOT EXISTS FOR (e:Entity) ON (e.userId)"

      # Query settings
      queries:
        # Maximum hops for relationship traversal
        max_relationship_hops: 3

        # Timeout for graph queries
        timeout_ms: 5000

    # ─────────────────────────────────────────────────────────────────────────
    # L4: Vector Store (Qdrant)
    # ─────────────────────────────────────────────────────────────────────────
    l4:
      enabled: "${QDRANT_URL != ''}"

      # Provider selection
      # Options: qdrant | in_memory
      provider: "${QDRANT_URL ? 'qdrant' : 'in_memory'}"

      connection:
        url: "${QDRANT_URL}"

        # API key for Qdrant Cloud
        api_key: "${QDRANT_API_KEY}"

      # Collection settings
      collection:
        name: messages

        # Vector dimensions (must match embedding model)
        vector_size: 1536

        # Distance metric
        distance: Cosine

        # Indexing settings
        index:
          # HNSW index parameters
          hnsw:
            m: 16
            ef_construct: 100

      # Search settings
      search:
        # Number of results to return
        default_limit: 10

        # Minimum similarity score
        min_score: 0.7

        # Search timeout
        timeout_ms: 2000

  # ─────────────────────────────────────────────────────────────────────────
  # Entity Extraction Configuration
  # ─────────────────────────────────────────────────────────────────────────
  extraction:
    # Extraction mode
    # Options:
    #   all        - Extract from every message
    #   none       - Disable extraction
    #   sample:N   - Extract from N% of messages (e.g., sample:25)
    #   significant - Only extract when crisis_level >= 4
    mode: "${ENTITY_EXTRACTION_MODE:-all}"

    # LLM model for extraction
    model: "${ENTITY_EXTRACTION_MODEL:-claude-3-haiku-20240307}"

    # Entity types to extract
    types:
      - person          # People mentioned (sponsor, family, therapist)
      - place           # Locations (meetings, rehab, home)
      - event           # Significant events (relapses, milestones)
      - emotion         # Emotional states
      - trigger         # Addiction triggers
      - coping_strategy # Coping mechanisms
      - milestone       # Recovery achievements
      - medication      # MAT and other medications

    # Minimum importance score to store (0.0 - 1.0)
    min_importance: "${ENTITY_MIN_IMPORTANCE:-0.3}"

    # Whether to infer relationships between entities
    infer_relationships: "${ENTITY_INFER_RELATIONSHIPS:-true}"

    # LLM settings for extraction
    llm:
      max_tokens: 1024
      temperature: 0.1  # Low temperature for consistent extraction

  # ─────────────────────────────────────────────────────────────────────────
  # Embedding Provider Configuration
  # ─────────────────────────────────────────────────────────────────────────
  embedding:
    enabled: "${OPENAI_API_KEY != ''}"

    # Provider selection
    # Options: openai | anthropic | local
    provider: openai

    # Model settings
    model: text-embedding-3-small

    # Batch settings
    batch:
      max_size: 100
      timeout_ms: 10000

    # Caching
    cache:
      enabled: true
      ttl_seconds: 86400  # 24 hours
```

### components/crisis.yaml

```yaml
# config/components/crisis.yaml
# Crisis Detection and Handling Configuration

version: "1.0"

crisis:
  # ─────────────────────────────────────────────────────────────────────────
  # Keyword-Based Detection (Fast Path)
  # ─────────────────────────────────────────────────────────────────────────
  detector:
    # Target latency for detection
    target_latency_ms: 10

    # Threshold levels for actions
    thresholds:
      # Level 9-10: Emergency protocol triggered
      critical: 9

      # Level 7-8: Inject crisis resources
      high: 7

      # Level 4-6: Monitor and adjust tone
      elevated: 4

    # Pattern categories and their base levels
    patterns:
      suicidal_ideation:
        level: 10
        keywords:
          - "want to die"
          - "end my life"
          - "kill myself"
          - "suicide"
          - "don't want to live"
        boost_keywords:
          - "plan"
          - "tonight"
          - "method"
          - "note"
        dampener_keywords:
          - "movie"
          - "song"
          - "article"
          - "news"

      overdose_risk:
        level: 10
        keywords:
          - "overdose"
          - "take all my pills"
          - "too many"
        boost_keywords:
          - "tonight"
          - "now"
          - "ready"

      # ... additional patterns ...

      active_relapse:
        level: 8
        keywords:
          - "using again"
          - "relapsed"
          - "fell off the wagon"
          - "started drinking"
          - "got high"

      imminent_relapse:
        level: 7
        keywords:
          - "about to use"
          - "going to drink"
          - "can't resist"
          - "dealer"
          - "liquor store"

      severe_distress:
        level: 6
        keywords:
          - "can't take it"
          - "breaking down"
          - "losing it"
          - "panic"

      hopelessness:
        level: 5
        keywords:
          - "no hope"
          - "pointless"
          - "give up"
          - "what's the point"

      isolation:
        level: 4
        keywords:
          - "all alone"
          - "no one cares"
          - "nobody understands"
          - "isolated"

  # ─────────────────────────────────────────────────────────────────────────
  # Deep Evaluation (LLM-Based)
  # ─────────────────────────────────────────────────────────────────────────
  deep_evaluator:
    enabled: "${ANTHROPIC_API_KEY != ''}"

    # When to trigger deep evaluation
    trigger:
      # Minimum crisis level from keyword detection
      min_crisis_level: 4

      # Also trigger on specific patterns regardless of level
      patterns:
        - suicidal_ideation
        - overdose_risk
        - self_harm

    # LLM settings
    llm:
      model: claude-3-haiku-20240307
      max_tokens: 512
      temperature: 0.1

    # Timeout for LLM evaluation
    timeout_ms: 3000

  # ─────────────────────────────────────────────────────────────────────────
  # Crisis Handler
  # ─────────────────────────────────────────────────────────────────────────
  handler:
    # Provider selection
    # Options: webhook | stub
    provider: "${CRISIS_WEBHOOK_URL ? 'webhook' : 'stub'}"

    # Webhook configuration
    webhook:
      url: "${CRISIS_WEBHOOK_URL}"
      secret: "${CRISIS_WEBHOOK_SECRET}"

      # Retry settings
      retry:
        max_attempts: 3
        initial_delay_ms: 100

      # Timeout for webhook call
      timeout_ms: 5000

    # Emergency response templates
    responses:
      critical:
        prefix: |
          I'm very concerned about what you're sharing. Your safety is the
          most important thing right now.
        resources:
          - "National Suicide Prevention Lifeline: 988"
          - "Crisis Text Line: Text HOME to 741741"
          - "SAMHSA Helpline: 1-800-662-4357"
        suffix: |
          These trained counselors are available 24/7 and want to help.
          Please reach out to them right now.

      high:
        prefix: |
          I hear that you're going through a really difficult time.
        resources:
          - "SAMHSA Helpline: 1-800-662-4357"
        suffix: |
          Would you like to talk about what's happening?
```

### components/agent.yaml

```yaml
# config/components/agent.yaml
# Agent and LLM Provider Configuration

version: "1.0"

agent:
  # ─────────────────────────────────────────────────────────────────────────
  # Provider Selection
  # ─────────────────────────────────────────────────────────────────────────
  provider:
    # Active provider
    # Options: vercel_ai | mock
    type: "${USE_STUBS == 'true' ? 'mock' : 'vercel_ai'}"

    # Vercel AI SDK configuration
    vercel_ai:
      # Model to use
      model: claude-sonnet-4-20250514

      # Maximum agentic steps
      max_steps: 5

      # Token limits
      max_tokens: 4096

      # Temperature (0-1)
      temperature: 0.7

      # Timeout for LLM calls
      timeout_ms: 30000

    # Mock provider configuration (for testing/development)
    mock:
      # Simulated delay
      delay_ms: 100

      # Response template
      response_template: |
        I hear you. That sounds really {emotion}.
        What would feel most supportive right now?

  # ─────────────────────────────────────────────────────────────────────────
  # Fallback Provider
  # ─────────────────────────────────────────────────────────────────────────
  fallback:
    enabled: true

    # Use a faster/simpler model as fallback
    model: claude-3-haiku-20240307
    max_tokens: 1024
    temperature: 0.5

    # When to use fallback
    triggers:
      - primary_timeout
      - primary_rate_limit
      - primary_error

  # ─────────────────────────────────────────────────────────────────────────
  # System Prompt Configuration
  # ─────────────────────────────────────────────────────────────────────────
  system_prompt:
    # Base identity section
    identity:
      name: Sky
      description: |
        You are Sky, a compassionate and supportive AI companion for people
        in addiction recovery. You listen with empathy and without judgment,
        supporting users through their recovery journey.

    # Sections to include in system prompt
    sections:
      - identity           # Always first
      - user_context       # From user profile
      - session_context    # Current session state
      - crisis_adjustment  # If crisis level >= 4
      - recovery_guidelines
      - tool_instructions  # If tools enabled
      - safety_boundaries  # Always last

    # Dynamic adjustments based on crisis level
    crisis_adjustments:
      elevated:  # Level 4-6
        tone: empathetic
        instructions:
          - "Acknowledge feelings explicitly"
          - "Offer concrete coping options"
          - "Check on safety if appropriate"

      high:  # Level 7-8
        tone: supportive_urgent
        instructions:
          - "Express genuine concern"
          - "Include crisis resources"
          - "Encourage professional help"

      critical:  # Level 9-10
        # Handled by emergency protocol, not normal flow

  # ─────────────────────────────────────────────────────────────────────────
  # Tools Configuration
  # ─────────────────────────────────────────────────────────────────────────
  tools:
    enabled: false  # Future feature

    # Available tools
    # definitions:
    #   find_meetings:
    #     description: "Search for nearby AA/NA/SMART meetings"
    #     parameters:
    #       location: { type: string, required: true }
    #       type: { type: string, enum: [aa, na, smart] }
    #
    #   log_mood:
    #     description: "Record user's current emotional state"
    #     parameters:
    #       mood: { type: string, required: true }
    #       intensity: { type: number, min: 1, max: 10 }
    #
    #   set_reminder:
    #     description: "Create recovery-related reminders"
    #     parameters:
    #       message: { type: string, required: true }
    #       time: { type: string, format: datetime }
```

### components/safety.yaml

```yaml
# config/components/safety.yaml
# Safety Validation Configuration

version: "1.0"

safety:
  # ─────────────────────────────────────────────────────────────────────────
  # Validator Selection
  # ─────────────────────────────────────────────────────────────────────────
  validator:
    # Provider selection
    # Options: full | stub
    type: "${USE_STUBS == 'true' ? 'stub' : 'full'}"

    # Full validator settings
    full:
      # Enable LLM-based detection (requires ANTHROPIC_API_KEY)
      enable_llm_detection: "${ANTHROPIC_API_KEY != ''}"

      # Redact PII from responses
      redact_pii: true

      # LLM model for safety analysis
      llm:
        model: claude-3-haiku-20240307
        max_tokens: 256
        temperature: 0.0

      # Timeout for safety check
      timeout_ms: 3000

  # ─────────────────────────────────────────────────────────────────────────
  # Content Policy Rules
  # ─────────────────────────────────────────────────────────────────────────
  rules:
    # High severity - block response entirely
    critical:
      - name: enablement_check
        description: "Never enable or encourage substance use"
        patterns:
          - "here's how to"
          - "you could try"
          - "dealer"

      - name: medical_advice
        description: "Never provide medical advice"
        patterns:
          - "stop taking your medication"
          - "don't need your meds"
          - "natural remedy instead"

      - name: dangerous_info
        description: "Never share dangerous information"
        patterns:
          - "how to get high"
          - "mix with alcohol"
          - "avoid detection"

    # Medium severity - flag for review, may sanitize
    warning:
      - name: minimization
        description: "Don't minimize addiction dangers"
        patterns:
          - "not that bad"
          - "once won't hurt"
          - "you can handle it"

      - name: triggering_language
        description: "Avoid potentially triggering content"
        patterns:
          - detailed drug descriptions
          - romanticizing past use

    # Low severity - log but don't block
    info:
      - name: off_topic
        description: "Response strays from recovery focus"

  # ─────────────────────────────────────────────────────────────────────────
  # PII Detection and Redaction
  # ─────────────────────────────────────────────────────────────────────────
  pii:
    enabled: true

    # Types of PII to detect
    types:
      - phone_number
      - email
      - address
      - ssn
      - credit_card

    # Redaction strategy
    redaction:
      # How to redact (mask | remove | placeholder)
      strategy: placeholder

      # Placeholder text
      placeholder: "[REDACTED]"

  # ─────────────────────────────────────────────────────────────────────────
  # Fallback Response
  # ─────────────────────────────────────────────────────────────────────────
  fallback:
    # Response when safety check fails and no sanitization possible
    response: |
      I want to make sure I'm being helpful in a safe way.
      Could you tell me more about what you're looking for?
      I'm here to support your recovery journey.
```

### components/evaluation.yaml

```yaml
# config/components/evaluation.yaml
# Response Evaluation Configuration

version: "1.0"

evaluation:
  # ─────────────────────────────────────────────────────────────────────────
  # Evaluator Selection
  # ─────────────────────────────────────────────────────────────────────────
  evaluator:
    # Provider selection
    # Options: llm | stub
    type: "${USE_STUBS == 'true' || ANTHROPIC_API_KEY == '' ? 'stub' : 'llm'}"

    # Evaluation mode
    # Options:
    #   always     - Evaluate every response
    #   on_demand  - Only when explicitly requested
    #   sample:N   - Evaluate N% of responses
    #   crisis     - Only evaluate crisis-level >= threshold
    mode: "${EVALUATION_MODE:-on_demand}"

    # For crisis mode, minimum level to trigger evaluation
    min_crisis_level: 4

  # ─────────────────────────────────────────────────────────────────────────
  # LLM Evaluator Settings
  # ─────────────────────────────────────────────────────────────────────────
  llm:
    model: claude-3-haiku-20240307
    max_tokens: 512
    temperature: 0.1

    timeout_ms: 5000

  # ─────────────────────────────────────────────────────────────────────────
  # Evaluation Criteria
  # ─────────────────────────────────────────────────────────────────────────
  criteria:
    # Each criterion is scored 0.0 - 1.0

    quality:
      weight: 0.25
      description: "Overall response quality and coherence"

    empathy:
      weight: 0.30
      description: "Demonstrates understanding and compassion"

    relevance:
      weight: 0.20
      description: "Addresses user's actual concern"

    recovery_focus:
      weight: 0.25
      description: "Supports recovery goals appropriately"

  # ─────────────────────────────────────────────────────────────────────────
  # Score Thresholds
  # ─────────────────────────────────────────────────────────────────────────
  thresholds:
    # Minimum acceptable overall score
    minimum: 0.6

    # Target score for "good" responses
    target: 0.8

    # Score below which to flag for human review
    review_threshold: 0.5

  # ─────────────────────────────────────────────────────────────────────────
  # Metrics and Logging
  # ─────────────────────────────────────────────────────────────────────────
  metrics:
    # Track score distribution
    histogram_buckets: [0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]

    # Log low scores for review
    log_below_threshold: true

    # Export to external monitoring
    export:
      enabled: true
      destination: prometheus
```

---

## Profile Configuration

### profiles/base.yaml

```yaml
# config/profiles/base.yaml
# Base configuration - always loaded first

version: "1.0"
profile: base

# Default settings that all profiles inherit
defaults:
  pipeline:
    total_timeout_ms: 60000
    failure_strategy: abort

  memory:
    orchestrator:
      l1_message_limit: 20
      l2_message_limit: 100

  crisis:
    detector:
      target_latency_ms: 10

  agent:
    provider:
      timeout_ms: 30000
```

### profiles/development.yaml

```yaml
# config/profiles/development.yaml
# Development profile - uses in-memory stubs

version: "1.0"
profile: development
extends: base

description: |
  Development configuration using in-memory stubs for all external services.
  Fast startup, no external dependencies required.

overrides:
  # Use in-memory providers for all tiers
  memory:
    tiers:
      l1:
        provider: in_memory
      l2:
        provider: in_memory
      l3:
        enabled: false
      l4:
        enabled: false

    extraction:
      mode: none

  # Use mock agent
  agent:
    provider:
      type: mock
      mock:
        delay_ms: 50

  # Use stub validators
  safety:
    validator:
      type: stub

  evaluation:
    evaluator:
      type: stub

  crisis:
    handler:
      provider: stub
    deep_evaluator:
      enabled: false
```

### profiles/production.yaml

```yaml
# config/profiles/production.yaml
# Production profile - full infrastructure

version: "1.0"
profile: production
extends: base

description: |
  Production configuration with full external infrastructure.
  Requires all environment variables to be set.

# Required environment variables for this profile
requires:
  - ANTHROPIC_API_KEY
  - DATABASE_URL
  - REDIS_URL

# Recommended but optional
recommends:
  - NEO4J_URI
  - QDRANT_URL
  - OPENAI_API_KEY
  - CRISIS_WEBHOOK_URL

overrides:
  memory:
    tiers:
      l1:
        provider: redis
        connection:
          pool:
            min_connections: 5
            max_connections: 20

      l2:
        provider: postgresql
        connection:
          pool:
            min_connections: 10
            max_connections: 50

      l3:
        enabled: true
        provider: neo4j

      l4:
        enabled: true
        provider: qdrant

    extraction:
      mode: all

  agent:
    provider:
      type: vercel_ai

  safety:
    validator:
      type: full
      full:
        enable_llm_detection: true

  evaluation:
    evaluator:
      type: llm
      mode: crisis
```

### profiles/testing.yaml

```yaml
# config/profiles/testing.yaml
# Testing profile - deterministic behavior

version: "1.0"
profile: testing
extends: development

description: |
  Testing configuration with deterministic behavior.
  All randomness removed, fixed responses for assertions.

overrides:
  agent:
    provider:
      mock:
        delay_ms: 0  # No delay in tests
        deterministic: true

  memory:
    extraction:
      mode: none  # No LLM calls in tests

  # Disable async operations for predictable tests
  pipeline:
    stages:
      persist:
        blocking: true  # Wait for persistence in tests
```

---

## Pipeline Execution Model

### Stage Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           STAGE TYPE REFERENCE                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  COMPONENT STAGE                                                            │
│  ════════════════                                                           │
│                                                                             │
│  Executes a single component with inputs/outputs.                           │
│                                                                             │
│  - name: my_stage                                                           │
│    component: package.component_name                                        │
│    inputs: [...]                                                            │
│    outputs: [...]                                                           │
│    timeout_ms: 1000                                                         │
│    on_failure: abort | continue | retry | fallback                          │
│                                                                             │
│       ┌─────────────┐                                                       │
│       │  Component  │                                                       │
│       │             │                                                       │
│  ───▶ │   inputs    │ ───▶ outputs                                          │
│       │             │                                                       │
│       └─────────────┘                                                       │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  PARALLEL STAGE                                                             │
│  ═══════════════                                                            │
│                                                                             │
│  Executes multiple branches concurrently, merging outputs.                  │
│                                                                             │
│  - name: parallel_work                                                      │
│    type: parallel                                                           │
│    strategy: wait_all | wait_any | wait_required                            │
│    branches:                                                                │
│      - name: branch_a                                                       │
│        required: true                                                       │
│      - name: branch_b                                                       │
│        required: false                                                      │
│    merge:                                                                   │
│      strategy: deep_merge | first_wins | custom                             │
│                                                                             │
│            ┌─────────────┐                                                  │
│       ┌───▶│  Branch A   │───┐                                              │
│       │    └─────────────┘   │                                              │
│  ─────┤                      ├───▶ Merged Output                            │
│       │    ┌─────────────┐   │                                              │
│       └───▶│  Branch B   │───┘                                              │
│            └─────────────┘                                                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  GATE STAGE                                                                 │
│  ═══════════                                                                │
│                                                                             │
│  Conditional branching based on runtime values.                             │
│                                                                             │
│  - name: my_gate                                                            │
│    type: gate                                                               │
│    condition: "crisis_level >= 9"                                           │
│    if_true:                                                                 │
│      execute: [...]                                                         │
│      then: return | continue                                                │
│    if_false: continue                                                       │
│                                                                             │
│                  ┌─────────────┐                                            │
│             ────▶│  Condition  │                                            │
│                  └──────┬──────┘                                            │
│                         │                                                   │
│              ┌──────────┴──────────┐                                        │
│              │                     │                                        │
│          [true]               [false]                                       │
│              │                     │                                        │
│              ▼                     ▼                                        │
│       ┌───────────┐         ┌───────────┐                                   │
│       │  Execute  │         │ Continue  │                                   │
│       │  + Return │         │           │                                   │
│       └───────────┘         └───────────┘                                   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  ASYNC STAGE                                                                │
│  ════════════                                                               │
│                                                                             │
│  Fire-and-forget execution that doesn't block the pipeline.                 │
│                                                                             │
│  - name: background_work                                                    │
│    type: async                                                              │
│    blocking: false                                                          │
│    branches:                                                                │
│      - name: persist_data                                                   │
│      - name: send_metrics                                                   │
│                                                                             │
│                  ┌─────────────┐                                            │
│             ────▶│   Spawn     │────▶ Continue immediately                  │
│                  └──────┬──────┘                                            │
│                         │                                                   │
│                   (background)                                              │
│                         │                                                   │
│                         ▼                                                   │
│                  ┌─────────────┐                                            │
│                  │  Execute    │                                            │
│                  │  async      │                                            │
│                  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  RETURN STAGE                                                               │
│  ═════════════                                                              │
│                                                                             │
│  Assembles and returns the final pipeline output.                           │
│                                                                             │
│  - name: response                                                           │
│    type: return                                                             │
│    value:                                                                   │
│      response: "$.final_response"                                           │
│      metrics: "$.pipeline_metrics"                                          │
│                                                                             │
│       ┌─────────────┐                                                       │
│  ────▶│  Assemble   │────▶ Pipeline Output                                  │
│       │  Response   │                                                       │
│       └─────────────┘                                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Expression Language

The DSL uses JSONPath-like expressions for data binding:

```yaml
# Reference pipeline context values
"$.request.message"           # Input message
"$.crisis_level"              # Output from previous stage
"$.assembled_context.profile" # Nested value

# Environment variable interpolation
"${REDIS_URL}"                # Required env var
"${REDIS_URL:-localhost}"     # With default
"${REDIS_URL ? 'yes' : 'no'}" # Conditional

# Config value references
"${config.memory.tiers.l1.enabled}"

# Conditional expressions
"crisis_level >= 9"
"safety_passed == true"
"sanitized_response != null"

# Logical operators
"crisis_level >= 4 && detected_patterns.length > 0"
"provider == 'redis' || provider == 'in_memory'"
```

---

## Config Loader Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONFIG LOADER FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

     Environment Variables                    Profile Selection
            │                                       │
            │  RECOVERYSKY_PROFILE=production       │
            │  REDIS_URL=...                        │
            │  DATABASE_URL=...                     │
            │                                       │
            ▼                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CONFIG LOADER                                    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  1. LOAD BASE FILES                                                  │   │
│  │                                                                       │   │
│  │  pipeline.yaml ─────────────────────────────────────────────────────┐│   │
│  │  components/memory.yaml ────────────────────────────────────────────┤│   │
│  │  components/crisis.yaml ────────────────────────────────────────────┤│   │
│  │  components/agent.yaml ─────────────────────────────────────────────┤│   │
│  │  components/safety.yaml ────────────────────────────────────────────┤│   │
│  │  components/evaluation.yaml ────────────────────────────────────────┘│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  2. APPLY PROFILE                                                    │   │
│  │                                                                       │   │
│  │  profiles/base.yaml ──────────────────────────────────────────────┐ │   │
│  │  profiles/{PROFILE}.yaml ─────────────────────────────────────────┘ │   │
│  │                                                                       │   │
│  │  Merge strategy: Deep merge with profile overrides winning           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  3. INTERPOLATE ENVIRONMENT VARIABLES                                │   │
│  │                                                                       │   │
│  │  "${REDIS_URL}" ──────▶ "redis://localhost:6379"                     │   │
│  │  "${DATABASE_URL}" ───▶ "postgresql://..."                           │   │
│  │  "${FEATURE:-default}" ▶ "default" (if not set)                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  4. VALIDATE AGAINST SCHEMA                                          │   │
│  │                                                                       │   │
│  │  schema/pipeline.schema.json                                         │   │
│  │  schema/memory.schema.json                                           │   │
│  │  ...                                                                  │   │
│  │                                                                       │   │
│  │  ✓ Required fields present                                           │   │
│  │  ✓ Types correct                                                     │   │
│  │  ✓ Enums valid                                                       │   │
│  │  ✓ Constraints satisfied                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  5. RESOLVE COMPONENT REFERENCES                                     │   │
│  │                                                                       │   │
│  │  "memory.orchestrator" ──▶ MemoryOrchestrator class                  │   │
│  │  "crisis.detector" ──────▶ KeywordCrisisDetector class               │   │
│  │  "agent.provider" ───────▶ VercelAIAgentProvider class               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                     │                                       │
│                                     ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  6. BUILD PIPELINE                                                   │   │
│  │                                                                       │   │
│  │  Instantiate components with resolved config                         │   │
│  │  Wire up stage dependencies                                          │   │
│  │  Create execution graph                                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
                         ┌─────────────────────┐
                         │   Ready Pipeline    │
                         │                     │
                         │   pipeline.process  │
                         │   (message, ctx)    │
                         └─────────────────────┘
```

---

## Implementation Considerations

### Package Structure

```
packages/
└── config/                      # NEW: @recoverysky/config package
    ├── src/
    │   ├── loader/
    │   │   ├── ConfigLoader.ts      # Main loader class
    │   │   ├── ProfileResolver.ts   # Profile inheritance
    │   │   ├── EnvInterpolator.ts   # Environment variable handling
    │   │   └── SchemaValidator.ts   # JSON Schema validation
    │   │
    │   ├── parser/
    │   │   ├── YamlParser.ts        # YAML parsing with custom tags
    │   │   ├── ExpressionParser.ts  # JSONPath-like expressions
    │   │   └── ConditionEvaluator.ts # Boolean expression evaluation
    │   │
    │   ├── builder/
    │   │   ├── PipelineBuilder.ts   # Build pipeline from config
    │   │   ├── ComponentRegistry.ts # Map names to classes
    │   │   └── StageFactory.ts      # Create stage instances
    │   │
    │   ├── types/
    │   │   ├── config.ts            # TypeScript types for config
    │   │   ├── pipeline.ts          # Pipeline DSL types
    │   │   └── components.ts        # Component config types
    │   │
    │   └── index.ts
    │
    ├── schemas/                     # JSON Schemas
    │   ├── pipeline.schema.json
    │   ├── memory.schema.json
    │   └── ...
    │
    └── package.json
```

### TypeScript Type Generation

Generate TypeScript types from JSON Schema for type safety:

```typescript
// Generated from schemas
interface PipelineConfig {
  version: string
  name: string
  settings: PipelineSettings
  stages: Stage[]
}

interface Stage {
  name: string
  type?: 'parallel' | 'gate' | 'async' | 'return'
  component?: string
  timeout_ms?: number
  // ...
}

// Runtime validation
function loadConfig(profile: string): PipelineConfig {
  const raw = loadYamlFiles(profile)
  const interpolated = interpolateEnv(raw)
  const validated = validateSchema(interpolated)
  return validated as PipelineConfig
}
```

### Hot Reload Support (Future)

```typescript
interface ConfigWatcher {
  // Watch for config file changes
  watch(callback: (newConfig: PipelineConfig) => void): void

  // Gracefully apply new config
  reload(): Promise<void>

  // Validate before applying
  validateNew(config: unknown): ValidationResult
}
```

---

## Migration Path

### Phase 1: Config Files Only (Documentation)

Create config files that document current behavior without changing runtime:

1. Write all YAML config files
2. Add JSON schemas for validation
3. Generate TypeScript types
4. Use configs for documentation/reference

### Phase 2: Config Loader Package

Implement the config loading infrastructure:

1. Create `@recoverysky/config` package
2. Implement YAML parsing + interpolation
3. Implement schema validation
4. Implement profile merging

### Phase 3: Container Integration

Replace hardcoded container logic with config-driven creation:

1. Refactor `container.ts` to use ConfigLoader
2. Maintain backward compatibility via env vars
3. Add profile selection via `RECOVERYSKY_PROFILE`

### Phase 4: Pipeline Engine

Implement config-driven pipeline execution:

1. Create PipelineBuilder from config
2. Implement stage execution engine
3. Add parallel execution support
4. Add gate/conditional logic

### Phase 5: Full DSL

Complete the DSL implementation:

1. Dynamic stage ordering
2. Runtime stage enable/disable
3. A/B testing support
4. Config-driven observability

---

## Open Questions

1. **Expression Language Complexity** - How sophisticated should the condition expressions be? Full JavaScript-like syntax or simpler subset?

2. **Component Discovery** - Should components self-register, or use explicit registry mapping?

3. **Config Versioning** - How to handle config schema migrations between versions?

4. **Secrets Management** - Should we support secrets managers (Vault, AWS Secrets) directly, or rely on env var injection?

5. **Validation Timing** - Validate all at startup, or lazy-validate per-stage?

6. **Testing Support** - How to make config testing easy? Config diffing tools?

---

## Related Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) - Current system architecture
- [`../CLAUDE.md`](../CLAUDE.md) - Development commands
- [`concept/memory-system-architecture.md`](./concept/memory-system-architecture.md) - Memory tier design
