/**
 * Transcription routes
 *
 * Handles audio file upload and transcription via Groq.
 * All transcriptions are scoped to the authenticated user.
 */

import type { FastifyPluginAsync } from "fastify";
import { transcriptionRepository } from "../db/index.js";
import { transcribeAudio } from "../services/groq.js";
import { getLogger, withSpan } from "@pippa/observability";
import { nanoid } from "nanoid";
import {
  MAX_AUDIO_SIZE_BYTES,
  SUPPORTED_AUDIO_TYPES,
} from "@pippa/shared";
import type { TranscribeResponse, ErrorResponse } from "@pippa/shared";

function createTraceContext(requestId: string, userId?: string) {
  return {
    traceId: nanoid(),
    spanId: nanoid(),
    requestId,
    userId,
    startTime: Date.now(),
  };
}

export const transcribeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Reply: TranscribeResponse | ErrorResponse;
  }>("/api/transcribe", async (request, reply) => {
    const requestId = nanoid();
    const logger = getLogger().child({ requestId, route: "transcribe" });

    // Require authentication
    if (!request.user) {
      return reply.status(401).send({ error: "Authentication required" });
    }

    const userId = request.user.id;
    logger.debug({ userId }, "Processing transcription request");

    return withSpan("route.transcribe", async () => {
      const file = await request.file();

      if (!file) {
        return reply.status(400).send({ error: "No audio file provided" });
      }

      if (
        !SUPPORTED_AUDIO_TYPES.includes(
          file.mimetype as (typeof SUPPORTED_AUDIO_TYPES)[number],
        )
      ) {
        return reply.status(400).send({
          error: `Unsupported audio format. Supported: ${SUPPORTED_AUDIO_TYPES.join(", ")}`,
        });
      }

      const chunks: Buffer[] = [];
      let totalSize = 0;

      for await (const chunk of file.file) {
        totalSize += chunk.length;
        if (totalSize > MAX_AUDIO_SIZE_BYTES) {
          return reply.status(400).send({
            error: `File too large. Maximum size: ${MAX_AUDIO_SIZE_BYTES / 1024 / 1024}MB`,
          });
        }
        chunks.push(chunk);
      }

      const audioBuffer = Buffer.concat(chunks);

      try {
        const result = await transcribeAudio(audioBuffer, file.filename);

        const ctx = createTraceContext(requestId, userId);
        const createResult = await transcriptionRepository.create(
          {
            userId,
            text: result.text,
            duration: result.duration ?? null,
            source: "file",
            filename: file.filename ?? null,
          },
          ctx
        );

        if (!createResult.ok) {
          logger.error({ error: createResult.error }, "Failed to save transcription");
          return reply.status(500).send({ error: "Failed to save transcription" });
        }

        const inserted = createResult.value;

        return reply.send({
          transcription: {
            id: inserted.id,
            text: inserted.text,
            duration: inserted.duration,
            source: inserted.source,
            filename: inserted.filename,
            createdAt: inserted.createdAt.toISOString(),
          },
        });
      } catch (error) {
        logger.error({ error }, "Transcription failed");
        return reply.status(500).send({ error: "Transcription failed" });
      }
    });
  });
};
