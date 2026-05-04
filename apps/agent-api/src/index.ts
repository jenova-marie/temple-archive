/**
 * Siri Agent API
 *
 * Express server for the Siri AI companion agent
 */

import { loadConfig, type Config } from "@siri/config";

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
} from "@siri/observability";
import { createContainer } from "./container.js";
import { createChatRouter } from "./routes/chat.js";
import { createHealthRouter } from "./routes/health.js";
import { createRagRouter } from "./routes/rag.js";
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

// Auth middleware (optional - only enabled if AUTH0_ISSUER_BASE_URL is set)
const auth = getAuthMiddleware();

// Routes
app.use("/health", createHealthRouter());

// Chat API - requires authentication if Auth0 is configured
if (auth) {
  app.use("/api/v1/chat", auth.required, createChatRouter({
    pipeline: container.pipeline,
    loadUserData: container.loadUserData,
  }));
  logger.info("Auth0 JWT authentication enabled for /api/v1/chat");
} else {
  // Check if we're in production without auth
  const isProduction = process.env.NODE_ENV === "production";
  const message = "No authentication configured - API is running UNPROTECTED";

  if (isProduction) {
    logger.error(
      {
        AUTH0_ISSUER_BASE_URL: process.env.AUTH0_ISSUER_BASE_URL ? "[SET]" : "[NOT SET]",
        AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE ? "[SET]" : "[NOT SET]",
        DISABLE_AUTH: process.env.DISABLE_AUTH,
      },
      `${message} - SET AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE or DISABLE_AUTH=true`
    );
  } else {
    logger.warn(message);
  }

  app.use("/api/v1/chat", createChatRouter({
    pipeline: container.pipeline,
    loadUserData: container.loadUserData,
  }));
}

// RAG API — read-only consumer of ninshubur's wisdom archive.
// Only mounted when RAG is configured (ENABLE_RAG=true + voyage/ninshubur env).
if (container.ragStore) {
  if (auth) {
    app.use(
      "/api/v1/rag",
      auth.required,
      createRagRouter({ ragStore: container.ragStore }),
    );
    logger.info("Auth0 JWT authentication enabled for /api/v1/rag");
  } else {
    app.use("/api/v1/rag", createRagRouter({ ragStore: container.ragStore }));
    logger.warn("RAG API mounted WITHOUT authentication");
  }
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

    // Authentication (Auth0)
    AUTH0_ISSUER_BASE_URL: config.auth.auth0.issuerBaseURL || "[NOT SET]",
    AUTH0_AUDIENCE: config.auth.auth0.audience || "[NOT SET]",
    AUTH_ENABLED: auth ? "true" : "false",
  };

  logger.info(startupInfo, "Siri Agent API started");
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
