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
} from '@recoverysky/types'
import { ok, err } from '@recoverysky/types'
import { getLogger, withSpan } from '@recoverysky/observability'

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

export class EntityExtractor {
  private readonly config: EntityExtractorConfig

  constructor(
    private readonly client: Anthropic | null,
    private readonly knowledgeStore: IKnowledgeStore,
    config?: Partial<EntityExtractorConfig>
  ) {
    this.config = { ...DEFAULT_EXTRACTOR_CONFIG, ...config }
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
      await this.persist(filtered, userMessage.userId, ctx)

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
      const logger = getLogger().child({ requestId: ctx.requestId })

      try {
        // Build prompt
        const enabledTypesText = this.config.enabledTypes
          .map((t) => `- ${TYPE_DESCRIPTIONS[t]}`)
          .join('\n')

        const relationshipInstructions = this.config.inferRelationships
          ? RELATIONSHIP_INSTRUCTIONS_ENABLED
          : 'Do not extract relationships, return an empty relationships array.'

        const prompt = EXTRACTION_PROMPT
          .replace('{userMessage}', userContent)
          .replace('{assistantResponse}', assistantContent)
          .replace('{enabledTypes}', enabledTypesText)
          .replace('{relationshipInstructions}', relationshipInstructions)

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
            type: string
            importance: number
            context: string
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

        const entities: ExtractedEntity[] = rawEntities
          .filter((e) =>
            e.name != null &&
            typeof e.name === 'string' &&
            e.name.trim().length > 0 &&
            this.config.enabledTypes.includes(e.type as EntityType)
          )
          .map((e) => ({
            name: e.name.trim(),
            type: e.type as EntityType,
            importance: Math.max(0, Math.min(1, e.importance ?? 0.5)),
            context: e.context ?? '',
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
                type: r.type.toUpperCase().replace(/[^A-Z0-9_]/g, '_'), // Sanitize for Neo4j
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

        return ok({ entities, relationships })
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

    return {
      entities: filteredEntities,
      relationships: filteredRelationships,
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
    userId: string,
    ctx: TraceContext
  ): Promise<void> {
    const logger = getLogger().child({ requestId: ctx.requestId })
    const now = Date.now()

    // Build name resolution map: LLM name variations → stored name
    // This handles cases where LLM uses "John" in relationships but "John Smith" in entities
    const nameResolutionMap = this.buildNameResolutionMap(result.entities)

    // Store entities
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
