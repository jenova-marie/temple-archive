import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { getLogger } from "@siri/observability";
import { sql } from "@siri/db";
import authPlugin from "./plugins/auth.js";
import { transcribeRoutes } from "./routes/transcribe.js";
import { historyRoutes } from "./routes/history.js";
import { websocketRoutes } from "./routes/websocket.js";
import { db } from "./db/index.js";
import { MAX_AUDIO_SIZE_BYTES } from "@siri/shared";
import { env } from "./env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

export async function buildApp() {
  const logger = getLogger().child({ component: "fastify" });

  const app = Fastify({
    // Disable Fastify's built-in logger - use @siri/observability instead
    logger: false,
  });

  // Add request logging hook
  app.addHook("onRequest", async (request) => {
    (request as unknown as { logger: typeof logger }).logger = logger.child({
      requestId: request.id,
      method: request.method,
      url: request.url,
    });
  });

  // Log request completion
  app.addHook("onResponse", async (request, reply) => {
    const reqLogger =
      (request as unknown as { logger: typeof logger }).logger || logger;
    reqLogger.info(
      { statusCode: reply.statusCode, responseTime: reply.elapsedTime },
      "Request completed",
    );
  });

  // Register plugins
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_AUDIO_SIZE_BYTES,
    },
  });

  await app.register(websocket);

  // Register authentication plugin - Auth0 is mandatory
  const issuerBaseURL = env.AUTH0_ISSUER_BASE_URL;
  const audience = env.AUTH0_AUDIENCE;

  if (!issuerBaseURL || !audience) {
    throw new Error(
      "Auth0 authentication is required but not configured. " +
        "Set AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE environment variables.",
    );
  }

  await app.register(authPlugin, {
    issuerBaseURL,
    audience,
    skipRoutes: ["/health"],
  });
  logger.info({ issuer: issuerBaseURL, audience }, "Auth plugin registered");

  // Register API routes
  await app.register(transcribeRoutes);
  await app.register(historyRoutes);
  await app.register(websocketRoutes);

  // Health check
  app.get("/health", async (_request, reply) => {
    const health: {
      status: "ok" | "degraded" | "error";
      timestamp: string;
      uptime: number;
      database: "connected" | "disconnected";
    } = {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: "disconnected",
    };

    try {
      await db.execute(sql`SELECT 1`);
      health.database = "connected";
    } catch {
      health.status = "degraded";
    }

    const statusCode = health.status === "ok" ? 200 : 503;
    return reply.status(statusCode).send(health);
  });

  // Serve frontend static files in production
  if (isProduction) {
    const staticPath = resolve(__dirname, "../../app/dist");

    if (existsSync(staticPath)) {
      await app.register(fastifyStatic, {
        root: staticPath,
        prefix: "/",
      });

      // SPA fallback - serve index.html for non-API routes
      app.setNotFoundHandler(async (request, reply) => {
        if (
          !request.url.startsWith("/api") &&
          !request.url.startsWith("/ws") &&
          !request.url.startsWith("/health")
        ) {
          return reply.sendFile("index.html");
        }
        return reply.status(404).send({ error: "Not found" });
      });
    }
  }

  return app;
}
