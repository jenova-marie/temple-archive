/**
 * Read-only connection to ninshubur's Postgres.
 *
 * ninshubur owns the corpus (messages, message_groups, users, etc.) —
 * siri does not write here, only reads to hydrate Qdrant search hits.
 *
 * Connection is configured via NINSHUBUR_DATABASE_URL (same shape as
 * siri's DATABASE_URL). Optional NINSHUBUR_DATABASE_SSL controls SSL.
 */

import pg from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'

export type NinshuburDb = NodePgDatabase<Record<string, never>>

export interface NinshuburDbConfig {
  /** PostgreSQL connection string for ninshubur's database. */
  connectionString: string
  /**
   * SSL behavior:
   *   - undefined: pg's default (URL-driven)
   *   - false: SSL disabled
   *   - { rejectUnauthorized: false }: SSL enabled, accept self-signed
   */
  ssl?: false | { rejectUnauthorized: boolean }
  /** Pool tuning. */
  max?: number
  idleTimeoutMillis?: number
  connectionTimeoutMillis?: number
}

export interface NinshuburDbHandle {
  db: NinshuburDb
  pool: pg.Pool
  /** Cleanup — close the pool. */
  close(): Promise<void>
}

/**
 * Create a Drizzle client over a dedicated pg.Pool for ninshubur's DB.
 * The handle exposes both the Drizzle client (for queries) and the pool
 * (for explicit close on shutdown).
 */
export function createNinshuburDb(config: NinshuburDbConfig): NinshuburDbHandle {
  const pool = new pg.Pool({
    connectionString: config.connectionString,
    ssl: config.ssl,
    max: config.max ?? 5,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5_000,
  })
  const db = drizzle(pool) as NinshuburDb
  return {
    db,
    pool,
    async close() {
      await pool.end()
    },
  }
}

/**
 * Resolve the SSL setting from a string env var following the same
 * convention as siri's main DATABASE_SSL:
 *   - "false" → SSL off
 *   - "true"  → SSL on, accept self-signed
 *   - unset / anything else → undefined (let pg parse the URL)
 */
export function resolveNinshuburSsl(
  raw: string | undefined,
): NinshuburDbConfig['ssl'] {
  if (raw === 'false') return false
  if (raw === 'true') return { rejectUnauthorized: false }
  return undefined
}
