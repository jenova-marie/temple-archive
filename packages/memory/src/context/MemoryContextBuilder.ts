/**
 * Memory Context Builder
 *
 * Builds contextual memory information for injection into agent prompts.
 * Retrieves relevant entities and relationships from Neo4j based on
 * what the user mentions in their message.
 *
 * Modes:
 * - 0: Off - No memory context
 * - 1: Template - Format with templates (free)
 * - 2: Haiku - Use Claude Haiku to narrativize (cost: ~$0.0003/msg)
 * - 3: Hybrid - Templates for simple, Haiku for complex subgraphs
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { IKnowledgeStore, Entity, TraceContext } from '@pippa/types'
import { getLogger, withSpan } from '@pippa/observability'
import type { IMemoryContextProvider } from '../retrieval/MemoryContextProvider.js'

/**
 * Memory context mode
 */
export type MemoryContextMode = 0 | 1 | 2 | 3

/**
 * Configuration for memory context builder
 */
export interface MemoryContextBuilderConfig {
  /** Context mode: 0=off, 1=template, 2=haiku, 3=hybrid */
  mode: MemoryContextMode
  /** Maximum entities to include in context */
  maxEntities: number
  /** Maximum relationships to include */
  maxRelationships: number
  /** How many hops to traverse in graph */
  traversalDepth: number
  /** Minimum complexity (entities + relationships) to trigger Haiku in hybrid mode */
  hybridThreshold: number
}

/**
 * A relationship with its properties
 */
export interface RetrievedRelationship {
  from: string
  to: string
  type: string
  properties?: Record<string, unknown>
}

/**
 * A subgraph of entities and relationships
 */
export interface Subgraph {
  entities: Entity[]
  relationships: RetrievedRelationship[]
}

/**
 * Default configuration
 */
export const DEFAULT_CONTEXT_CONFIG: MemoryContextBuilderConfig = {
  mode: 1,
  maxEntities: 10,
  maxRelationships: 15,
  traversalDepth: 2,
  hybridThreshold: 5,
}

/**
 * Common words to exclude from entity matching
 */
const STOP_WORDS = new Set([
  'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your',
  'yours', 'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she',
  'her', 'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
  'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing', 'a', 'an',
  'the', 'and', 'but', 'if', 'or', 'because', 'as', 'until', 'while', 'of',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down',
  'in', 'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just',
  'don', 'should', 'now', 'today', 'yesterday', 'tomorrow', 'really', 'think',
  'feel', 'feeling', 'want', 'need', 'going', 'know', 'like', 'get', 'got',
])

export class MemoryContextBuilder implements IMemoryContextProvider {
  private readonly config: MemoryContextBuilderConfig

  constructor(
    private readonly knowledgeStore: IKnowledgeStore,
    private readonly anthropic: Anthropic | null,
    config?: Partial<MemoryContextBuilderConfig>
  ) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config }
  }

  /**
   * Build memory context for injection into agent prompt
   */
  async buildContext(
    userMessage: string,
    userId: string,
    ctx: TraceContext
  ): Promise<string | null> {
    return withSpan('MemoryContextBuilder.buildContext', async () => {
      const logger = getLogger().child({
        userId,
        mode: this.config.mode,
        requestId: ctx.requestId,
      })

      // Mode 0: Off
      if (this.config.mode === 0) {
        logger.debug('Memory context disabled (mode 0)')
        return null
      }

      // Extract potential entity mentions from user message
      const mentionedNames = this.extractMentions(userMessage)
      logger.debug({ mentions: mentionedNames }, 'Extracted mentions from message')

      if (mentionedNames.length === 0) {
        // No specific mentions, try to get recent entities for this user
        const recentResult = await this.knowledgeStore.searchEntities(userId, ctx)
        if (!recentResult.ok || recentResult.value.length === 0) {
          logger.debug('No entities found for user')
          return null
        }

        // Use recent entities
        const subgraph: Subgraph = {
          entities: recentResult.value.slice(0, this.config.maxEntities),
          relationships: [],
        }

        return this.formatSubgraph(subgraph, userMessage, ctx)
      }

      // Find matching entities
      const entities = await this.findEntities(mentionedNames, ctx)
      if (entities.length === 0) {
        logger.debug('No matching entities found')
        return null
      }

      // Traverse relationships
      const subgraph = await this.traverseRelationships(entities, ctx)

      logger.info(
        {
          entities: subgraph.entities.length,
          relationships: subgraph.relationships.length,
        },
        'Built memory subgraph'
      )

      return this.formatSubgraph(subgraph, userMessage, ctx)
    })
  }

  /**
   * Extract potential entity names from user message
   * Uses simple word extraction - no NLP library needed
   */
  private extractMentions(message: string): string[] {
    // Extract words, keeping potential names (capitalized words) and meaningful terms
    const words = message
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !STOP_WORDS.has(word))

    // Also look for capitalized words (potential names) in original message
    const capitalizedPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g
    const names = message.match(capitalizedPattern) || []

    // Combine and dedupe
    const allMentions = [
      ...words,
      ...names.map(n => n.toLowerCase()),
    ]

    return [...new Set(allMentions)].slice(0, 10) // Limit to 10 search terms
  }

  /**
   * Find entities matching the mentioned names
   */
  private async findEntities(
    mentions: string[],
    ctx: TraceContext
  ): Promise<Entity[]> {
    const logger = getLogger().child({ requestId: ctx.requestId })
    const entities: Entity[] = []
    const seen = new Set<string>()

    for (const mention of mentions) {
      const result = await this.knowledgeStore.searchEntities(mention, ctx)
      if (result.ok) {
        for (const entity of result.value) {
          if (!seen.has(entity.entityId)) {
            seen.add(entity.entityId)
            entities.push(entity)
          }
        }
      }
    }

    // Limit to maxEntities
    const limited = entities.slice(0, this.config.maxEntities)
    logger.debug({ found: limited.length }, 'Found matching entities')
    return limited
  }

  /**
   * Traverse relationships from found entities
   */
  private async traverseRelationships(
    entities: Entity[],
    ctx: TraceContext
  ): Promise<Subgraph> {
    const logger = getLogger().child({ requestId: ctx.requestId })
    const allEntities = new Map<string, Entity>()
    const relationships: RetrievedRelationship[] = []

    // Add initial entities
    for (const entity of entities) {
      allEntities.set(entity.entityId, entity)
    }

    // Traverse from each entity
    for (const entity of entities) {
      const relatedResult = await this.knowledgeStore.getRelatedEntities(
        entity.name,
        this.config.traversalDepth,
        ctx
      )

      if (relatedResult.ok) {
        for (const related of relatedResult.value) {
          if (!allEntities.has(related.entityId)) {
            allEntities.set(related.entityId, related)
          }

          // Note: We can't get relationship properties from getRelatedEntities
          // This is a limitation - in production we'd need a different query
          relationships.push({
            from: entity.name,
            to: related.name,
            type: 'RELATED_TO', // Generic - actual type requires different query
          })
        }
      }
    }

    // Limit relationships
    const limitedRelationships = relationships.slice(0, this.config.maxRelationships)

    logger.debug(
      {
        entities: allEntities.size,
        relationships: limitedRelationships.length,
      },
      'Traversed relationships'
    )

    return {
      entities: Array.from(allEntities.values()),
      relationships: limitedRelationships,
    }
  }

  /**
   * Format subgraph based on mode
   */
  private async formatSubgraph(
    subgraph: Subgraph,
    userMessage: string,
    ctx: TraceContext
  ): Promise<string | null> {
    if (subgraph.entities.length === 0) {
      return null
    }

    const complexity = subgraph.entities.length + subgraph.relationships.length

    switch (this.config.mode) {
      case 1: // Template
        return this.formatWithTemplates(subgraph)

      case 2: // Haiku
        if (!this.anthropic) {
          return this.formatWithTemplates(subgraph)
        }
        return this.formatWithHaiku(subgraph, userMessage, ctx)

      case 3: // Hybrid
        if (complexity >= this.config.hybridThreshold && this.anthropic) {
          return this.formatWithHaiku(subgraph, userMessage, ctx)
        }
        return this.formatWithTemplates(subgraph)

      default:
        return null
    }
  }

  /**
   * Format subgraph with templates (free)
   */
  private formatWithTemplates(subgraph: Subgraph): string {
    const lines: string[] = ['## What you remember about this user:\n']

    // Group entities by type
    const byType = new Map<string, Entity[]>()
    for (const entity of subgraph.entities) {
      const existing = byType.get(entity.type) || []
      existing.push(entity)
      byType.set(entity.type, existing)
    }

    // Format entities by type
    for (const [type, entities] of byType) {
      const typeLabel = type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ')
      lines.push(`\n**${typeLabel}s:**`)

      for (const entity of entities) {
        const context = entity.properties?.context as string | undefined
        const importance = entity.properties?.importance as number | undefined

        let line = `- **${entity.name}**`
        if (context) {
          line += `: ${context}`
        }
        if (importance && importance >= 0.8) {
          line += ' (important)'
        }
        lines.push(line)
      }
    }

    // Format relationships
    if (subgraph.relationships.length > 0) {
      lines.push('\n**Connections:**')
      for (const rel of subgraph.relationships) {
        const type = rel.type.toLowerCase().replace(/_/g, ' ')
        let line = `- ${rel.from} ${type} ${rel.to}`
        if (rel.properties?.context) {
          line += ` (${rel.properties.context})`
        }
        lines.push(line)
      }
    }

    return lines.join('\n')
  }

  /**
   * Format subgraph with Haiku narrativization (cost: ~$0.0003/msg)
   */
  private async formatWithHaiku(
    subgraph: Subgraph,
    userMessage: string,
    ctx: TraceContext
  ): Promise<string> {
    const logger = getLogger().child({ requestId: ctx.requestId })

    try {
      const prompt = `You have the following knowledge about a user in addiction recovery:

ENTITIES:
${subgraph.entities.map(e => `- ${e.name} (${e.type}): ${e.properties?.context || 'mentioned previously'}`).join('\n')}

RELATIONSHIPS:
${subgraph.relationships.map(r => `- ${r.from} ${r.type.toLowerCase().replace(/_/g, ' ')} ${r.to}${r.properties?.context ? ` (${r.properties.context})` : ''}`).join('\n') || 'None identified'}

The user just said: "${userMessage}"

Write 2-3 concise sentences summarizing what you know that's RELEVANT to their current message.
Focus on relationships and context that might help the conversation.
Be warm but brief. Start with "You remember that..." or similar.`

      const response = await this.anthropic!.messages.create(
        {
          model: 'claude-3-haiku-20240307',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          signal: AbortSignal.timeout(5000), // 5 second timeout
        }
      )

      const content = response.content[0]
      if (content.type === 'text') {
        logger.debug('Haiku narrativization complete')
        return `## What you remember:\n${content.text}`
      }

      // Fallback to templates
      return this.formatWithTemplates(subgraph)
    } catch (error) {
      logger.warn({ error }, 'Haiku narrativization failed, falling back to templates')
      return this.formatWithTemplates(subgraph)
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): MemoryContextBuilderConfig {
    return { ...this.config }
  }
}
