/**
 * Chat API Routes - Vercel AI SDK UI Message Stream Format
 *
 * Uses pipeUIMessageStreamToResponse() for assistant-ui compatibility
 */

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  streamText,
  convertToModelMessages,
  pipeUIMessageStreamToResponse,
  stepCountIs,
  type UIMessage,
} from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { PipelineInput, TraceContext } from "@siri/types";
import type { Pipeline } from "@siri/pipeline";
import { getLogger } from "@siri/observability";
import {
  agentTools,
  getMemoryTools,
  getMem0Tools,
  getRagTools,
  setRagToolTraceContext,
  clearRagToolTraceContext,
  setMemoryToolTraceContext,
  clearMemoryToolTraceContext,
  setMem0ToolTraceContext,
  clearMem0ToolTraceContext,
  getMcpTools,
} from "@siri/tools";

/** Default model for agent processing - can be overridden via AGENT_MODEL env var */
const DEFAULT_AGENT_MODEL = "claude-sonnet-4-20250514";

/** Get the configured agent model (hot-reloadable via HOT_CONFIG) */
function getAgentModel(): string {
  return process.env.AGENT_MODEL || DEFAULT_AGENT_MODEL;
}

/**
 * Chat request body schema - matches existing recoverysky-api format
 * Note: 'id' is optional (unlike our previous implementation)
 */
const chatBodySchema = z
  .object({
    /** Conversation ID - required for message continuity across requests (must be valid UUID) */
    conversation_id: z
      .string()
      .uuid("conversation_id must be a valid UUID")
      .optional(),
    messages: z
      .array(
        z
          .object({
            id: z.string().optional(),
            role: z.enum(["user", "assistant", "system"]),
            parts: z
              .array(
                z
                  .object({
                    type: z.string(),
                    text: z.string().optional(),
                  })
                  .passthrough(),
              )
              .optional(),
            content: z.string().optional(),
          })
          .passthrough(),
      )
      .min(1),
    /** Optional agent/persona (system prompt) to use instead of default siri */
    agent: z.string().optional(),
    /** User's locale code (ISO 3166-1 alpha-2, e.g., 'US', 'DE'). Defaults to 'US'. */
    locale: z.string().length(2).optional(),
    /** User's timezone (IANA format, e.g., 'America/New_York'). Defaults to server timezone. */
    timezone: z.string().optional(),
  })
  .passthrough();

/**
 * Validate that all messages have non-empty content.
 * Throws an error with detailed context if any message is empty.
 * This is fail-fast behavior to surface data issues rather than masking them.
 */
function validateMessagesNotEmpty(
  messages: UIMessage[],
  source: "L2" | "incoming" | "client",
  conversationId: string,
): void {
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const content = extractMessageContent(msg);

    if (!content || content.trim() === "") {
      const error = new Error(
        `Empty message detected at index ${i} (source: ${source}). ` +
          `Message ID: ${msg.id}, Role: ${msg.role}, Conversation: ${conversationId}. ` +
          `This indicates a data integrity issue - messages should never have empty content. ` +
          `Check the database for this message or investigate how it was stored.`,
      );
      error.name = "EmptyMessageError";
      throw error;
    }
  }
}

/**
 * Extract text content from a single message (handles both parts and content formats)
 */
function extractMessageContent(msg: UIMessage): string | null {
  // Check parts array first (UIMessage format)
  if (msg.parts && Array.isArray(msg.parts)) {
    const textParts = msg.parts
      .filter(
        (part): part is { type: "text"; text: string } =>
          part.type === "text" && typeof part.text === "string",
      )
      .map((part) => part.text);
    if (textParts.length > 0) {
      return textParts.join("\n");
    }
  }
  // Fallback to content field if present
  if ("content" in msg && typeof msg.content === "string") {
    return msg.content;
  }
  return null;
}

/**
 * Extract text content from the last user message
 */
function extractLastUserMessage(
  messages: Array<{
    role: string;
    parts?: Array<{ type: string; text?: string }>;
    content?: string;
  }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user") {
      // Extract text from parts array (v5 format)
      if (msg.parts && Array.isArray(msg.parts)) {
        const textParts = msg.parts
          .filter(
            (part): part is { type: "text"; text: string } =>
              part.type === "text" && typeof part.text === "string",
          )
          .map((part) => part.text);
        if (textParts.length > 0) {
          return textParts.join("\n");
        }
      }
      // Fallback to content if parts not available
      if (typeof msg.content === "string") {
        return msg.content;
      }
    }
  }
  return null;
}

import type { UserProfile } from "@siri/types";

interface RequestUserData {
  userId: string;
  email?: string;
  displayName?: string;
  profile: UserProfile | null;
}

interface ChatRouterDeps {
  pipeline: Pipeline;
  loadUserData: (
    userId: string,
    email?: string,
    displayName?: string,
  ) => Promise<RequestUserData>;
}

export function createChatRouter({
  pipeline,
  loadUserData,
}: ChatRouterDeps): Router {
  const router = Router();

  /**
   * POST /api/v1/chat
   *
   * Streaming chat endpoint compatible with assistant-ui.
   * Uses Vercel AI SDK's pipeUIMessageStreamToResponse() for native streaming.
   *
   * Request Body:
   *   - messages: Array of { role, parts/content }
   *
   * Response:
   *   - UI Message Stream (native assistant-ui format)
   */
  router.post("/", async (req: Request, res: Response) => {
    const logger = getLogger().child({ route: "POST /api/v1/chat" });
    const startTime = Date.now();

    try {
      // Auth middleware ensures req.user is present
      if (!req.user) {
        res.status(401).json({
          error: "Unauthorized",
          message: "Authentication required - user not found in request",
        });
        return;
      }

      const userId = req.user.id;

      // Load user and profile data once for the entire request lifecycle
      const userData = await loadUserData(
        userId,
        req.user?.email,
        req.user?.name,
      );
      const requestId = (req.headers["x-request-id"] as string) || generateId();

      // Validate request body
      const parseResult = chatBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        logger.debug(
          { validationErrors: parseResult.error.issues },
          "Request validation failed",
        );
        res.status(400).json({
          error: "Bad Request",
          message: "Invalid request body",
          details: parseResult.error.issues,
        });
        return;
      }

      const {
        messages: rawMessages,
        agent: systemPromptId,
        conversation_id,
        locale: localeCode,
        timezone,
      } = parseResult.data;

      // Validate messages array
      if (!rawMessages || rawMessages.length === 0) {
        res.status(400).json({
          error: "Bad Request",
          message: "messages is required and must be a non-empty array",
        });
        return;
      }

      // Extract the last user message for pipeline processing
      const lastUserMessage = extractLastUserMessage(rawMessages);
      if (!lastUserMessage) {
        res.status(400).json({
          error: "Bad Request",
          message: "No user message found in messages array",
        });
        return;
      }

      // Use provided conversation_id or generate new UUID for new conversations
      const conversationId = conversation_id || randomUUID();

      // Build conversation history for LLM
      // When L2 retrieval is enabled, fetch history from PostgreSQL instead of using client-sent messages
      const l2RetrievalEnabled = process.env.ENABLE_L2_RETRIEVAL !== "false";
      let messagesForLLM: UIMessage[];

      if (l2RetrievalEnabled && conversation_id) {
        // Create temporary trace context for history fetch
        const historyTraceCtx: TraceContext = {
          traceId: (req.headers["x-trace-id"] as string) || generateId(),
          spanId: generateId(),
          requestId,
          userId,
          sessionId: conversationId,
          startTime,
        };

        // Fetch conversation history from L2 (PostgreSQL)
        const historyResult = await pipeline
          .getDeps()
          .memory.getConversationHistory(conversationId, 50, historyTraceCtx);

        if (historyResult.ok && historyResult.value.length > 0) {
          // Convert fetched messages to UIMessage format (requires parts array)
          const fetchedMessages: UIMessage[] = historyResult.value.map(
            (msg) => ({
              id: msg.id,
              role: msg.role,
              parts: [{ type: "text" as const, text: msg.content }],
            }),
          );

          // Validate L2 messages - fail fast if any are empty
          validateMessagesNotEmpty(fetchedMessages, "L2", conversationId);

          // Append the incoming user message(s) - only take user messages from client
          const incomingUserMessages = rawMessages.filter(
            (m) => m.role === "user",
          );
          const incomingConverted: UIMessage[] = incomingUserMessages.map(
            (m) => ({
              id: m.id || generateId(),
              role: m.role as "user" | "assistant" | "system",
              parts: [
                {
                  type: "text" as const,
                  text:
                    m.content ||
                    (m.parts?.find((p) => p.type === "text")?.text ?? ""),
                },
              ],
            }),
          );

          // Validate incoming messages - fail fast if any are empty
          validateMessagesNotEmpty(
            incomingConverted,
            "incoming",
            conversationId,
          );

          messagesForLLM = [...fetchedMessages, ...incomingConverted];

          logger.debug(
            {
              fetchedCount: fetchedMessages.length,
              incomingCount: incomingUserMessages.length,
              totalCount: messagesForLLM.length,
            },
            "Built conversation history from L2 + incoming messages",
          );
        } else {
          // No history found, use client-sent messages (first message in conversation)
          messagesForLLM = rawMessages as UIMessage[];
          validateMessagesNotEmpty(messagesForLLM, "client", conversationId);
          logger.debug("No L2 history found, using client-sent messages");
        }
      } else {
        // L2 retrieval disabled or no conversation_id - use client-sent messages
        messagesForLLM = rawMessages as UIMessage[];
        validateMessagesNotEmpty(messagesForLLM, "client", conversationId);
        if (!l2RetrievalEnabled) {
          logger.debug("L2 retrieval disabled, using client-sent messages");
        }
      }

      // Convert to model messages format for Vercel AI SDK
      const messages = convertToModelMessages(messagesForLLM);

      // Create trace context
      const traceContext: TraceContext = {
        traceId: (req.headers["x-trace-id"] as string) || generateId(),
        spanId: generateId(),
        requestId,
        userId,
        sessionId: conversationId,
        startTime,
      };

      // Create pipeline input with pre-loaded user data
      const input: PipelineInput = {
        message: lastUserMessage,
        conversationId,
        userId,
        systemPromptId,
        userProfile: userData.profile,
        displayName: userData.displayName,
        localeCode: localeCode || 'US',
        timezone,
      };

      logger.info(
        {
          conversationId,
          userId,
          messageLength: lastUserMessage.length,
          messageCount: messages.length,
          systemPromptId,
        },
        "Processing chat message",
      );

      // STAGE 1: Pre-flight checks (crisis, memory, system prompt)
      const preflightResult = await pipeline.preflight(input, traceContext);
      if (!preflightResult.ok) {
        logger.error(
          { error: preflightResult.error },
          "Preflight checks failed",
        );
        res.status(500).json({
          error: "Processing Error",
          message: preflightResult.error.message,
          kind: preflightResult.error.kind,
        });
        return;
      }

      const { systemPrompt, crisisCheck } = preflightResult.value;

      // Handle emergency crisis - need to respond immediately
      if (crisisCheck.triggerEmergency) {
        logger.warn(
          { crisisLevel: crisisCheck.level },
          "Emergency crisis detected",
        );

        // Get emergency response from crisis handler
        const emergencyResult = await pipeline
          .getDeps()
          .crisisHandler.handle(
            crisisCheck,
            userId,
            conversationId,
            traceContext,
          );

        if (emergencyResult.ok && emergencyResult.value.prependMessage) {
          // Stream emergency response using Vercel AI SDK
          const emergencyStream = streamText({
            model: anthropic(getAgentModel()),
            system:
              "You are Siri. The user may be in crisis. Respond with care and compassion.",
            messages: [{ role: "user", content: lastUserMessage }],
            maxOutputTokens: 500,
          });

          // Pipe the UI message stream to the Express response
          pipeUIMessageStreamToResponse({
            response: res,
            status: 200,
            stream: emergencyStream.toUIMessageStream(),
          });

          // Post-process the emergency response
          emergencyStream.text
            .then(async (text) => {
              await pipeline.postProcess(
                input,
                text,
                preflightResult.value,
                traceContext,
              );
            })
            .catch((err) => {
              logger.error({ err }, "Emergency post-process failed");
            });

          return;
        }
      }

      // STAGE 2: Stream response using Vercel AI SDK
      // Build tools object from enabled tool categories
      const deps = pipeline.getDeps();
      const memoryToolAccess = deps.memoryToolAccess || "off";
      const l5MemoryEnabled = deps.l5MemoryEnabled || false;
      const toolsEnabled = process.env.ENABLE_TOOLS !== "false";

      // Set trace context for memory tools before streaming
      // If L5 is enabled, use Mem0 tools; otherwise use L3/L4 memory tools
      if (l5MemoryEnabled) {
        setMem0ToolTraceContext(traceContext);
      } else if (memoryToolAccess !== "off") {
        setMemoryToolTraceContext(traceContext);
      }

      // RAG tools (read-only consumer of ninshubur's wisdom archive)
      setRagToolTraceContext(traceContext);

      // Build tools: L5 Mem0 tools take precedence over L3/L4 tools
      const memoryTools = l5MemoryEnabled
        ? getMem0Tools()
        : memoryToolAccess !== "off"
          ? getMemoryTools(memoryToolAccess)
          : {};

      // RAG tools (empty if RAG is disabled or store not initialized)
      const ragToolsMap = getRagTools();

      // Get MCP tools (external MCP servers like fetch, filesystem, etc.)
      const mcpTools = getMcpTools();
      if (Object.keys(mcpTools).length > 0) {
        logger.debug(
          { count: Object.keys(mcpTools).length },
          "MCP tools available",
        );
      }

      const tools = {
        ...(toolsEnabled ? agentTools : {}),
        ...memoryTools,
        ...ragToolsMap,
        ...mcpTools,
      };

      // Track preflight duration for metrics
      const preflightDuration = Date.now() - startTime;
      const agentModel = getAgentModel();

      logger.info(
        { model: agentModel, preflightDuration },
        "Starting agent stream",
      );

      const result = streamText({
        model: anthropic(agentModel),
        system: systemPrompt,
        messages,
        tools,
        stopWhen: stepCountIs(20), // Increased from 5 to allow for sequential thinking tool calls
        maxOutputTokens: 20480,
        onStepFinish: ({ toolCalls, finishReason, text }) => {
          // Log at INFO level when tool calls happen so we can see MCP tool usage
          if (toolCalls && toolCalls.length > 0) {
            logger.info(
              {
                toolCalls: toolCalls.map((t) => ({
                  name: (t as { toolName?: string }).toolName,
                  argsKeys: Object.keys(
                    (t as { args?: Record<string, unknown> }).args || {},
                  ),
                })),
                finishReason,
              },
              "Agent step with tool calls",
            );
          } else {
            logger.debug(
              {
                finishReason,
                stepTextLength: text?.length ?? 0,
                stepTextEmpty: !text || text.trim() === "",
              },
              "Agent step finished (no tool calls)",
            );
          }
        },
      });

      // Use native UI Message Stream with metrics metadata
      const {
        memoryStats,
        previousPostProcess,
        semanticSearch,
        memoryPrompts,
      } = preflightResult.value;
      pipeUIMessageStreamToResponse({
        response: res,
        status: 200,
        stream: result.toUIMessageStream({
          messageMetadata: ({ part }) => {
            // Add metrics on finish event
            if (part.type === "finish") {
              return {
                metrics: {
                  preflightMs: preflightDuration,
                  totalMs: Date.now() - startTime,
                  inputTokens: part.totalUsage?.inputTokens ?? 0,
                  outputTokens: part.totalUsage?.outputTokens ?? 0,
                  crisisLevel: crisisCheck.level,
                  toolsEnabled: Object.keys(tools).length,
                  // Detailed tier diagnostics (read operations)
                  memory: {
                    cacheHits: memoryStats.cacheHits,
                    cacheMisses: memoryStats.cacheMisses,
                    l1: memoryStats.l1,
                    l2: memoryStats.l2,
                    l3: memoryStats.l3,
                    l4: memoryStats.l4,
                  },
                  // Phase-shifted stats from previous exchange (write operations)
                  previousExchange: previousPostProcess
                    ? {
                        timestamp: previousPostProcess.timestamp,
                        durationMs: previousPostProcess.durationMs,
                        writes: previousPostProcess.writes,
                        safety: previousPostProcess.safety,
                        evaluation: previousPostProcess.evaluation,
                      }
                    : null,
                  // L4 semantic search diagnostics
                  semanticSearch: semanticSearch
                    ? {
                        query: semanticSearch.query,
                        preprocessedQuery: semanticSearch.preprocessedQuery,
                        searched: semanticSearch.searched,
                        results: semanticSearch.results,
                      }
                    : null,
                  // Phase-shifted memory prompts (from previous postflight)
                  memoryPrompts: {
                    count: memoryPrompts.length,
                    totalChars: memoryPrompts.reduce(
                      (sum, p) => sum + p.length,
                      0,
                    ),
                  },
                },
              };
            }
            return undefined;
          },
        }),
      });

      // STAGE 3: Post-process after stream completes (async, don't await)
      result.text
        .then(async (responseText) => {
          const duration = Date.now() - startTime;

          // DEBUG: Log responseText details to diagnose empty message bug
          logger.debug(
            {
              requestId,
              responseTextLength: responseText.length,
              responseTextEmpty: !responseText || responseText.trim() === "",
              responseTextPreview: responseText.slice(0, 100),
            },
            "Stream completed - responseText received",
          );

          // FAIL-FAST: Throw if responseText is empty
          // This prevents storing empty assistant messages in L2
          if (!responseText || responseText.trim() === "") {
            const error = new Error(
              `Empty responseText from stream. ` +
                `ConversationId: ${conversationId}, RequestId: ${requestId}. ` +
                `This indicates the stream produced no text output (possibly tool-calls only).`,
            );
            error.name = "EmptyResponseError";
            throw error;
          }

          logger.info(
            { requestId, duration },
            "Stream completed, starting post-process",
          );

          await pipeline.postProcess(
            input,
            responseText,
            preflightResult.value,
            traceContext,
          );

          logger.info(
            { requestId, totalDuration: Date.now() - startTime },
            "Request fully completed",
          );
        })
        .catch((err) => {
          logger.error({ err }, "Post-process failed");
        })
        .finally(() => {
          // Clean up memory tool trace context
          if (l5MemoryEnabled) {
            clearMem0ToolTraceContext();
          } else if (memoryToolAccess !== "off") {
            clearMemoryToolTraceContext();
          }
          // Clean up RAG tool trace context (always set above)
          clearRagToolTraceContext();
        });
    } catch (error) {
      // Properly extract error details for logging
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      logger.error(
        { errorMessage, errorStack, errorType: error?.constructor?.name },
        "Unexpected error in chat endpoint",
      );

      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal Server Error",
          message: errorMessage || "An unexpected error occurred",
        });
      }
    }
  });

  /**
   * GET /api/v1/chat/health
   *
   * Health check for chat service
   */
  router.get("/health", async (_req, res) => {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
