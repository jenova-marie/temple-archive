/**
 * Public Archivist Q&A Endpoint
 *
 *   POST /api/v1/ask
 *   Content-Type: application/json
 *   X-API-Key: <key>
 *
 *   { "q": "<question>" }
 *
 * A simple, anonymous-friendly entry point into the Temple Archive that always
 * uses the `archivist` guide — sourced, quotable, attribution-bearing. Designed
 * for scripts, integrations, and lightweight clients that just want a JSON
 * answer without negotiating an OAuth flow.
 *
 * Auth: an API key passed via the `X-API-Key` header. The key list lives in
 * the `ASK_API_KEYS` env var (comma-separated). The route is only mounted in
 * index.ts when `ASK_API_KEYS` is set.
 *
 * Privacy: every request runs in Total Privacy mode with a synthetic anonymous
 * userId, so nothing is persisted to L1–L5 or to the conversation store. Each
 * call is a fresh, ephemeral conversation — no memory carries between calls.
 *
 * Crisis: the standard preflight crisis check still runs; level ≥ 8 short-
 * circuits with a safety reply rather than reaching the LLM.
 *
 * Why POST and not GET: an LLM call is neither idempotent nor side-effect-free
 * (cost, observability writes, crisis-webhook fire). The question also belongs
 * in a body — keeps it out of access logs, browser history, and proxy logs,
 * and lifts the URL-length cap.
 */

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { streamText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { PipelineInput, TraceContext } from "@siri/types";
import type { Pipeline } from "@siri/pipeline";
import { getLogger } from "@siri/observability";
import {
  agentTools,
  getRagTools,
  setRagToolTraceContext,
  clearRagToolTraceContext,
  getMcpTools,
} from "@siri/tools";

const DEFAULT_AGENT_MODEL = "claude-sonnet-4-20250514";
function getAgentModel(): string {
  return process.env.AGENT_MODEL ?? DEFAULT_AGENT_MODEL;
}

/** Always use the archivist guide for /ask — it's the sourced, quotable voice. */
const ASK_GUIDE = "archivist";

/** Cap on question length — generous, but stops abuse. */
const MAX_QUESTION_LENGTH = 2000;

const askBodySchema = z.object({
  q: z
    .string()
    .min(1, "q must be non-empty")
    .max(MAX_QUESTION_LENGTH, `q must be ≤ ${MAX_QUESTION_LENGTH} chars`),
});

interface AskRouterDeps {
  pipeline: Pipeline;
}

interface AskResponseBody {
  question: string;
  answer: string;
  guide: string;
  conversationId: string;
  crisisLevel: number;
  metrics: {
    preflightMs: number;
    totalMs: number;
  };
}

export function createAskRouter({ pipeline }: AskRouterDeps): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    const logger = getLogger().child({ route: "POST /api/v1/ask" });
    const startTime = Date.now();
    const requestId =
      (req.headers["x-request-id"] as string | undefined) ?? generateId();

    const parseResult = askBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: "Bad Request",
        message: "JSON body must include a non-empty `q` string",
        details: parseResult.error.issues,
      });
      return;
    }

    const question = parseResult.data.q;
    const conversationId = randomUUID();
    // Fresh anon id per request — preflight memory lookups against this id
    // will return nothing, which is what we want for a stateless endpoint.
    const userId = `anon:${randomUUID()}`;

    const traceContext: TraceContext = {
      traceId: (req.headers["x-trace-id"] as string | undefined) ?? generateId(),
      spanId: generateId(),
      requestId,
      userId,
      sessionId: conversationId,
      startTime,
    };

    const input: PipelineInput = {
      message: question,
      conversationId,
      userId,
      systemPromptId: ASK_GUIDE,
      userProfile: null,
      localeCode: "US",
      totalPrivacy: true,
    };

    try {
      logger.info(
        {
          conversationId,
          questionLength: question.length,
          questionPreview: question.slice(0, 100),
        },
        "Processing /ask",
      );

      // STAGE 1: Preflight resolves the system prompt + crisis check.
      // Memory retrieval also runs but returns empty for the fresh anon id.
      const preflightResult = await pipeline.preflight(input, traceContext);
      if (!preflightResult.ok) {
        logger.error(
          { error: preflightResult.error },
          "Preflight failed for /ask",
        );
        res.status(500).json({
          error: "Processing Error",
          message: preflightResult.error.message,
          kind: preflightResult.error.kind,
        });
        return;
      }

      const { systemPrompt, crisisCheck } = preflightResult.value;
      const preflightMs = Date.now() - startTime;

      // Crisis short-circuit: don't send a level-≥8 question to the LLM at all.
      // Return a safety-first reply with no archive content.
      if (crisisCheck.triggerEmergency) {
        logger.warn(
          { crisisLevel: crisisCheck.level },
          "Crisis detected on /ask — returning safety reply",
        );
        const body: AskResponseBody = {
          question,
          answer:
            "If you are in crisis, please reach out to someone you trust or call 988 (US Suicide & Crisis Lifeline). The archive is silent on this question.",
          guide: ASK_GUIDE,
          conversationId,
          crisisLevel: crisisCheck.level,
          metrics: {
            preflightMs,
            totalMs: Date.now() - startTime,
          },
        };
        res.status(200).json(body);
        return;
      }

      // STAGE 2: Run the agent against the archivist prompt. Tools include the
      // RAG searchKnowledge tool (the whole point of /ask) plus general agent
      // tools and MCP tools. No memory tools — anonymous users have no memory.
      setRagToolTraceContext(traceContext);
      const toolsEnabled = process.env.ENABLE_TOOLS !== "false";
      const tools = {
        ...(toolsEnabled ? agentTools : {}),
        ...getRagTools(),
        ...getMcpTools(),
      };

      const result = streamText({
        model: anthropic(getAgentModel()),
        system: systemPrompt,
        messages: [{ role: "user", content: question }],
        tools,
        stopWhen: stepCountIs(20),
        maxOutputTokens: 4096,
      });

      // Block until the stream finishes — /ask returns a single JSON body.
      const answer = await result.text;

      const body: AskResponseBody = {
        question,
        answer,
        guide: ASK_GUIDE,
        conversationId,
        crisisLevel: crisisCheck.level,
        metrics: {
          preflightMs,
          totalMs: Date.now() - startTime,
        },
      };
      res.status(200).json(body);

      logger.info(
        {
          conversationId,
          totalMs: body.metrics.totalMs,
          answerLength: answer.length,
        },
        "/ask completed",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      logger.error(
        { errorMessage: message, errorStack: stack },
        "Unexpected error in /ask",
      );
      if (!res.headersSent) {
        res.status(500).json({
          error: "Internal Server Error",
          message,
        });
      }
    } finally {
      clearRagToolTraceContext();
    }
  });

  return router;
}

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
