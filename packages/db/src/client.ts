/**
 * Database Client
 *
 * Connection pool setup using pg + drizzle-orm.
 * Provides singleton access to the database client.
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema/index.js'

const { Pool } = pg

export interface DatabaseConfig {
  connectionString?: string
  host?: string
  port?: number
  user?: string
  password?: string
  database?: string
  ssl?: boolean | { rejectUnauthorized: boolean }
  max?: number
}

let pool: pg.Pool | null = null
let db: ReturnType<typeof drizzle<typeof schema>> | null = null

/**
 * Create the database client with connection pool
 */
export function createDatabaseClient(config: DatabaseConfig) {
  if (db) return db

  pool = new Pool({
    connectionString: config.connectionString,
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl,
    max: config.max ?? 10,
  })

  db = drizzle(pool, { schema })
  return db
}

/**
 * Get the database client (must call createDatabaseClient first)
 */
export function getDatabaseClient() {
  if (!db) {
    throw new Error('Database client not initialized. Call createDatabaseClient first.')
  }
  return db
}

/**
 * Close the database connection pool
 */
export async function closeDatabaseClient(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    db = null
  }
}

/**
 * Type for the database client
 */
export type DatabaseClient = ReturnType<typeof createDatabaseClient>
