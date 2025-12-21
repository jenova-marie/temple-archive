/**
 * Neo4j Session Factory
 *
 * Provides clean session creation with support for:
 * - User database sessions (for normal operations)
 * - System database sessions (for database management)
 * - Auto-cleanup wrappers
 */

import type { Driver, Session } from "neo4j-driver"

export class SessionFactory {
  constructor(
    private driver: Driver,
    private defaultDatabase: string = "neo4j"
  ) {}

  /**
   * Get the default database name
   */
  getDefaultDatabase(): string {
    return this.defaultDatabase
  }

  /**
   * Create a session for user operations.
   * @param database - Target database name (defaults to configured default)
   */
  createSession(database?: string): Session {
    return this.driver.session({
      database: database ?? this.defaultDatabase,
    })
  }

  /**
   * Create a session targeting the system database.
   * Used for database management operations like CREATE DATABASE, SHOW DATABASES.
   */
  createSystemSession(): Session {
    return this.driver.session({ database: "system" })
  }

  /**
   * Execute an operation with automatic session cleanup.
   * @param operation - Async function receiving the session
   * @param database - Target database name (optional)
   */
  async withSession<T>(
    operation: (session: Session) => Promise<T>,
    database?: string
  ): Promise<T> {
    const session = this.createSession(database)
    try {
      return await operation(session)
    } finally {
      await session.close()
    }
  }

  /**
   * Execute an operation on the system database with automatic cleanup.
   * @param operation - Async function receiving the session
   */
  async withSystemSession<T>(
    operation: (session: Session) => Promise<T>
  ): Promise<T> {
    const session = this.createSystemSession()
    try {
      return await operation(session)
    } finally {
      await session.close()
    }
  }
}
