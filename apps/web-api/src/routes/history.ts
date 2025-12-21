import type { FastifyPluginAsync } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { transcriptions } from "../db/schema.js";
import type { HistoryResponse, ErrorResponse } from "@pippa/shared";

export const historyRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{
    Reply: HistoryResponse;
  }>("/api/history", async (_request, reply) => {
    const results = await db
      .select()
      .from(transcriptions)
      .orderBy(desc(transcriptions.createdAt))
      .limit(100);

    return reply.send({
      transcriptions: results.map((t) => ({
        id: t.id,
        text: t.text,
        duration: t.duration,
        source: t.source,
        filename: t.filename,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  });

  fastify.delete<{
    Params: { id: string };
    Reply: { success: boolean } | ErrorResponse;
  }>("/api/history/:id", async (request, reply) => {
    const { id } = request.params;

    const result = await db
      .delete(transcriptions)
      .where(eq(transcriptions.id, id))
      .returning({ id: transcriptions.id });

    if (result.length === 0) {
      return reply.status(404).send({ error: "Transcription not found" });
    }

    return reply.send({ success: true });
  });
};
