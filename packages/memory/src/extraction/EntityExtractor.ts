/**
 * Entity Extractor - LLM-based entity extraction for knowledge graph
 *
 * Uses Claude Haiku to extract entities and relationships from conversations.
 * Configurable via environment variables for mode, model, and extraction settings.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type {
  IKnowledgeStore,
  Entity,
  Message,
  TraceContext,
  Result,
  CanonicalType,
  SourceEntry,
} from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan, pipelineMetrics } from '@recoverysky/observability'
import type { Neo4jKnowledgeStore } from '../stores/Neo4jKnowledgeStore.js'

/**
 * Extraction modes
 */
export type ExtractionMode = 'all' | 'none' | `sample:${number}` | 'significant'

/**
 * Entity types that can be extracted
 */
export type EntityType =
  | 'person'
  | 'place'
  | 'event'
  | 'emotion'
  | 'trigger'
  | 'coping_strategy'
  | 'milestone'
  | 'medication'

/**
 * Configuration for entity extraction
 */
export interface EntityExtractorConfig {
  /** When to run extraction */
  mode: ExtractionMode
  /** LLM model to use */
  model: string
  /** Which entity types to extract */
  enabledTypes: EntityType[]
  /** Minimum importance score to store (0-1) */
  minImportance: number
  /** Whether to infer relationships between entities */
  inferRelationships: boolean
}

/**
 * Entity extracted from conversation
 */
export interface ExtractedEntity {
  name: string
  type: EntityType
  importance: number
  context: string
  /** Original casing of the name (L3 Memory) */
  displayName?: string
  /** Freeform labels (L3 Memory) */
  labels?: string[]
  /** Alternative names (L3 Memory) */
  aliases?: string[]
}

/**
 * Observation extracted from conversation (L3 Memory)
 * Facts or insights about entities
 */
export interface ExtractedObservation {
  /** Entity this observation is about */
  entityName: string
  /** The factual content */
  content: string
  /** Confidence 0-1 */
  confidence: number
}

/**
 * Relationship between entities with rich context
 */
export interface ExtractedRelationship {
  from: string
  to: string
  type: string
  strength: number
  /** Rich context about the relationship - graph-native properties */
  properties?: {
    /** How/why this relationship exists */
    context?: string
    /** When this relationship was established or observed */
    when?: string
    /** Method or way the relationship manifests */
    method?: string
    /** Frequency of the relationship (for triggers, etc.) */
    frequency?: string
    /** Additional notes */
    notes?: string
  }
}

/**
 * Result of extraction
 */
export interface ExtractionResult {
  entities: ExtractedEntity[]
  relationships: ExtractedRelationship[]
  /** Observations about entities (L3 Memory) */
  observations?: ExtractedObservation[]
}

/**
 * Extraction error
 */
export interface ExtractionError {
  kind: 'LLMError' | 'ParseError' | 'StoreError' | 'ConfigError'
  message: string
  context: Record<string, unknown>
  cause?: unknown
}

/**
 * Default configuration
 */
export const DEFAULT_EXTRACTOR_CONFIG: EntityExtractorConfig = {
  mode: 'all',
  model: 'claude-3-haiku-20240307',
  enabledTypes: ['person', 'place', 'event', 'emotion', 'trigger', 'coping_strategy', 'milestone', 'medication'],
  minImportance: 0.3,
  inferRelationships: true,
}

/**
 * LLM prompt for entity extraction
 */
const EXTRACTION_PROMPT = `You are analyzing a conversation for an addiction recovery chatbot.
Extract meaningful entities and relationships from this exchange.

USER MESSAGE: {userMessage}
ASSISTANT RESPONSE: {assistantResponse}

Extract entities of these types (if present):
{enabledTypes}

For each entity, rate importance 0.0-1.0 based on:
- Relevance to recovery journey
- Emotional significance
- Recurrence in conversation

{relationshipInstructions}

Respond with ONLY a JSON object (no other text):
{
  "entities": [
    { "name": "entity name", "type": "entity_type", "importance": 0.0-1.0, "context": "brief context" }
  ],
  "relationships": [
    {
      "from": "entity1",
      "to": "entity2",
      "type": "RELATIONSHIP_TYPE",
      "strength": 0.0-1.0,
      "properties": {
        "context": "why or how this relationship exists",
        "when": "when it was mentioned/established (optional)",
        "method": "how it manifests (optional)"
      }
    }
  ]
}

If no meaningful entities are found, return: { "entities": [], "relationships": [] }`

const RELATIONSHIP_INSTRUCTIONS_ENABLED = `Also identify relationships between entities when clear. Use descriptive relationship types like:
- SPONSORS, SUPPORTS, HELPS_WITH (for supportive relationships)
- TRIGGERS, CAUSES, LEADS_TO (for trigger/consequence relationships)
- SUGGESTED, RECOMMENDED (for advice/suggestions)
- WORKS_AT, LIVES_AT, ATTENDS (for location relationships)
- RELATED_TO (for general connections)

IMPORTANT: For each relationship, include a "properties" object with:
- context: Why/how this relationship exists (required)
- when: When it was mentioned or established (if known)
- method: How the relationship manifests (if applicable)`

const TYPE_DESCRIPTIONS: Record<EntityType, string> = {
  person: 'person: People mentioned (sponsor, family, friends, therapist)',
  place: 'place: Locations meaningful to recovery (meetings, rehab, home)',
  event: 'event: Significant events (relapses, milestones, triggers)',
  emotion: 'emotion: Emotional states expressed',
  trigger: 'trigger: Identified addiction triggers',
  coping_strategy: 'coping_strategy: Coping mechanisms discussed',
  milestone: 'milestone: Recovery achievements',
  medication: 'medication: Any medications mentioned (MAT, etc.)',
}

/**
 * Map legacy entity types to L3 canonical types
 */
const CANONICAL_TYPE_MAPPING: Record<string, CanonicalType> = {
  // Direct mappings
  person: 'person',
  place: 'place',
  event: 'event',
  // Map to concept
  emotion: 'concept',
  trigger: 'concept',
  coping_strategy: 'concept',
  milestone: 'event',
  medication: 'thing',
  // Additional common types
  organization: 'organization',
  company: 'organization',
  team: 'organization',
  concept: 'concept',
  idea: 'concept',
  thing: 'thing',
  object: 'thing',
  product: 'thing',
}

/**
 * Convert any type string to a canonical type
 */
function toCanonicalType(type: string): CanonicalType {
  const normalized = type.toLowerCase().replace(/[^a-z_]/g, '_')
  return CANONICAL_TYPE_MAPPING[normalized] ?? 'concept'
}

/**
 * L3 Memory extraction prompt - extracts richer entity data and observations
 */
const L3_EXTRACTION_PROMPT = `You are analyzing a conversation to extract knowledge for a personal AI companion's memory system.

USER MESSAGE: {userMessage}
ASSISTANT RESPONSE: {assistantResponse}

Extract ENTITIES (people, places, things, concepts, events, organizations) and OBSERVATIONS (facts about entities).

For each ENTITY, provide:
- name: canonical lowercase name (e.g., "john smith")
- displayName: original casing as mentioned (e.g., "John Smith")
- type: one of [person, place, organization, concept, event, thing]
- labels: freeform descriptive tags (e.g., ["friend", "engineer", "coffee lover"])
- importance: 0.0-1.0 based on relevance and significance
- context: brief context about why this entity matters
- aliases: other names this entity goes by (optional)

For each OBSERVATION (facts learned about entities):
- entityName: which entity this fact is about (lowercase)
- content: the factual observation (e.g., "Works at Google as a senior engineer")
- confidence: 0.0-1.0 how certain is this fact

{relationshipInstructions}

Respond with ONLY a JSON object:
{
  "entities": [
    {
      "name": "john smith",
      "displayName": "John Smith",
      "type": "person",
      "labels": ["friend", "colleague"],
      "importance": 0.8,
      "context": "Close friend mentioned frequently",
      "aliases": ["johnny", "js"]
    }
  ],
  "observations": [
    {
      "entityName": "john smith",
      "content": "Works at Google as a senior engineer",
      "confidence": 0.9
    }
  ],
  "relationships": [
    {
      "from": "john smith",
      "to": "google",
      "type": "works_at",
      "strength": 0.9,
      "properties": {
        "context": "employment relationship",
        "when": "current"
      }
    }
  ]
}

If nothing meaningful is found, return: { "entities": [], "observations": [], "relationships": [] }`

export class EntityExtractor {
  private readonly config: EntityExtractorConfig
  /** L3 store for Cadillac memory features (optional) */
  private readonly l3Store: Neo4jKnowledgeStore | null = null
  /** Whether to use L3 Memory extraction (richer prompt, observations) */
  private readonly useL3Extraction: boolean

  constructor(
    private readonly client: Anthropic | null,
    private readonly knowledgeStore: IKnowledgeStore,
    config?: Partial<EntityExtractorConfig>,
    options?: {
      /** Enable L3 Memory features (observations, richer entities) */
      l3Store?: Neo4jKnowledgeStore
      /** Use L3 extraction prompt (default: true if l3Store provided) */
      useL3Extraction?: boolean
    }
  ) {
    this.config = { ...DEFAULT_EXTRACTOR_CONFIG, ...config }
    this.l3Store = options?.l3Store ?? null
    this.useL3Extraction = options?.useL3Extraction ?? (this.l3Store !== null)
  }

  /**
   * Extract entities from a conversation exchange
   */
  async extract(
    userMessage: Message,
    assistantMessage: Message,
    crisisLevel: number,
    ctx: TraceContext
  ): Promise<Result<ExtractionResult, ExtractionError>> {
    return withSpan('EntityExtractor.extract', async () => {
      const logger = getLogger().child({
        conversationId: userMessage.conversationId,
        userId: userMessage.userId,
        mode: this.config.mode,
        requestId: ctx.requestId,
      })

      // Check if we should extract based on mode
      if (!this.shouldExtract(crisisLevel)) {
        logger.debug({ reason: 'mode check failed' }, 'Skipping entity extraction')
        return ok({ entities: [], relationships: [] })
      }

      // Check if client is available
      if (!this.client) {
        logger.debug('No Anthropic client, skipping extraction')
        return ok({ entities: [], relationships: [] })
      }

      logger.debug('Starting entity extraction')

      // Call LLM for extraction
      const llmResult = await this.callLLM(
        userMessage.content,
        assistantMessage.content,
        ctx
      )

      if (!llmResult.ok) {
        return llmResult
      }

      // Filter by importance threshold
      const filtered = this.filterByImportance(llmResult.value)

      logger.info(
        {
          entitiesFound: filtered.entities.length,
          relationshipsFound: filtered.relationships.length,
        },
        'Entity extraction complete'
      )

      // Persist to knowledge store (non-blocking errors)
      await this.persist(filtered, userMessage, ctx)

      return ok(filtered)
    })
  }

  /**
   * Determine if extraction should run based on mode
   */
  private shouldExtract(crisisLevel: number): boolean {
    switch (this.config.mode) {
      case 'all':
        return true
      case 'none':
        return false
      case 'significant':
        return crisisLevel >= 4
      default:
        // Handle sample:N pattern
        if (this.config.mode.startsWith('sample:')) {
          const rate = parseInt(this.config.mode.split(':')[1], 10) / 100
          return Math.random() < rate
        }
        return true
    }
  }

  /**
   * Call LLM for entity extraction
   */
  private async callLLM(
    userContent: string,
    assistantContent: string,
    ctx: TraceContext
  ): Promise<Result<ExtractionResult, ExtractionError>> {
    return withSpan('EntityExtractor.callLLM', async () => {
      const logger = getLogger().child({ requestId: ctx.requestId, l3Mode: this.useL3Extraction })

      try {
        // Build prompt - use L3 prompt for richer extraction when enabled
        const relationshipInstructions = this.config.inferRelationships
          ? RELATIONSHIP_INSTRUCTIONS_ENABLED
          : 'Do not extract relationships, return an empty relationships array.'

        let prompt: string
        if (this.useL3Extraction) {
          prompt = L3_EXTRACTION_PROMPT
            .replace('{userMessage}', userContent)
            .replace('{assistantResponse}', assistantContent)
            .replace('{relationshipInstructions}', relationshipInstructions)
        } else {
          const enabledTypesText = this.config.enabledTypes
            .map((t) => `- ${TYPE_DESCRIPTIONS[t]}`)
            .join('\n')
          prompt = EXTRACTION_PROMPT
            .replace('{userMessage}', userContent)
            .replace('{assistantResponse}', assistantContent)
            .replace('{enabledTypes}', enabledTypesText)
            .replace('{relationshipInstructions}', relationshipInstructions)
        }

        const response = await this.client!.messages.create(
          {
            model: this.config.model,
            max_tokens: 1024,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          },
          {
            signal: AbortSignal.timeout(10000), // 10 second timeout
          }
        )

        const content = response.content[0]
        if (content.type !== 'text') {
          return err({
            kind: 'ParseError',
            message: 'LLM response was not text',
            context: { responseType: content.type },
          })
        }

        // Parse JSON from response
        const jsonMatch = content.text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) {
          logger.warn({ response: content.text }, 'Failed to parse LLM response as JSON')
          return err({
            kind: 'ParseError',
            message: 'Could not find JSON in LLM response',
            context: { response: content.text.slice(0, 200) },
          })
        }

        const result = JSON.parse(jsonMatch[0]) as {
          entities?: Array<{
            name: string
            displayName?: string
            type: string
            labels?: string[]
            importance: number
            context: string
            aliases?: string[]
          }>
          observations?: Array<{
            entityName: string
            content: string
            confidence: number
          }>
          relationships?: Array<{
            from: string
            to: string
            type: string
            strength: number
            properties?: {
              context?: string
              when?: string
              method?: string
              frequency?: string
              notes?: string
            }
          }>
        }

        // Validate and normalize - filter out entities with missing/null names
        const rawEntities = result.entities ?? []
        const invalidEntities = rawEntities.filter((e) =>
          e.name == null ||
          typeof e.name !== 'string' ||
          e.name.trim().length === 0
        )
        if (invalidEntities.length > 0) {
          logger.warn(
            { count: invalidEntities.length, samples: invalidEntities.slice(0, 3) },
            'Filtered out entities with invalid/null names from LLM response'
          )
        }

        // For L3 extraction, accept any type. For legacy, filter by enabled types
        const entities: ExtractedEntity[] = rawEntities
          .filter((e) =>
            e.name != null &&
            typeof e.name === 'string' &&
            e.name.trim().length > 0 &&
            (this.useL3Extraction || this.config.enabledTypes.includes(e.type as EntityType))
          )
          .map((e) => ({
            name: e.name.trim().toLowerCase(),
            type: (this.useL3Extraction ? toCanonicalType(e.type) : e.type) as EntityType,
            importance: Math.max(0, Math.min(1, e.importance ?? 0.5)),
            context: e.context ?? '',
            // L3 fields
            displayName: e.displayName ?? e.name.trim(),
            labels: e.labels ?? [],
            aliases: e.aliases ?? [],
          }))

        // Parse observations (L3 only)
        const observations: ExtractedObservation[] = (result.observations ?? [])
          .filter((o) =>
            o.entityName != null &&
            typeof o.entityName === 'string' &&
            o.content != null &&
            typeof o.content === 'string'
          )
          .map((o) => ({
            entityName: o.entityName.toLowerCase().trim(),
            content: o.content.trim(),
            confidence: Math.max(0, Math.min(1, o.confidence ?? 0.8)),
          }))

        // Validate and normalize relationships - filter out those with missing from/to/type
        const rawRelationships = result.relationships ?? []
        const invalidRelationships = rawRelationships.filter((r) =>
          r.from == null ||
          typeof r.from !== 'string' ||
          r.from.trim().length === 0 ||
          r.to == null ||
          typeof r.to !== 'string' ||
          r.to.trim().length === 0 ||
          r.type == null ||
          typeof r.type !== 'string'
        )
        if (invalidRelationships.length > 0) {
          logger.warn(
            { count: invalidRelationships.length, samples: invalidRelationships.slice(0, 3) },
            'Filtered out relationships with invalid/null from/to/type from LLM response'
          )
        }

        const relationships: ExtractedRelationship[] = this.config.inferRelationships
          ? rawRelationships
              .filter((r) =>
                r.from != null &&
                typeof r.from === 'string' &&
                r.from.trim().length > 0 &&
                r.to != null &&
                typeof r.to === 'string' &&
                r.to.trim().length > 0 &&
                r.type != null &&
                typeof r.type === 'string'
              )
              .map((r) => ({
                from: r.from.trim(),
                to: r.to.trim(),
                // For L3, keep lowercase type. For legacy, uppercase with sanitization
                type: this.useL3Extraction
                  ? r.type.toLowerCase().replace(/[^a-z0-9_]/g, '_')
                  : r.type.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
                strength: Math.max(0, Math.min(1, r.strength ?? 0.5)),
                properties: r.properties ? {
                  context: r.properties.context,
                  when: r.properties.when,
                  method: r.properties.method,
                  frequency: r.properties.frequency,
                  notes: r.properties.notes,
                } : undefined,
              }))
          : []

        return ok({ entities, relationships, observations: observations.length > 0 ? observations : undefined })
      } catch (error) {
        logger.error({ error }, 'LLM extraction failed')

        if (error instanceof SyntaxError) {
          return err({
            kind: 'ParseError',
            message: 'Failed to parse LLM response JSON',
            context: {},
            cause: error,
          })
        }

        return err({
          kind: 'LLMError',
          message: 'LLM extraction request failed',
          context: {},
          cause: error,
        })
      }
    })
  }

  /**
   * Filter entities by importance threshold
   */
  private filterByImportance(result: ExtractionResult): ExtractionResult {
    const filteredEntities = result.entities.filter(
      (e) => e.importance >= this.config.minImportance
    )

    // Build name resolution map for relationship filtering
    // This allows "John" in relationships to match "john smith" in entities
    const nameResolutionMap = this.buildNameResolutionMap(filteredEntities)

    // Filter relationships to only include those with resolvable entities
    const filteredRelationships = result.relationships.filter((r) => {
      const fromResolved = this.canResolveEntityName(r.from, nameResolutionMap)
      const toResolved = this.canResolveEntityName(r.to, nameResolutionMap)
      return fromResolved && toResolved
    })

    // Filter observations to only include those for entities we're keeping
    const entityNames = new Set(filteredEntities.map((e) => e.name.toLowerCase()))
    const filteredObservations = (result.observations ?? []).filter((o) =>
      entityNames.has(o.entityName.toLowerCase())
    )

    return {
      entities: filteredEntities,
      relationships: filteredRelationships,
      observations: filteredObservations.length > 0 ? filteredObservations : undefined,
    }
  }

  /**
   * Check if an entity name can be resolved to a stored entity.
   * Used for relationship filtering before persistence.
   */
  private canResolveEntityName(name: string, resolutionMap: Map<string, string>): boolean {
    const normalized = name.toLowerCase().trim()

    // Try exact match first
    if (resolutionMap.has(normalized)) {
      return true
    }

    // Try matching individual words from the input
    const words = normalized.split(/\s+/)
    for (const word of words) {
      if (resolutionMap.has(word)) {
        return true
      }
    }

    return false
  }

  /**
   * Persist extracted entities to knowledge store
   */
  private async persist(
    result: ExtractionResult,
    userMessage: Message,
    ctx: TraceContext
  ): Promise<void> {
    const logger = getLogger().child({ requestId: ctx.requestId, l3Mode: !!this.l3Store })
    const now = Date.now()
    const userId = userMessage.userId

    // Build name resolution map: LLM name variations → stored name
    // This handles cases where LLM uses "John" in relationships but "John Smith" in entities
    const nameResolutionMap = this.buildNameResolutionMap(result.entities)

    // Use L3 store if available
    if (this.l3Store) {
      await this.persistL3(result, userMessage, nameResolutionMap, ctx)
      return
    }

    // Legacy persistence path
    for (const entity of result.entities) {
      const entityRecord: Entity = {
        entityId: `${userId}_${entity.type}_${entity.name.toLowerCase().replace(/\s+/g, '_')}`,
        name: entity.name.toLowerCase(),
        type: entity.type,
        firstMentioned: now,
        lastMentioned: now,
        properties: {
          userId,
          importance: entity.importance,
          context: entity.context,
        },
      }

      const storeResult = await this.knowledgeStore.upsertEntity(entityRecord, ctx)
      if (!storeResult.ok) {
        logger.warn({ error: storeResult.error, entity: entity.name }, 'Failed to store entity')
      }
    }

    // Store relationships with rich properties
    for (const rel of result.relationships) {
      // Resolve relationship entity names to actual stored entity names
      const resolvedFrom = this.resolveEntityName(rel.from, nameResolutionMap, logger)
      const resolvedTo = this.resolveEntityName(rel.to, nameResolutionMap, logger)

      if (!resolvedFrom || !resolvedTo) {
        logger.warn(
          {
            from: rel.from,
            to: rel.to,
            resolvedFrom,
            resolvedTo,
            availableEntities: Array.from(nameResolutionMap.values()),
          },
          'Skipping relationship: could not resolve entity names to stored entities'
        )
        continue
      }

      const relResult = await this.knowledgeStore.createRelationship(
        resolvedFrom,
        resolvedTo,
        rel.type,
        {
          strength: rel.strength,
          userId,
          // Include rich context properties for graph-native storage
          ...(rel.properties?.context && { context: rel.properties.context }),
          ...(rel.properties?.when && { when: rel.properties.when }),
          ...(rel.properties?.method && { method: rel.properties.method }),
          ...(rel.properties?.frequency && { frequency: rel.properties.frequency }),
          ...(rel.properties?.notes && { notes: rel.properties.notes }),
          extractedAt: now,
        },
        ctx
      )
      if (!relResult.ok) {
        logger.warn({ error: relResult.error, relationship: rel }, 'Failed to store relationship')
      }
    }
  }

  /**
   * L3 Memory persistence - uses L3 store methods for richer entity storage
   */
  private async persistL3(
    result: ExtractionResult,
    userMessage: Message,
    nameResolutionMap: Map<string, string>,
    ctx: TraceContext
  ): Promise<void> {
    const startTime = Date.now()
    const logger = getLogger().child({ requestId: ctx.requestId })
    const now = Date.now()
    const conversationId = userMessage.conversationId
    const messageId = userMessage.id

    logger.debug(
      {
        entityCount: result.entities.length,
        relationshipCount: result.relationships.length,
        observationCount: result.observations?.length ?? 0,
        conversationId,
      },
      'Starting L3 persistence'
    )

    let entitiesCreated = 0
    let entitiesUpdated = 0
    let observationsCreated = 0
    let relationshipsCreated = 0

    // Store entities using L3 methods
    for (const entity of result.entities) {
      // Check if entity exists to determine action type
      const existingResult = await this.l3Store!.getL3Entity(entity.name.toLowerCase(), ctx)
      const action: SourceEntry['action'] = existingResult.ok && existingResult.value
        ? 'updated'
        : 'created'

      // Upsert L3 entity
      const l3Result = await this.l3Store!.upsertL3Entity(
        {
          name: entity.name.toLowerCase(),
          displayName: entity.displayName ?? entity.name,
          aliases: entity.aliases ?? [],
          canonicalType: toCanonicalType(entity.type),
          labels: entity.labels ?? [],
          importance: entity.importance,
          metadata: {
            context: entity.context,
          },
        },
        ctx
      )

      if (!l3Result.ok) {
        logger.debug(
          { error: l3Result.error, entity: entity.name, canonicalType: toCanonicalType(entity.type) },
          'L3 entity upsert failed - full error'
        )
        logger.warn({ errorKind: l3Result.error.kind, entity: entity.name }, 'Failed to store L3 entity')
        continue
      }

      if (action === 'created') {
        entitiesCreated++
      } else {
        entitiesUpdated++
      }

      // Track source history for Deep Memory
      const sourceEntry: SourceEntry = {
        messageId,
        conversationId,
        action,
        timestamp: now,
      }

      const historyResult = await this.l3Store!.appendSourceHistory(
        entity.name.toLowerCase(),
        sourceEntry,
        ctx
      )
      if (!historyResult.ok) {
        logger.debug(
          { error: historyResult.error, entity: entity.name, sourceEntry },
          'Source history append failed - full error'
        )
        logger.warn({ errorKind: historyResult.error.kind, entity: entity.name }, 'Failed to append source history')
      }
    }

    // Store observations as separate nodes
    if (result.observations && result.observations.length > 0) {
      for (const obs of result.observations) {
        const obsResult = await this.l3Store!.createObservation(
          obs.entityName.toLowerCase(),
          {
            content: obs.content,
            conversationId,
            messageId,
            confidence: obs.confidence,
          },
          ctx
        )
        if (!obsResult.ok) {
          logger.debug(
            { error: obsResult.error, entityName: obs.entityName, content: obs.content.slice(0, 100) },
            'Observation creation failed - full error'
          )
          logger.warn({ errorKind: obsResult.error.kind, entityName: obs.entityName }, 'Failed to create observation')
        } else {
          observationsCreated++
        }
      }
    }

    // Store relationships using L3 method
    for (const rel of result.relationships) {
      const resolvedFrom = this.resolveEntityName(rel.from, nameResolutionMap, logger)
      const resolvedTo = this.resolveEntityName(rel.to, nameResolutionMap, logger)

      if (!resolvedFrom || !resolvedTo) {
        logger.warn(
          {
            from: rel.from,
            to: rel.to,
            resolvedFrom,
            resolvedTo,
            availableEntities: Array.from(nameResolutionMap.values()),
          },
          'Skipping L3 relationship: could not resolve entity names'
        )
        continue
      }

      const relResult = await this.l3Store!.createL3Relationship(
        resolvedFrom,
        resolvedTo,
        rel.type,
        {
          strength: rel.strength,
          context: rel.properties?.context,
          when: rel.properties?.when,
          method: rel.properties?.method,
          frequency: rel.properties?.frequency,
          notes: rel.properties?.notes,
          conversationId,
          messageId,
        },
        ctx
      )
      if (!relResult.ok) {
        logger.debug(
          { error: relResult.error, from: resolvedFrom, to: resolvedTo, type: rel.type },
          'L3 relationship creation failed - full error'
        )
        logger.warn({ errorKind: relResult.error.kind, from: resolvedFrom, to: resolvedTo }, 'Failed to store L3 relationship')
      } else {
        relationshipsCreated++
      }
    }

    const durationMs = Date.now() - startTime
    logger.info(
      {
        entitiesCreated,
        entitiesUpdated,
        observationsCreated,
        relationshipsCreated,
        durationMs,
      },
      'L3 persistence complete'
    )

    // Record metrics
    pipelineMetrics.stageDuration.record(durationMs, { stage: 'l3_entity_persist' })
  }

  /**
   * Build a map for resolving entity name variations to stored names.
   * Maps both the full name and individual words to the stored (lowercase) name.
   *
   * Example: Entity "John Smith" creates mappings:
   * - "john smith" → "john smith"
   * - "john" → "john smith"
   * - "smith" → "john smith"
   */
  private buildNameResolutionMap(entities: ExtractedEntity[]): Map<string, string> {
    const map = new Map<string, string>()

    for (const entity of entities) {
      const storedName = entity.name.toLowerCase()

      // Map full name
      map.set(storedName, storedName)

      // Map individual words (for partial matches like "John" → "john smith")
      const words = storedName.split(/\s+/)
      if (words.length > 1) {
        for (const word of words) {
          // Only add word mapping if not already taken by a more specific entity
          if (!map.has(word)) {
            map.set(word, storedName)
          }
        }
      }
    }

    return map
  }

  /**
   * Resolve a relationship entity reference to an actual stored entity name.
   * Tries exact match first, then word-based matching.
   */
  private resolveEntityName(
    name: string,
    resolutionMap: Map<string, string>,
    logger: ReturnType<typeof getLogger>
  ): string | null {
    const normalized = name.toLowerCase().trim()

    // Try exact match first
    if (resolutionMap.has(normalized)) {
      return resolutionMap.get(normalized)!
    }

    // Try matching individual words from the input
    const words = normalized.split(/\s+/)
    for (const word of words) {
      if (resolutionMap.has(word)) {
        const resolved = resolutionMap.get(word)!
        logger.debug(
          { original: name, resolved, matchedWord: word },
          'Resolved entity name via word match'
        )
        return resolved
      }
    }

    // No match found
    return null
  }

  /**
   * Get current configuration
   */
  getConfig(): EntityExtractorConfig {
    return { ...this.config }
  }
}
