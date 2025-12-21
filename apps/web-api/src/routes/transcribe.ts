import type { FastifyPluginAsync } from "fastify";
import { db } from "../db/index.js";
import { transcriptions } from "../db/schema.js";
import { transcribeAudio } from "../services/groq.js";
import {
  MAX_AUDIO_SIZE_BYTES,
  SUPPORTED_AUDIO_TYPES,
} from "@pippa/shared";
import type { TranscribeResponse, ErrorResponse } from "@pippa/shared";

export const transcribeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{
    Reply: TranscribeResponse | ErrorResponse;
  }>("/api/transcribe", async (request, reply) => {
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

      const [inserted] = await db
        .insert(transcriptions)
        .values({
          text: result.text,
          duration: result.duration ?? null,
          source: "file",
          filename: file.filename,
        })
        .returning();

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
      fastify.log.error(error, "Transcription failed");
      return reply.status(500).send({ error: "Transcription failed" });
    }
  });
};
