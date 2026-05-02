# Metacognitive Retrieval (LLM Inner Dialogue)

A proposed system where the LLM actively generates questions about the user and context, uses tools to resolve them from memory tiers, and surfaces unresolved questions to the user.

## The Problem

Current memory retrieval is **passive**. The pipeline fetches context before the LLM sees the message:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Current: Passive Memory Retrieval                         │
│                                                                              │
│   User Message                                                               │
│        │                                                                     │
│        ▼                                                                     │
│   ┌─────────────────┐                                                        │
│   │ Memory Pipeline │  ← Retrieves context BEFORE LLM sees message          │
│   │                 │                                                        │
│   │  • Recent msgs  │    Questions like:                                     │
│   │  • User profile │    "What did they say about their therapist?"         │
│   │  • Entities     │    "How have they been feeling this week?"            │
│   │  • Observations │    "What coping strategies work for them?"            │
│   └────────┬────────┘                                                        │
│            │                                                                 │
│            ▼           These questions are NEVER ASKED                       │
│   ┌─────────────────┐  The LLM receives whatever the pipeline               │
│   │      LLM        │  decided to fetch - it can't request more             │
│   │                 │                                                        │
│   │  Responds with  │                                                        │
│   │  given context  │                                                        │
│   └─────────────────┘                                                        │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

The LLM might wonder "how do they feel about their job?" but has no way to ask. It responds with whatever context was pre-fetched, potentially missing crucial information that would make its response more empathetic, accurate, or helpful.

## The Idea

Give the LLM an **inner dialogue** - the ability to generate questions, attempt to resolve them via tools, and either:
1. Use the answers to enrich its response
2. Surface unresolved questions to the user directly

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    Proposed: Conscious Memory Retrieval                       │
│                                                                              │
│   User Message + Basic Context                                               │
│        │                                                                     │
│        ▼                                                                     │
│   ┌─────────────────┐                                                        │
│   │      LLM        │                                                        │
│   │                 │                                                        │
│   │  "I wonder..."  │ ← LLM generates curiosity questions                   │
│   │                 │                                                        │
│   └────────┬────────┘                                                        │
│            │                                                                 │
│            ▼                                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    Curiosity Tool                                    │   │
│   │                                                                      │   │
│   │   Questions:                         Resolution:                     │   │
│   │   ┌────────────────────────────┐    ┌────────────────────────────┐  │   │
│   │   │ "How do they feel about    │───▶│ Haiku extracts query       │  │   │
│   │   │  their job lately?"        │    │ → L2 semantic search       │  │   │
│   │   └────────────────────────────┘    │ → L3 entity lookup         │  │   │
│   │   ┌────────────────────────────┐    │ → L4 similarity search     │  │   │
│   │   │ "What coping strategies    │───▶│                            │  │   │
│   │   │  have worked for them?"    │    │ Returns: answers + gaps    │  │   │
│   │   └────────────────────────────┘    └────────────────────────────┘  │   │
│   │   ┌────────────────────────────┐                                    │   │
│   │   │ "Have they mentioned any   │───▶ No data found (gap)           │   │
│   │   │  upcoming stressors?"      │                                    │   │
│   │   └────────────────────────────┘                                    │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│            │                                                                 │
│            ▼                                                                 │
│   ┌─────────────────┐                                                        │
│   │      LLM        │                                                        │
│   │                 │                                                        │
│   │  Enriched       │  Has answers to resolved questions                    │
│   │  Response       │  Surfaces relevant gaps as questions to user          │
│   │                 │                                                        │
│   └─────────────────┘                                                        │
│                                                                              │
│   Response: "I remember you mentioned feeling stressed at work last week.   │
│   It sounds like the breathing exercises helped then. By the way, do you    │
│   have anything coming up that might be adding to the stress?"              │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Why This Matters

### From Reactive to Proactive

Current LLMs respond to what's in front of them. Conscious retrieval lets the LLM **actively seek** relevant information, like a thoughtful friend who remembers to ask "wait, didn't you have that big presentation coming up?"

### Surfaces Knowledge Gaps

When the LLM wonders something but can't find the answer, that's valuable signal:
- **If resolved**: LLM uses the information silently
- **If unresolved but relevant**: LLM asks the user, deepening the relationship
- **If unresolved and tangential**: LLM notes the gap for future reference

### More Natural Conversation

Humans don't just respond - they wonder, recall, and ask follow-up questions. This makes Siri feel more like a friend who genuinely thinks about you between messages.

## Architecture

### Phase 1: Question Generation

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Question Generation                                   │
│                                                                              │
│   Input: User message + basic context (recent messages, session state)       │
│                                                                              │
│   LLM generates structured curiosity:                                        │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  {                                                                      │ │
│   │    "questions": [                                                       │ │
│   │      {                                                                  │ │
│   │        "question": "How have they been feeling about work lately?",    │ │
│   │        "intent": "understand_emotional_context",                        │ │
│   │        "relevance": "high",                                             │ │
│   │        "timeframe": "past_week"                                         │ │
│   │      },                                                                  │ │
│   │      {                                                                  │ │
│   │        "question": "What coping strategies have helped them before?",  │ │
│   │        "intent": "find_effective_interventions",                        │ │
│   │        "relevance": "medium",                                           │ │
│   │        "timeframe": "all_time"                                          │ │
│   │      },                                                                  │ │
│   │      {                                                                  │ │
│   │        "question": "Are there upcoming events causing anticipatory     │ │
│   │                     stress?",                                           │ │
│   │        "intent": "identify_stressors",                                  │ │
│   │        "relevance": "medium",                                           │ │
│   │        "timeframe": "next_week"                                         │ │
│   │      }                                                                   │ │
│   │    ]                                                                     │ │
│   │  }                                                                       │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│   Constraints:                                                               │
│   • Max 3-5 questions per turn (cost control)                               │
│   • Questions ranked by relevance                                            │
│   • Timeframe hints guide query strategy                                     │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Phase 2: Query Translation (Haiku)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Query Translation                                     │
│                                                                              │
│   Each natural language question → concrete memory queries                   │
│                                                                              │
│   Input: "How have they been feeling about work lately?"                     │
│                                                                              │
│   Haiku translates to:                                                       │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  {                                                                      │ │
│   │    "L2_semantic": {                                                     │ │
│   │      "query": "feeling about work stress job",                         │ │
│   │      "timeWindow": "7d",                                                │ │
│   │      "limit": 10                                                        │ │
│   │    },                                                                    │ │
│   │    "L3_entities": {                                                     │ │
│   │      "types": ["concept", "event"],                                     │ │
│   │      "labels": ["work", "job", "career", "stress"],                    │ │
│   │      "withObservations": true                                           │ │
│   │    },                                                                    │ │
│   │    "L4_similarity": {                                                   │ │
│   │      "naturalQuery": "emotions and feelings about work and job",       │ │
│   │      "topK": 5,                                                         │ │
│   │      "threshold": 0.7                                                   │ │
│   │    }                                                                     │ │
│   │  }                                                                       │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│   Why Haiku?                                                                 │
│   • Fast (<500ms)                                                           │
│   • Cheap (~$0.0001 per translation)                                        │
│   • Good at structured extraction                                            │
│   • Can run in parallel for multiple questions                              │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Phase 3: Query Execution

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Query Execution                                      │
│                                                                              │
│   Parallel execution across memory tiers:                                    │
│                                                                              │
│   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│   │   L2 Query      │  │   L3 Query      │  │   L4 Query      │             │
│   │   (pgvector)    │  │   (Neo4j)       │  │   (Qdrant)      │             │
│   │                 │  │                 │  │                 │             │
│   │  Semantic       │  │  Entity +       │  │  Hybrid         │             │
│   │  search on      │  │  Observation    │  │  dense+sparse   │             │
│   │  messages       │  │  lookup         │  │  search         │             │
│   └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
│            │                    │                    │                       │
│            └────────────────────┼────────────────────┘                       │
│                                 │                                            │
│                                 ▼                                            │
│                    ┌─────────────────────────┐                               │
│                    │    Result Aggregation    │                              │
│                    │                          │                              │
│                    │  • Deduplicate           │                              │
│                    │  • Rank by relevance     │                              │
│                    │  • Format for LLM        │                              │
│                    │  • Note gaps             │                              │
│                    └─────────────────────────┘                               │
│                                                                              │
│   Output per question:                                                       │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  {                                                                      │ │
│   │    "question": "How have they been feeling about work lately?",        │ │
│   │    "resolved": true,                                                    │ │
│   │    "confidence": 0.8,                                                   │ │
│   │    "answer": "User mentioned feeling overwhelmed with deadlines on     │ │
│   │              Tuesday. Also noted positive feedback from manager on     │ │
│   │              the Johnson project.",                                     │ │
│   │    "sources": ["msg_abc123", "entity_work_stress"]                     │ │
│   │  }                                                                       │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│   Or if unresolved:                                                          │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  {                                                                      │ │
│   │    "question": "Are there upcoming events causing stress?",            │ │
│   │    "resolved": false,                                                   │ │
│   │    "confidence": 0.0,                                                   │ │
│   │    "answer": null,                                                      │ │
│   │    "surfaceToUser": true,  // LLM may want to ask this                 │ │
│   │    "suggestedPhrasing": "Do you have anything coming up that's been   │ │
│   │                          on your mind?"                                 │ │
│   │  }                                                                       │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Phase 4: Response Enrichment

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Response Enrichment                                    │
│                                                                              │
│   LLM receives:                                                              │
│   • Original user message                                                    │
│   • Basic context (recent messages, profile)                                 │
│   • Resolved questions with answers                                          │
│   • Unresolved questions marked for potential surfacing                      │
│                                                                              │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  System: You have access to resolved curiosity questions. Use these   │ │
│   │  to inform your response. For unresolved questions marked             │ │
│   │  "surfaceToUser", consider asking naturally if relevant.              │ │
│   │                                                                        │ │
│   │  Resolved:                                                             │ │
│   │  - Q: "How have they been feeling about work?"                        │ │
│   │    A: "Overwhelmed with deadlines Tuesday, positive feedback on       │ │
│   │       Johnson project"                                                  │ │
│   │                                                                        │ │
│   │  - Q: "What coping strategies have helped?"                           │ │
│   │    A: "Breathing exercises (mentioned 3x), walking (mentioned 2x)"    │ │
│   │                                                                        │ │
│   │  Unresolved (may surface):                                             │ │
│   │  - Q: "Are there upcoming events causing stress?"                     │ │
│   │    Suggested: "Do you have anything coming up that's been on your     │ │
│   │               mind?"                                                    │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│   LLM response:                                                              │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  "It sounds like you've had a lot going on at work - deadlines and    │ │
│   │  all. But hey, that positive feedback on the Johnson project is       │ │
│   │  something to feel good about! I remember those breathing exercises   │ │
│   │  helped last time things felt overwhelming. Maybe worth trying        │ │
│   │  again? Also, is there anything coming up this week that's been on    │ │
│   │  your mind?"                                                            │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│   The response:                                                              │
│   • References resolved context naturally (deadlines, feedback)             │
│   • Suggests known-effective coping strategy (breathing)                    │
│   • Surfaces unresolved question naturally (upcoming events)                │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Tool Definition

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          wonderAbout Tool                                     │
│                                                                              │
│   Name: wonderAbout                                                          │
│   Description: "Generate and resolve questions about the user to provide    │
│                 more thoughtful, contextual responses"                       │
│                                                                              │
│   Parameters:                                                                │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  questions: [                                                           │ │
│   │    {                                                                    │ │
│   │      question: string      // Natural language question                │ │
│   │      intent: string        // Why this matters for the response        │ │
│   │      relevance: "high" | "medium" | "low"                              │ │
│   │      timeframe?: "recent" | "past_week" | "past_month" | "all_time"    │ │
│   │    }                                                                    │ │
│   │  ]                                                                       │ │
│   │  maxQuestions?: number     // Cost control, default 3                   │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│   Returns:                                                                   │
│   ┌────────────────────────────────────────────────────────────────────────┐ │
│   │  {                                                                      │ │
│   │    resolved: [                                                          │ │
│   │      { question, answer, confidence, sources }                         │ │
│   │    ],                                                                    │ │
│   │    unresolved: [                                                        │ │
│   │      { question, suggestedPhrasing, surfaceToUser }                    │ │
│   │    ]                                                                     │ │
│   │  }                                                                       │ │
│   └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│   Usage in conversation:                                                     │
│   1. LLM receives message                                                    │
│   2. LLM decides to use wonderAbout with relevant questions                 │
│   3. Tool resolves questions from memory tiers                              │
│   4. LLM incorporates answers into response                                 │
│   5. LLM optionally surfaces unresolved questions to user                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Implementation Considerations

### Cost Control

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Cost Analysis                                       │
│                                                                              │
│   Per wonderAbout call (3 questions):                                        │
│                                                                              │
│   Component              │ Model    │ Tokens  │ Cost                         │
│   ───────────────────────┼──────────┼─────────┼─────────────────────────────  │
│   Query translation      │ Haiku    │ ~500    │ $0.0001                      │
│   L2 semantic search     │ -        │ -       │ Free (just DB)               │
│   L3 entity lookup       │ -        │ -       │ Free (just DB)               │
│   L4 similarity search   │ -        │ -       │ Free (just DB)               │
│   Answer synthesis       │ Haiku    │ ~300    │ $0.00006                     │
│   ───────────────────────┼──────────┼─────────┼─────────────────────────────  │
│   Total per call         │          │ ~800    │ ~$0.00016                    │
│                                                                              │
│   At 100 messages/day: ~$0.016/day additional cost                          │
│                                                                              │
│   Optimization strategies:                                                   │
│   • Cache common questions/answers                                          │
│   • Skip wonderAbout for simple messages ("hi", "thanks")                   │
│   • Limit to 1-2 questions for low-complexity conversations                 │
│   • Batch questions to single Haiku call                                    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### When to Trigger

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Trigger Conditions                                   │
│                                                                              │
│   ALWAYS trigger:                                                            │
│   • User expresses strong emotion                                            │
│   • Message mentions struggles, challenges, decisions                        │
│   • First message in a new session                                           │
│   • Message references past events ("remember when...")                      │
│                                                                              │
│   SOMETIMES trigger:                                                         │
│   • General conversation (based on LLM judgment)                            │
│   • Updates or check-ins                                                     │
│                                                                              │
│   NEVER trigger:                                                             │
│   • Simple greetings ("hi", "hey")                                          │
│   • Acknowledgments ("ok", "thanks", "got it")                              │
│   • Crisis situations (bypass for speed)                                     │
│   • Tool result processing                                                   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Quality Signals

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           Quality Signals                                     │
│                                                                              │
│   Good wonderAbout questions:                                                │
│   ✓ "What has helped them cope with work stress before?"                    │
│   ✓ "How did they feel after the conversation with their mom?"             │
│   ✓ "Have they mentioned any progress on their goals?"                      │
│                                                                              │
│   Bad wonderAbout questions:                                                 │
│   ✗ "What is their name?" (already in context)                              │
│   ✗ "What did they just say?" (in current message)                          │
│   ✗ "What's the weather like?" (not about the user)                         │
│                                                                              │
│   Question quality scoring:                                                  │
│   • Relevance to current message (0-1)                                      │
│   • Likelihood of having stored data (0-1)                                  │
│   • Value for response quality (0-1)                                        │
│                                                                              │
│   Filter questions below 0.5 combined score                                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Why Let the LLM Generate Questions?

The LLM understands conversational context better than any rule-based system. It knows when "I'm stressed" warrants wondering about coping strategies vs. when it's a passing comment. Letting the LLM drive curiosity produces more natural, relevant questions.

### Why Use Haiku for Translation?

Query translation is a structured extraction task - perfect for a fast, cheap model. Haiku can turn "How do they feel about work?" into specific L2/L3/L4 queries in <500ms for ~$0.0001. Using the main model would be slower and more expensive for no quality gain.

### Why Surface Unresolved Questions?

When the LLM wonders something relevant but can't find the answer, that gap is valuable:
1. It prompts the user to share, deepening the relationship
2. It signals that Siri genuinely thinks about them
3. It fills knowledge gaps for future conversations

### Why Not Always Trigger?

Cost and latency. wonderAbout adds ~500ms and ~$0.0002 per call. For "hi" or "thanks", that's wasted. The LLM should decide when curiosity serves the conversation.

## Trade-offs

### Latency vs. Depth

wonderAbout adds 300-800ms to response time. Trade-off:
- **Pro**: Richer, more contextual responses
- **Con**: Slightly slower responses

Mitigation: Parallel query execution, caching, selective triggering.

### Cost vs. Quality

Each wonderAbout call costs ~$0.0002. Trade-off:
- **Pro**: Better responses, more natural conversation
- **Con**: ~$0.02/day additional cost at moderate usage

Acceptable for a personal AI companion. Adjust trigger threshold if needed.

### Complexity vs. Benefit

This adds significant system complexity. Trade-off:
- **Pro**: Genuinely new capability (active vs. passive memory)
- **Con**: More code, more failure modes, harder to debug

Worth it for the qualitative improvement in conversation feel.

## Future Enhancements

### Question Learning

Track which questions lead to useful answers. Over time, learn patterns:
- "Questions about coping strategies are usually valuable after stress mentions"
- "Questions about specific people rarely have data"

### Proactive Wondering

Trigger wonderAbout between sessions - Siri "thinking about" the user:
- Generate questions overnight
- Pre-resolve them
- Have context ready for next conversation

### Shared Curiosity

Let the user see what Siri is wondering:
- "I was curious about how the presentation went, but I don't think you've told me yet!"
- Builds transparency and trust

## Source Files (Planned)

- `packages/tools/src/tools/wonderAbout.ts` - Tool definition
- `packages/memory/src/curiosity/QuestionGenerator.ts` - Question generation
- `packages/memory/src/curiosity/QueryTranslator.ts` - Haiku-based translation
- `packages/memory/src/curiosity/CuriosityResolver.ts` - Orchestration

## Related Documentation

- [Memory Tiers](MEMORY_TIERS.md) - L1-L4 architecture queried by this system
- [Entity Extraction](ENTITY_EXTRACTION.md) - Entities available for queries
- [Deep Memory](DEEPMEMORY.md) - Context enrichment for resolved answers
- [Tools](../packages/tools/README.md) - Tool framework for wonderAbout
