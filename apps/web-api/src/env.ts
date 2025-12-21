import { config } from 'dotenv';
import { resolve } from 'path';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// Load .env from apps/web-api directory before validating
config({ path: resolve(import.meta.dirname, '../.env') });

export const env = createEnv({
  server: {
    // Database
    DATABASE_URL: z.string().url(),

    // Groq API (speech-to-text)
    GROQ_API_KEY: z.string().min(1),

    // Server
    PORT: z
      .string()
      .default('3001')
      .transform((s) => parseInt(s, 10))
      .pipe(z.number().min(1).max(65535)),

    // Authentication (optional - if not set, auth is disabled)
    ZITADEL_ISSUER: z.string().url().optional(),
    ZITADEL_AUDIENCE: z.string().optional(),
    ZITADEL_CLIENT_ID: z.string().optional(),
    DISABLE_AUTH: z.enum(['true', 'false']).default('false'),

    // Observability
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
    SERVICE_NAME: z.string().default('web-api'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
