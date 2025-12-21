import type { FastifyPluginAsync } from "fastify";
import type { WebSocket } from "@fastify/websocket";
import { db } from "../db/index.js";
import { transcriptions } from "../db/schema.js";
import { transcribeAudio } from "../services/groq.js";
import type { ClientMessage, ServerMessage } from "@pippa/shared";

export const websocketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/ws/stream",
    { websocket: true },
    (socket: WebSocket, _request) => {
      fastify.log.info("WebSocket client connected");

      socket.on(
        "message",
        async (rawMessage: Buffer | ArrayBuffer | Buffer[]) => {
          try {
            const message: ClientMessage = JSON.parse(rawMessage.toString());

            if (message.type === "audio_segment") {
              const audioBuffer = Buffer.from(message.data, "base64");

              try {
                const result = await transcribeAudio(audioBuffer);

                // Save to database
                await db.insert(transcriptions).values({
                  text: result.text,
                  duration: result.duration ?? null,
                  source: "microphone",
                  filename: null,
                });

                const response: ServerMessage = {
                  type: "transcription",
                  text: result.text,
                  segmentId: message.segmentId,
                };

                socket.send(JSON.stringify(response));
              } catch (error) {
                fastify.log.error(error, "WebSocket transcription failed");
                const errorResponse: ServerMessage = {
                  type: "error",
                  message: "Transcription failed",
                };
                socket.send(JSON.stringify(errorResponse));
              }
            } else if (message.type === "stop_session") {
              fastify.log.info("Client requested session stop");
            }
          } catch (error) {
            fastify.log.error(error, "WebSocket message parse error");
            const errorResponse: ServerMessage = {
              type: "error",
              message: "Invalid message format",
            };
            socket.send(JSON.stringify(errorResponse));
          }
        },
      );

      socket.on("close", () => {
        fastify.log.info("WebSocket client disconnected");
      });

      socket.on("error", (error: Error) => {
        fastify.log.error(error, "WebSocket error");
      });
    },
  );
};
