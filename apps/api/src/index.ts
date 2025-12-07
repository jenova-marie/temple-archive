/**
 * RecoverySky Agent API
 *
 * Express server for the RecoverySky AI chatbot agent
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";

// Find monorepo root and load .env from there
function findMonorepoRoot(): string | null {
  let dir = resolve(process.cwd());
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    dir = dirname(dir);
  }
  return null;
}

const monorepoRoot = findMonorepoRoot();
if (monorepoRoot) {
  dotenvConfig({ path: join(monorepoRoot, ".env") });
}

import express from "express";
import cors from "cors";
import helmet from "helmet";
import {
  initializeObservability,
  shutdownObservability,
  getLogger,
} from "@recoverysky/observability";
import { createContainer } from "./container.js";
import { createChatRouter } from "./routes/chat.js";
import { createHealthRouter } from "./routes/health.js";
import { tracingMiddleware } from "./middleware/tracing.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

// Initialize observability
initializeObservability();

const logger = getLogger();

// Create container with dependencies
const container = createContainer({
  useStubs: process.env.USE_STUBS === "true",
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

// Routes
app.use("/health", createHealthRouter());
app.use("/api/chat", createChatRouter(container.pipeline));

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const port = parseInt(process.env.PORT || "3333", 10);

const server = app.listen(port, () => {
  // Log running configuration (sensitive values redacted)
  const config = {
    // Application
    NODE_ENV: process.env.NODE_ENV || "development",
    PORT: port,
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    USE_STUBS: process.env.USE_STUBS === "true",

    // AI Providers (redacted)
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "[SET]" : "[NOT SET]",
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "[SET]" : "[NOT SET]",

    // L1: Redis
    REDIS_URL: process.env.REDIS_URL || "[NOT SET]",

    // L2: PostgreSQL (redact password)
    DATABASE_URL: process.env.DATABASE_URL
      ? process.env.DATABASE_URL.replace(/:([^:@]+)@/, ":***@")
      : "[NOT SET]",

    // L3: Neo4j (redact password)
    NEO4J_URI: process.env.NEO4J_URI || "[NOT SET]",
    NEO4J_USER: process.env.NEO4J_USER || "[NOT SET]",
    NEO4J_PASSWORD: process.env.NEO4J_PASSWORD ? "[SET]" : "[NOT SET]",

    // L4: Qdrant
    QDRANT_URL: process.env.QDRANT_URL || "[NOT SET]",

    // Observability
    OTEL_EXPORTER_OTLP_ENDPOINT:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "[NOT SET]",
    OTEL_SERVICE_NAME: process.env.OTEL_SERVICE_NAME || "recoverysky-agent",

    // Crisis Response
    CRISIS_ALERT_WEBHOOK_URL: process.env.CRISIS_ALERT_WEBHOOK_URL
      ? "[SET]"
      : "[NOT SET]",
    CRISIS_THRESHOLD_HIGH: process.env.CRISIS_THRESHOLD_HIGH || "7",
    CRISIS_THRESHOLD_CRITICAL: process.env.CRISIS_THRESHOLD_CRITICAL || "9",
  };

  logger.info(config, "RecoverySky Agent API started");
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
