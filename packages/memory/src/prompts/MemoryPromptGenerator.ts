/**
 * Memory Prompt Generator
 *
 * Generates memory prompts by:
 * 1. Using Haiku to analyze recent messages and generate L4 search queries
 * 2. Searching L4 (Qdrant) for semantic matches
 * 3. Searching L3 (Neo4j) for related entities
 * 4. Using Haiku to narrativize results and score TTL
 */

import type Anthropic from "@anthropic-ai/sdk";
import type {
  IVectorStore,
  IKnowledgeStore,
  IEmbeddingProvider,
  Message,
  TraceContext,
  SemanticMatch,
  Entity,
  UserProfile,
} from "@pippa/types";
import { getLogger, withSpan } from "@pippa/observability";

export interface MemoryPromptConfig {
  /** Number of recent messages to analyze (default: 1 = current exchange only) */
  recentMessages: number;
  /** Maximum TTL in minutes (default: 60) */
  maxTtlMinutes: number;
  /** L4 search limit per query (default: 5) */
  l4SearchLimit: number;
  /** L3 entity search hops (default: 1) */
  l3SearchHops: number;
  /** Haiku model to use */
  model: string;
}

export interface MemoryPromptResult {
  /** Narrativized memory content */
  content: string;
  /** TTL in minutes (0-60), scored by Haiku */
  ttlMinutes: number;
  /** Debug: reasoning for TTL score */
  reasoning?: string;
  /** Debug: queries generated */
  queries?: string[];
  /** Debug: L4 matches found */
  l4Matches?: number;
  /** Debug: L3 entities found */
  l3Entities?: number;
}

export interface GenerateOptions {
  /** User profile for context injection */
  userProfile?: UserProfile | null;
  /** User's display name (from JWT) */
  displayName?: string;
}

const DEFAULT_CONFIG: MemoryPromptConfig = {
  recentMessages: 1,
  maxTtlMinutes: 60,
  l4SearchLimit: 5,
  l3SearchHops: 1,
  model: "claude-3-haiku-20240307",
};

const QUERY_GENERATION_PROMPT = `Analyze this conversation exchange and generate 1-3 semantic search queries to find relevant memories from past conversations.

Focus on: names, places, emotions, events, topics, coping strategies, recovery-related content.
Return ONLY valid JSON, no explanation.

Exchange:
{messages}

Return JSON:
{"queries": ["query1", "query2"]}`;

const NARRATIVIZATION_PROMPT = `

** User Context **
{userContext}

** Agent Context **
- **Name**: Pippa
- **Pronouns**: you/yours
- **Locale**: US

You are helping an AI companion remember relevant context from past conversations.  You are writing to the Agent about the User.

**It is critical to correctly align the context of the response such that you are writing TO an aganet (you/yours) regarding a user.  Never use 'I' statements.**

Create a brief, useful memory context from these search results. Focus on information that would help the AI respond more personally and contextually.

Rate how long this memory should stay active (0-{maxTtl} minutes).
Scoring guide:
- 0: Don't store (nothing relevant found, or ephemeral greetings)
- 5-15: Quick topics (simple questions, brief updates)
- 20-40: Substantive discussions (plans, feelings, meaningful updates)
- 45-{maxTtl}: Deep emotional/recovery topics (crisis moments, breakthroughs, important personal info)

L4 Semantic Matches (past messages):
{l4Results}

L3 Entities (known people/places/concepts):
{l3Entities}

Return ONLY valid JSON:
{
  "memory": "Brief narrativized context for the AI...",
  "ttlMinutes": 30,
  "reasoning": "Why this score"
}

If nothing relevant was found, return:
{"memory": "", "ttlMinutes": 0, "reasoning": "No relevant memories found"}`;

/**
 * Generates memory prompts from recent conversation exchange
 */
export class MemoryPromptGenerator {
  private readonly config: MemoryPromptConfig;
  private readonly logger = getLogger().child({
    component: "MemoryPromptGenerator",
  });

  constructor(
    private readonly anthropic: Anthropic,
    private readonly vectorStore: IVectorStore | null,
    private readonly knowledgeStore: IKnowledgeStore | null,
    private readonly embeddingProvider: IEmbeddingProvider | null,
    config: Partial<MemoryPromptConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate a memory prompt from recent messages
   *
   * @param messages - Recent N messages (user + assistant pairs)
   * @param userId - User ID for scoped search
   * @param ctx - Trace context
   * @param options - Optional user context for prompt injection
   */
  async generate(
    messages: Message[],
    userId: string,
    ctx: TraceContext,
    options?: GenerateOptions,
  ): Promise<MemoryPromptResult | null> {
    return withSpan("MemoryPromptGenerator.generate", async () => {
      if (messages.length === 0) {
        this.logger.debug("No messages to analyze");
        return null;
      }

      const startTime = Date.now();

      // Step 1: Generate search queries from messages
      const queries = await this.generateQueries(messages, ctx);
      if (queries.length === 0) {
        this.logger.debug("No queries generated");
        return null;
      }

      // Step 2: Search L4 for semantic matches
      const l4Results = await this.searchL4(queries, userId, ctx);

      // Step 3: Search L3 for related entities
      const l3Entities = await this.searchL3(messages, userId, ctx);

      // Step 4: Check if we have anything to narrativize
      if (l4Results.length === 0 && l3Entities.length === 0) {
        this.logger.debug("No L4 or L3 results found");
        return {
          content: "",
          ttlMinutes: 0,
          reasoning: "No relevant memories found",
          queries,
          l4Matches: 0,
          l3Entities: 0,
        };
      }

      // Step 5: Narrativize results and score TTL
      const result = await this.narrativize(
        l4Results,
        l3Entities,
        options,
        ctx,
      );

      const duration = Date.now() - startTime;
      this.logger.info(
        {
          queries: queries.length,
          l4Matches: l4Results.length,
          l3Entities: l3Entities.length,
          ttlMinutes: result.ttlMinutes,
          durationMs: duration,
        },
        "Memory prompt generated",
      );

      return {
        ...result,
        queries,
        l4Matches: l4Results.length,
        l3Entities: l3Entities.length,
      };
    });
  }

  /**
   * Generate L4 search queries from messages using Haiku
   */
  private async generateQueries(
    messages: Message[],
    _ctx: TraceContext,
  ): Promise<string[]> {
    return withSpan("MemoryPromptGenerator.generateQueries", async () => {
      const messagesText = messages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n");

      const prompt = QUERY_GENERATION_PROMPT.replace(
        "{messages}",
        messagesText,
      );

      try {
        const response = await this.anthropic.messages.create({
          model: this.config.model,
          max_tokens: 256,
          messages: [{ role: "user", content: prompt }],
        });

        const text =
          response.content[0].type === "text" ? response.content[0].text : "";

        // Parse JSON response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          this.logger.warn("Failed to parse query generation response");
          return [];
        }

        const parsed = JSON.parse(jsonMatch[0]) as { queries: string[] };
        const queries =
          parsed.queries?.filter((q) => q && q.trim().length > 0) ?? [];

        this.logger.debug({ queries }, "Generated search queries");
        return queries;
      } catch (error) {
        this.logger.error({ error }, "Query generation failed");
        return [];
      }
    });
  }

  /**
   * Search L4 (Qdrant) for semantic matches
   */
  private async searchL4(
    queries: string[],
    userId: string,
    ctx: TraceContext,
  ): Promise<SemanticMatch[]> {
    if (!this.vectorStore || !this.embeddingProvider) {
      this.logger.debug(
        "L4 search skipped - no vector store or embedding provider",
      );
      return [];
    }

    return withSpan("MemoryPromptGenerator.searchL4", async () => {
      const allMatches: SemanticMatch[] = [];
      const seenIds = new Set<string>();

      for (const query of queries) {
        try {
          // Embed the query
          const embedResult = await this.embeddingProvider!.embed(query, ctx, {
            label: "memory_prompt_query",
          });
          if (!embedResult.ok) {
            this.logger.warn(
              { error: embedResult.error },
              "Failed to embed query",
            );
            continue;
          }

          // Search L4
          const searchResult = await this.vectorStore!.search(
            embedResult.value,
            {
              userId,
              limit: this.config.l4SearchLimit,
              daysBack: 30, // Search last 30 days
            },
            ctx,
          );

          if (!searchResult.ok) {
            this.logger.warn({ error: searchResult.error }, "L4 search failed");
            continue;
          }

          // Deduplicate matches
          for (const match of searchResult.value) {
            if (!seenIds.has(match.id)) {
              seenIds.add(match.id);
              allMatches.push(match);
            }
          }
        } catch (error) {
          this.logger.error({ error, query }, "L4 search error");
        }
      }

      this.logger.debug(
        { matchCount: allMatches.length },
        "L4 search complete",
      );
      return allMatches;
    });
  }

  /**
   * Search L3 (Neo4j) for related entities
   */
  private async searchL3(
    messages: Message[],
    _userId: string,
    ctx: TraceContext,
  ): Promise<Entity[]> {
    if (!this.knowledgeStore) {
      this.logger.debug("L3 search skipped - no knowledge store");
      return [];
    }

    return withSpan("MemoryPromptGenerator.searchL3", async () => {
      const allEntities: Entity[] = [];
      const seenNames = new Set<string>();

      // Extract potential entity names from messages
      const combinedText = messages.map((m) => m.content).join(" ");
      // Simple extraction: words that start with capital letters (potential names)
      const potentialNames = combinedText.match(/\b[A-Z][a-z]+\b/g) ?? [];
      const uniqueNames = [...new Set(potentialNames)];

      for (const name of uniqueNames.slice(0, 5)) {
        try {
          const result = await this.knowledgeStore!.searchEntities(name, ctx);
          if (result.ok) {
            for (const entity of result.value) {
              if (!seenNames.has(entity.name)) {
                seenNames.add(entity.name);
                allEntities.push(entity);
              }
            }
          }
        } catch (error) {
          this.logger.error({ error, name }, "L3 search error");
        }
      }

      this.logger.debug(
        { entityCount: allEntities.length },
        "L3 search complete",
      );
      return allEntities;
    });
  }

  /**
   * Format user context for prompt injection
   */
  private formatUserContext(options?: GenerateOptions): string {
    const lines: string[] = [];

    if (options?.displayName) {
      lines.push(`- **Name**: ${options.displayName}`);
    }

    const profile = options?.userProfile;
    if (profile?.pronouns) {
      lines.push(`- **Pronouns**: ${profile.pronouns}`);
    }
    if (profile?.localeCode) {
      lines.push(`- **Locale**: ${profile.localeCode}`);
    }
    if (profile?.recoveryDate) {
      const days = Math.floor(
        (Date.now() - new Date(profile.recoveryDate).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      lines.push(
        `- **Recovery**: ${days} days (since ${profile.recoveryDate})`,
      );
    }

    return lines.length > 0 ? lines.join("\n") : "(no user context available)";
  }

  /**
   * Narrativize L4 and L3 results using Haiku
   */
  private async narrativize(
    l4Results: SemanticMatch[],
    l3Entities: Entity[],
    options: GenerateOptions | undefined,
    _ctx: TraceContext,
  ): Promise<{ content: string; ttlMinutes: number; reasoning: string }> {
    return withSpan("MemoryPromptGenerator.narrativize", async () => {
      // Format user context
      const userContext = this.formatUserContext(options);

      // Format L4 results
      const l4Text =
        l4Results.length > 0
          ? l4Results
              .map(
                (m, i) =>
                  `${i + 1}. [${m.metadata.role || "unknown"}] ${m.content.slice(0, 200)}...`,
              )
              .join("\n")
          : "(no semantic matches found)";

      // Format L3 entities
      const l3Text =
        l3Entities.length > 0
          ? l3Entities
              .map(
                (e) =>
                  `- ${e.name} (${e.type}): ${JSON.stringify(e.properties || {}).slice(0, 100)}`,
              )
              .join("\n")
          : "(no entities found)";

      const prompt = NARRATIVIZATION_PROMPT.replace(
        "{maxTtl}",
        String(this.config.maxTtlMinutes),
      )
        .replace("{userContext}", userContext)
        .replace("{l4Results}", l4Text)
        .replace("{l3Entities}", l3Text);

      try {
        const response = await this.anthropic.messages.create({
          model: this.config.model,
          max_tokens: 512,
          messages: [{ role: "user", content: prompt }],
        });

        const text =
          response.content[0].type === "text" ? response.content[0].text : "";

        // Parse JSON response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          this.logger.warn("Failed to parse narrativization response");
          return { content: "", ttlMinutes: 0, reasoning: "Parse error" };
        }

        const parsed = JSON.parse(jsonMatch[0]) as {
          memory: string;
          ttlMinutes: number;
          reasoning: string;
        };

        // Clamp TTL to valid range
        const ttlMinutes = Math.max(
          0,
          Math.min(this.config.maxTtlMinutes, parsed.ttlMinutes || 0),
        );

        return {
          content: parsed.memory || "",
          ttlMinutes,
          reasoning: parsed.reasoning || "",
        };
      } catch (error) {
        this.logger.error({ error }, "Narrativization failed");
        return { content: "", ttlMinutes: 0, reasoning: "Error" };
      }
    });
  }
}

/**
 * Load memory prompt config from environment
 */
export function loadMemoryPromptConfig(): Partial<MemoryPromptConfig> {
  return {
    recentMessages: parseInt(
      process.env.MEMORY_PROMPT_RECENT_MESSAGES || "1",
      10,
    ),
    maxTtlMinutes: parseInt(
      process.env.MEMORY_PROMPT_MAX_TTL_MINUTES || "60",
      10,
    ),
  };
}
