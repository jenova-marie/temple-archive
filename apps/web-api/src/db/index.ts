/**
 * Database client and repositories for web-api
 *
 * Uses shared @pippa/db package for schema and repositories.
 */

import { createDatabaseClient, TranscriptionRepository } from "@pippa/db";
import { env } from "../env.js";

// Create database client
export const db = createDatabaseClient({ connectionString: env.DATABASE_URL });

// Create repository instance
export const transcriptionRepository = new TranscriptionRepository(db);

// Re-export types for convenience
export type { Transcription, NewTranscription } from "@pippa/db";
