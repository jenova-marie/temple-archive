/**
 * WebSocket routes for real-time audio streaming
 *
 * Handles live microphone transcription via WebSocket.
 * All transcriptions are scoped to the authenticated user.
 */

import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { transcriptionRepository } from "../db/index.js";
import { transcribeAudio } from "../services/groq.js";
import { getLogger, withSpan } from "@pippa/observability";
import { nanoid } from "nanoid";
import type { ClientMessage, ServerMessage } from "@pippa/shared";

function createTraceContext(requestId: string, userId?: string) {
  return {
    traceId: nanoid(),
    spanId: nanoid(),
    requestId,
    userId,
    startTime: Date.now(),
  };
}

export const websocketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/ws/stream",
    { websocket: true },
    (socket: WebSocket, request: FastifyRequest) => {
      const requestId = nanoid();
      const logger = getLogger().child({ requestId, route: "websocket" });

      // Check authentication
      if (!request.user) {
        logger.warn("Unauthenticated WebSocket connection attempt");
        socket.close(4001, "Authentication required");
        return;
      }

      const userId = request.user.id;
      logger.info({ userId }, "WebSocket client connected");

      socket.on(
        "message",
        async (rawMessage: Buffer | ArrayBuffer | Buffer[]) => {
          try {
            const message: ClientMessage = JSON.parse(rawMessage.toString());

            if (message.type === "audio_segment") {
              await withSpan("websocket.transcribe", async () => {
                const audioBuffer = Buffer.from(message.data, "base64");

                try {
                  const result = await transcribeAudio(audioBuffer);

                  // Save to database with user scoping
                  const ctx = createTraceContext(requestId, userId);
                  const saveResult = await transcriptionRepository.create(
                    {
                      userId,
                      text: result.text,
                      duration: result.duration ?? null,
                      source: "microphone",
                      filename: null,
                    },
                    ctx
                  );

                  if (!saveResult.ok) {
                    logger.error({ error: saveResult.error }, "Failed to save transcription");
                  }

                  const response: ServerMessage = {
                    type: "transcription",
                    text: result.text,
                    segmentId: message.segmentId,
                  };

                  socket.send(JSON.stringify(response));
                } catch (error) {
                  logger.error({ error }, "WebSocket transcription failed");
                  const errorResponse: ServerMessage = {
                    type: "error",
                    message: "Transcription failed",
                  };
                  socket.send(JSON.stringify(errorResponse));
                }
              });
            } else if (message.type === "stop_session") {
              logger.info("Client requested session stop");
            }
          } catch (error) {
            logger.error({ error }, "WebSocket message parse error");
            const errorResponse: ServerMessage = {
              type: "error",
              message: "Invalid message format",
            };
            socket.send(JSON.stringify(errorResponse));
          }
        },
      );

      socket.on("close", () => {
        logger.info("WebSocket client disconnected");
      });

      socket.on("error", (error: Error) => {
        logger.error({ error }, "WebSocket error");
      });
    },
  );
};
