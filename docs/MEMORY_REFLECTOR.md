# Memory Reflector

Automatic insight generation using Claude Haiku to identify patterns and themes in conversations.

## The Problem

Entity extraction captures the *what* - John exists, anxiety is a concept, work triggers stress. But it misses the *so what*.

Raw entities are facts without interpretation. A knowledge graph full of entities tells you the user mentioned "work" 47 times and "anxiety" 32 times, but it doesn't tell you that work stress is escalating, or that the user's coping mechanisms are failing, or that there's a concerning pattern emerging.

Humans do this naturally. A good friend notices patterns: "You've been talking about work a lot lately. Are you okay?" They synthesize observations into insights. They remember not just what you said, but what it *meant*.

An AI companion needs the same capability - the ability to step back, look at the broader picture, and extract meaning from the noise.

## The Idea

Periodically reflect on recent conversations and generate high-level insights.

Instead of extracting facts from individual messages, the Memory Reflector looks at *windows* of conversation and asks: "What's the bigger picture here? What patterns are emerging? What should I remember about this person?"

This produces different kinds of knowledge than entity extraction:

- **Themes** - "User is struggling with work-life balance" (not just "work exists")
- **Patterns** - "Anxiety increases when discussing family" (not just "anxiety exists")
- **Concerns** - "Sleep issues persisting for 2+ weeks may need attention"
- **Dynamics** - "Relationship with therapist is positive and supportive"

These insights become observations in L3, attached to relevant entities, searchable by embedding. When the agent retrieves context about "work," it doesn't just see that work exists - it sees that work has been a source of stress, that it's connected to sleep issues, that the pattern has been escalating.

## Why This Matters

The Memory Reflector transforms Siri from a listener into an understander.

Without reflection, the agent processes conversations transactionally. Each message is extracted, stored, forgotten. The agent has memory but not *understanding*.

With reflection, the agent builds a coherent picture of the user's life. It notices patterns the user might not see themselves. It can say "I've noticed you've been mentioning work stress more often lately" because it actually *has* noticed.

This is the difference between a chatbot and a companion.

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Memory Reflector                                      │
│                                                                             │
│  "Hey Siri, work has been really stressful lately. My manager keeps        │
│   piling on deadlines and I haven't been sleeping well."                    │
│                                                                             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MemoryReflector                                      │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Claude Haiku                                     │   │
│  │                                                                      │   │
│  │  "Analyze this conversation. What patterns, themes, or insights     │   │
│  │   should be remembered long-term?"                                   │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Generated Insights                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Theme: "Work-related stress affecting sleep"                        │   │
│  │  Insight: "User is experiencing burnout symptoms - deadlines        │   │
│  │           from manager, sleep disruption"                            │   │
│  │  Suggestion: "Monitor for escalation; may need coping strategies"   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Stored as L3 Observation                             │
│                                                                             │
│  Linked to relevant entities: [work, manager, stress, sleep]                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## When Reflection Happens

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Reflection Triggers                                │
│                                                                          │
│   Trigger                          │ Condition                           │
│   ─────────────────────────────────┼───────────────────────────────────  │
│   Conversation depth               │ After N meaningful exchanges        │
│   Emotional content                │ Strong emotions detected            │
│   Session end                      │ User signs off or idle timeout      │
│   Periodic                         │ Every M minutes during long chats   │
│   Manual                           │ Agent decides context warrants it   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Reflection Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Reflection Pipeline                              │
│                                                                          │
│   1. Trigger condition met                                               │
│      │                                                                   │
│      ▼                                                                   │
│   2. Gather context window                                               │
│      │  ┌─────────────────────────────────────────────┐                 │
│      │  │ • Recent N messages                          │                 │
│      │  │ • Relevant entities from L3                  │                 │
│      │  │ • Previous reflections (avoid repetition)    │                 │
│      │  └─────────────────────────────────────────────┘                 │
│      │                                                                   │
│      ▼                                                                   │
│   3. Build reflection prompt                                             │
│      │  ┌─────────────────────────────────────────────┐                 │
│      │  │ "Given this conversation, identify:          │                 │
│      │  │  - Recurring themes                          │                 │
│      │  │  - Emotional patterns                        │                 │
│      │  │  - Important facts to remember               │                 │
│      │  │  - Relationship dynamics                     │                 │
│      │  │  - Potential concerns                        │                 │
│      │  │                                              │                 │
│      │  │ Do NOT repeat already-stored insights."      │                 │
│      │  └─────────────────────────────────────────────┘                 │
│      │                                                                   │
│      ▼                                                                   │
│   4. Call Claude Haiku                                                   │
│      │  (cheap, fast inference)                                         │
│      │                                                                   │
│      ▼                                                                   │
│   5. Parse structured output                                             │
│      │                                                                   │
│      ▼                                                                   │
│   6. Store as observations in L3                                         │
│      │  Linked to relevant entities                                     │
│      │                                                                   │
│      ▼                                                                   │
│   7. Queue for embedding generation                                      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Insight Types

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Insight Categories                                  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Theme                                                               │   │
│  │  ────────────────────────────────────────────────────────────────   │   │
│  │  Recurring topic or pattern across conversations                     │   │
│  │  Example: "Ongoing struggle with work-life balance"                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Emotional Pattern                                                   │   │
│  │  ────────────────────────────────────────────────────────────────   │   │
│  │  Consistent emotional response to triggers                           │   │
│  │  Example: "Anxiety spikes when discussing family"                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Relationship Dynamic                                                │   │
│  │  ────────────────────────────────────────────────────────────────   │   │
│  │  How user relates to people/things                                   │   │
│  │  Example: "Supportive relationship with therapist"                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Important Fact                                                      │   │
│  │  ────────────────────────────────────────────────────────────────   │   │
│  │  Concrete information to remember                                    │   │
│  │  Example: "Started new job on January 15th"                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Concern                                                             │   │
│  │  ────────────────────────────────────────────────────────────────   │   │
│  │  Something that may need monitoring                                  │   │
│  │  Example: "Sleep issues persisting for 2+ weeks"                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Deduplication

The reflector avoids storing redundant insights:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      Deduplication Strategy                               │
│                                                                          │
│   Before storing new insight:                                            │
│      │                                                                   │
│      ▼                                                                   │
│   1. Embed new insight (MiniLM)                                          │
│      │                                                                   │
│      ▼                                                                   │
│   2. Semantic search existing observations                               │
│      │                                                                   │
│      ▼                                                                   │
│   3. If similarity > 0.85:                                               │
│      │   ┌─────────────────────────────────────────────┐                │
│      │   │ Skip storage (already captured)              │                │
│      │   │ OR merge into existing observation           │                │
│      │   └─────────────────────────────────────────────┘                │
│      │                                                                   │
│      ▼                                                                   │
│   4. Else: Store as new observation                                      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Example Output

```json
{
  "insights": [
    {
      "type": "theme",
      "content": "User is experiencing work-related burnout",
      "entities": ["work", "manager", "stress"],
      "confidence": 0.9
    },
    {
      "type": "emotional_pattern",
      "content": "Stress from work is disrupting sleep patterns",
      "entities": ["stress", "sleep"],
      "confidence": 0.85
    },
    {
      "type": "concern",
      "content": "Sleep disruption may escalate without intervention",
      "entities": ["sleep"],
      "confidence": 0.7
    }
  ]
}
```

## Design Decisions

### Why Periodic Instead of Per-Message?

Entity extraction runs on every substantive message. Reflection runs less frequently. Why?

1. **Context matters** - Patterns emerge across messages, not within them. Reflecting on a single message misses the forest for the trees.
2. **Cost** - Reflection prompts are longer (they include multiple messages) and more expensive. Running per-message would be cost-prohibitive.
3. **Redundancy** - Most messages don't introduce new patterns. Reflecting constantly would generate repetitive insights.

The sweet spot: reflect after significant conversational milestones (session end, emotional peaks, periodic intervals).

### Why Store as Observations?

Insights could be stored as:
- Separate "insight" nodes
- Properties on user profiles
- Standalone documents

We store them as observations (linked to entities) because:

1. **Searchable** - Observations have embeddings. We can find insights semantically.
2. **Contextual** - Linking to entities provides context. "Work stress escalating" is attached to the "work" entity.
3. **Unified schema** - Observations from extraction and reflection use the same structure. No special-casing in queries.

### Why Deduplication?

The same insight might emerge from multiple reflections. "User experiences work stress" could be generated today, tomorrow, next week.

Without deduplication, we'd accumulate redundant observations. The knowledge graph would bloat with near-identical content. Retrieval would return duplicates.

Semantic deduplication (comparing embeddings) catches variations: "work stress is an issue" and "experiencing stress at work" are semantically similar even if textually different. We merge or skip duplicates to keep the graph clean.

### Why Confidence Scores?

Reflection is inherently uncertain. Some insights are clear ("user mentioned they have a therapist"). Others are inferred ("user seems to be struggling with burnout").

Confidence scores capture this uncertainty:
- High confidence (>0.8): Clear, explicit patterns
- Medium confidence (0.5-0.8): Reasonable inferences
- Low confidence (<0.5): Speculative observations

We don't discard low-confidence insights - they might be valuable - but we weight them appropriately in retrieval.

## Trade-offs

### Insight Depth vs. Frequency

More frequent reflection catches emerging patterns faster but generates shallower insights. Less frequent reflection provides deeper analysis but might miss rapidly evolving situations.

Current balance: reflect at session boundaries and during emotionally intense periods, with periodic fallback for long conversations.

### Privacy vs. Capability

Reflection involves sending conversation summaries to Claude. For privacy-sensitive users, this might be concerning.

Mitigations:
- Reflection can be disabled entirely
- Conversations aren't stored by Anthropic (API usage)
- Insights are stored locally, not in the cloud

### Hallucination Risk

LLMs can hallucinate. The reflector might generate insights that aren't supported by the conversation.

Mitigations:
- Prompt engineering to encourage grounded analysis
- Confidence scores flag uncertain insights
- Human review of generated insights (for production)
- Observations can be invalidated/deleted if wrong

## Source Files

- [`packages/memory/src/reflection/MemoryReflector.ts`](../packages/memory/src/reflection/MemoryReflector.ts) - Main reflector
- [`packages/memory/src/stores/Neo4jKnowledgeStore.ts`](../packages/memory/src/stores/Neo4jKnowledgeStore.ts) - Observation storage
