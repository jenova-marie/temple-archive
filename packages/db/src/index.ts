/**
 * @siri/db
 *
 * PostgreSQL database layer using Drizzle ORM.
 * Provides schema definitions, database client, and store implementations.
 */

// Client
export {
  createDatabaseClient,
  getDatabaseClient,
  closeDatabaseClient,
  type DatabaseClient,
  type DatabaseConfig,
} from './client.js'

// Drizzle utilities (re-exported for convenience)
export { sql } from 'drizzle-orm'

// Schema
export * from './schema/index.js'

// Stores
export { PostgresSessionStore, SystemPromptRepository, type SystemPromptError, UserRepository, type UserError, type UserData, UserCacheStore, type UserCacheConfig, LiteratureRepository, type LiteratureError, type LiteratureSearchResult, type LiteratureBlockWithMeta, TranscriptionRepository, type TranscriptionError } from './stores/index.js'
