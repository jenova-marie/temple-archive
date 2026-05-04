import { config } from "dotenv";
import { resolve } from "path";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Load .env from apps/web-api directory before validating
config({ path: resolve(import.meta.dirname, "../.env") });

export const env = createEnv({
  server: {
    // Database
    DATABASE_URL: z.string().url(),

    // Groq API (speech-to-text) - optional
    GROQ_API_KEY: z.string().optional().default(""),

    // Server
    PORT: z
      .string()
      .default("61665")
      .transform((s) => parseInt(s, 10))
      .pipe(z.number().min(1).max(65535)),

    // Authentication (Auth0 is required)
    AUTH0_ISSUER_BASE_URL: z.string().url(),
    AUTH0_AUDIENCE: z.string(),
    AUTH0_CLIENT_ID: z.string().optional(),

    // Observability
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .default("info"),
    SERVICE_NAME: z.string().default("web-api"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
