/**
 * Database client and repositories for web-api
 *
 * Uses shared @siri/db package for schema and repositories.
 */

import { createDatabaseClient, TranscriptionRepository } from "@siri/db";
import { env } from "../env.js";

// Create database client
export const db = createDatabaseClient({ connectionString: env.DATABASE_URL });

// Create repository instance
export const transcriptionRepository = new TranscriptionRepository(db);

// Re-export types for convenience
export type { Transcription, NewTranscription } from "@siri/db";
