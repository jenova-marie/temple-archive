/**
 * Neo4j Database Manager
 *
 * Handles database lifecycle operations:
 * - Database existence checking
 * - Database creation
 * - Database switching
 * - Name normalization and validation
 *
 * Uses the system database for management operations, following the pattern
 * from mcp-neo4j-memory-server.
 */

import { getLogger } from "@siri/observability"
import type { SessionFactory } from "./SessionFactory.js"

/**
 * Information about a database switch operation
 */
export interface DatabaseInfo {
  /** Previous database context */
  previousDatabase: string
  /** Current database context after switch */
  currentDatabase: string
  /** Whether the database was created (true) or already existed (false) */
  created: boolean
}

export class DatabaseManager {
  private currentDatabase: string
  private logger = getLogger().child({ component: "DatabaseManager" })

  constructor(
    private sessionFactory: SessionFactory,
    defaultDatabase: string = "neo4j"
  ) {
    this.currentDatabase = defaultDatabase
  }

  /**
   * Get the current database context
   */
  getCurrentDatabase(): string {
    return this.currentDatabase
  }

  /**
   * Switch to a database, creating it if needed.
   *
   * @param databaseName - Raw database name (will be normalized)
   * @returns Information about the switch operation
   * @throws Error if the normalized name is invalid
   */
  async switchDatabase(databaseName: string): Promise<DatabaseInfo> {
    const normalized = this.normalizeDatabaseName(databaseName)

    if (!this.isValidDatabaseName(normalized)) {
      throw new Error(
        `Invalid database name after normalization: "${databaseName}" -> "${normalized}"`
      )
    }

    const previousDatabase = this.currentDatabase

    // Already in the target database
    if (previousDatabase === normalized) {
      return { previousDatabase, currentDatabase: normalized, created: false }
    }

    // Check if database exists
    const exists = await this.databaseExists(normalized)

    // Create if needed
    if (!exists) {
      await this.createDatabase(normalized)
    }

    // Update context
    this.currentDatabase = normalized

    this.logger.info(
      { previousDatabase, currentDatabase: normalized, created: !exists },
      "Database switched"
    )

    return {
      previousDatabase,
      currentDatabase: normalized,
      created: !exists,
    }
  }

  /**
   * Ensure a database exists, creating it if needed.
   * Does not switch the current context.
   *
   * @param databaseName - Raw database name (will be normalized)
   * @returns The normalized database name
   */
  async ensureDatabase(databaseName: string): Promise<string> {
    const normalized = this.normalizeDatabaseName(databaseName)

    if (!this.isValidDatabaseName(normalized)) {
      throw new Error(
        `Invalid database name after normalization: "${databaseName}" -> "${normalized}"`
      )
    }

    const exists = await this.databaseExists(normalized)

    if (!exists) {
      await this.createDatabase(normalized)
    }

    return normalized
  }

  /**
   * Check if a database exists using the system database.
   *
   * @param databaseName - Normalized database name
   * @returns true if database exists, false otherwise
   */
  async databaseExists(databaseName: string): Promise<boolean> {
    return this.sessionFactory.withSystemSession(async (session) => {
      try {
        const result = await session.run(
          "SHOW DATABASES YIELD name WHERE name = $name",
          { name: databaseName }
        )
        return result.records.length > 0
      } catch (error) {
        // Fallback for older Neo4j versions or permission issues
        // Assume database exists and let the connection attempt determine
        this.logger.warn(
          { error, databaseName },
          "Cannot check database existence via system db, assuming exists"
        )
        return true
      }
    })
  }

  /**
   * Create a new database using the system database.
   *
   * @param databaseName - Normalized database name
   */
  async createDatabase(databaseName: string): Promise<void> {
    await this.sessionFactory.withSystemSession(async (session) => {
      try {
        await session.run("CREATE DATABASE $name IF NOT EXISTS", {
          name: databaseName,
        })

        // Wait for Neo4j to initialize the database
        // This is necessary because database creation is async in Neo4j
        await new Promise((resolve) => setTimeout(resolve, 1000))

        this.logger.info({ databaseName }, "Database created successfully")
      } catch (error) {
        // Database creation might not be allowed:
        // - Neo4j Community Edition (single database only)
        // - Insufficient permissions
        // Continue anyway - Dozer and some setups auto-create on first use
        this.logger.warn(
          { error, databaseName },
          "Could not create database (may require Enterprise/Dozer or already exists)"
        )
      }
    })
  }

  /**
   * Normalize a database name to Neo4j requirements.
   *
   * Neo4j database naming rules:
   * - Lowercase letters, numbers, and hyphens only
   * - Must start and end with alphanumeric character
   * - Maximum 63 characters
   *
   * @param name - Raw database name (e.g., user ID, email)
   * @returns Normalized database name
   */
  normalizeDatabaseName(name: string): string {
    // Convert to lowercase
    let normalized = name.toLowerCase()

    // Replace spaces with hyphens
    normalized = normalized.replace(/\s+/g, "-")

    // Remove invalid characters (keep only lowercase letters, numbers, hyphens)
    normalized = normalized.replace(/[^a-z0-9-]/g, "")

    // Remove leading hyphens
    normalized = normalized.replace(/^-+/, "")

    // Ensure starts with alphanumeric (prefix with 'u' if starts with number)
    if (normalized && /^[0-9]/.test(normalized)) {
      normalized = "u" + normalized
    }

    // Remove trailing hyphens
    normalized = normalized.replace(/-+$/, "")

    // Collapse multiple consecutive hyphens
    normalized = normalized.replace(/-+/g, "-")

    // Trim to max length (Neo4j max is 63 characters)
    if (normalized.length > 63) {
      normalized = normalized.substring(0, 63)
      // Ensure we don't end with a hyphen after truncation
      normalized = normalized.replace(/-+$/, "")
    }

    // Fallback for empty result
    if (!normalized) {
      normalized = "default"
    }

    return normalized
  }

  /**
   * Validate that a database name matches Neo4j constraints.
   *
   * @param name - Database name to validate (should be already normalized)
   * @returns true if valid, false otherwise
   */
  isValidDatabaseName(name: string): boolean {
    if (!name || name.length === 0 || name.length > 63) {
      return false
    }

    // Neo4j: lowercase letters, numbers, hyphens only
    // Must start and end with alphanumeric (or be a single character)
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name)
  }
}
