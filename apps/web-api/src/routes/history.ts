/**
 * History routes
 *
 * Handles transcription history retrieval and deletion.
 * All operations are scoped to the authenticated user.
 */

import type { FastifyPluginAsync } from "fastify";
import { transcriptionRepository } from "../db/index.js";
import { getLogger, withSpan } from "@siri/observability";
import { nanoid } from "nanoid";
import type { HistoryResponse, ErrorResponse } from "@siri/shared";

function createTraceContext(requestId: string, userId?: string) {
  return {
    traceId: nanoid(),
    spanId: nanoid(),
    requestId,
    userId,
    startTime: Date.now(),
  };
}

export const historyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Reply: HistoryResponse | ErrorResponse;
  }>("/api/history", async (request, reply) => {
    const requestId = nanoid();
    const logger = getLogger().child({ requestId, route: "history" });

    // Require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const userId = request.user.id;

    return withSpan("route.history.list", async () => {
      const ctx = createTraceContext(requestId, userId);
      const result = await transcriptionRepository.getHistory(userId, 100, ctx);

      if (!result.ok) {
        logger.error({ error: result.error }, "Failed to fetch history");
        return reply.status(500).send({ error: "Failed to fetch history" });
      }

      return reply.send({
        transcriptions: result.value.map((t) => ({
          id: t.id,
          text: t.text,
          duration: t.duration,
          source: t.source,
          filename: t.filename,
          createdAt: t.createdAt.toISOString(),
        })),
      });
    });
  });

  fastify.delete<{
    Params: { id: string };
    Reply: { success: boolean } | ErrorResponse;
  }>("/api/history/:id", async (request, reply) => {
    const requestId = nanoid();
    const logger = getLogger().child({ requestId, route: "history.delete" });

    // Require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const userId = request.user.id;
    const { id } = request.params;

    return withSpan("route.history.delete", async () => {
      const ctx = createTraceContext(requestId, userId);
      const result = await transcriptionRepository.delete(id, userId, ctx);

      if (!result.ok) {
        if (result.error.kind === "NotFound") {
          return reply.status(404).send({ error: "Transcription not found" });
        }
        logger.error({ error: result.error }, "Failed to delete transcription");
        return reply.status(500).send({ error: "Failed to delete transcription" });
      }

      return reply.send({ success: true });
    });
  });
};
