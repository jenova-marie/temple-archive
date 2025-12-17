/**
 * @recoverysky/db
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

// Schema
export * from './schema/index.js'

// Stores
export { PostgresSessionStore, SystemPromptRepository, type SystemPromptError, UserRepository, type UserError, type UserData } from './stores/index.js'
