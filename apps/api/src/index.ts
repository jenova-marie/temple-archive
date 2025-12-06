/**
 * RecoverySky Agent API
 *
 * Express server for the RecoverySky AI chatbot agent
 */

import "dotenv/config";
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
  logger.info({ port }, "Server started");
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🌟 RecoverySky Agent API                                ║
║                                                           ║
║   Server running at: http://localhost:${port}               ║
║   Health check:      http://localhost:${port}/health        ║
║   Metrics:           http://localhost:${port}/health/metrics║
║                                                           ║
║   Mode: ${container.config.useStubs ? "STUB (development)" : "PRODUCTION"}                           ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
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
