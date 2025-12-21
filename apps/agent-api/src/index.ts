/**
 * Pippa Agent API
 *
 * Express server for the Pippa AI companion agent
 */

import { loadConfig, type Config } from "@pippa/config";

// Load configuration (YAML + env vars)
// This must happen before other imports that might read process.env
export const config: Config = loadConfig({ allowMissingConfig: true });

import express from "express";
import cors from "cors";
import helmet from "helmet";
import {
  initializeObservability,
  shutdownObservability,
  getLogger,
} from "@pippa/observability";
import { createContainer } from "./container.js";
import { createChatRouter } from "./routes/chat.js";
import { createHealthRouter } from "./routes/health.js";
import { createGuidesRouter } from "./routes/guides.js";
import { tracingMiddleware } from "./middleware/tracing.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { getAuthMiddleware } from "./middleware/auth.js";

// Initialize observability
initializeObservability();

const logger = getLogger();

// Create container with dependencies
const container = createContainer({
  useStubs: config.app.useStubs,
});

// Initialize async services (Qdrant collection, etc)
container.init()
  .then(() => {
    logger.info("Container async initialization complete");
  })
  .catch((err) => {
    logger.error({ err, message: err?.message, stack: err?.stack }, "Failed to initialize container services");
  });

logger.info({ useStubs: container.config.useStubs }, "Container initialized");

// Create Express app
const app: ReturnType<typeof express> = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Trace-Id",
      "X-Request-Id",
    ],
  }),
);

// Body parsing
app.use(express.json({ limit: "1mb" }));

// Tracing middleware
app.use(tracingMiddleware);

// Auth middleware (optional - only enabled if ZITADEL_ISSUER is set)
const auth = getAuthMiddleware();

// Routes
app.use("/health", createHealthRouter());

// Chat API - requires authentication if Zitadel is configured
if (auth) {
  app.use("/api/v1/chat", auth.required, createChatRouter({
    pipeline: container.pipeline,
    loadUserData: container.loadUserData,
  }));
  app.use("/api/v1/guides", auth.required, createGuidesRouter(container));
  logger.info("Zitadel JWT authentication enabled for /api/v1/chat and /api/v1/guides");
} else {
  app.use("/api/v1/chat", createChatRouter({
    pipeline: container.pipeline,
    loadUserData: container.loadUserData,
  }));
  app.use("/api/v1/guides", createGuidesRouter(container));
  logger.warn("No authentication configured - API is unprotected");
}

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const port = config.app.port;

const server = app.listen(port, () => {
  // Log running configuration (sensitive values redacted)
  const startupInfo = {
    // Application
    NODE_ENV: config.app.nodeEnv,
    PORT: config.app.port,
    LOG_LEVEL: config.app.logLevel,
    USE_STUBS: config.app.useStubs,

    // AI Providers (redacted)
    ANTHROPIC_API_KEY: config.ai.anthropic.apiKey ? "[SET]" : "[NOT SET]",
    OPENAI_API_KEY: config.ai.openai.apiKey ? "[SET]" : "[NOT SET]",

    // L1: Redis
    REDIS_URL: config.redis.url,

    // L2: PostgreSQL (redact password)
    DATABASE_URL: config.postgresql.url.replace(/:([^:@]+)@/, ":***@"),

    // L3: Neo4j (redact password)
    NEO4J_URI: config.neo4j.uri || "[NOT SET]",
    NEO4J_USER: config.neo4j.user,
    NEO4J_PASSWORD: config.neo4j.password ? "[SET]" : "[NOT SET]",

    // L4: Qdrant
    QDRANT_URL: config.qdrant.url,

    // Observability
    OTEL_EXPORTER_OTLP_ENDPOINT: config.observability.otlpEndpoint || "[NOT SET]",
    OTEL_SERVICE_NAME: config.observability.serviceName,

    // Crisis Response
    CRISIS_WEBHOOK_URL: config.crisis.webhookUrl ? "[SET]" : "[NOT SET]",
    CRISIS_THRESHOLD_HIGH: config.crisis.thresholdHigh,
    CRISIS_THRESHOLD_CRITICAL: config.crisis.thresholdCritical,

    // Authentication (Zitadel)
    ZITADEL_ISSUER: config.auth.zitadel.issuer || "[NOT SET]",
    ZITADEL_AUDIENCE: config.auth.zitadel.audience || "[NOT SET]",
    AUTH_ENABLED: auth ? "true" : "false",
  };

  logger.info(startupInfo, "Pippa Agent API started");
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, "Shutdown signal received");

  server.close(async () => {
    logger.info("HTTP server closed");

    // Flush observability data
    await shutdownObservability();

    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 30000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export { app };
