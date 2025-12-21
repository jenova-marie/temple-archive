/**
 * Migrations Module
 *
 * Database migration scripts for evolving the memory schema.
 */

export {
  migrateToL3Memory,
  isMigrationNeeded,
  getMigrationStatus,
  type MigrationResult,
} from './v2-l3-memory.js'
