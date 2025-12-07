/**
 * Neo4j Driver Factory
 *
 * Creates and manages Neo4j driver connections for the knowledge graph.
 */

import neo4j, { type Driver, type Session, type SessionConfig } from 'neo4j-driver'
import { getLogger } from '@recoverysky/observability'

export interface Neo4jConfig {
  /** Neo4j bolt URI (e.g., bolt://localhost:7687) */
  uri: string
  /** Neo4j username */
  user: string
  /** Neo4j password */
  password: string
  /** Maximum connection pool size */
  maxConnectionPoolSize?: number
  /** Connection acquisition timeout in ms */
  connectionAcquisitionTimeout?: number
}

/**
 * Create a Neo4j driver instance
 */
export function createNeo4jDriver(config: Neo4jConfig): Driver {
  const logger = getLogger().child({ component: 'neo4j' })

  logger.info({ uri: config.uri, user: config.user }, 'Creating Neo4j driver')

  return neo4j.driver(
    config.uri,
    neo4j.auth.basic(config.user, config.password),
    {
      maxConnectionPoolSize: config.maxConnectionPoolSize ?? 50,
      connectionAcquisitionTimeout: config.connectionAcquisitionTimeout ?? 60000,
      logging: {
        level: 'warn',
        logger: (level, message) => {
          if (level === 'error') {
            logger.error({ neo4jLevel: level }, message)
          } else if (level === 'warn') {
            logger.warn({ neo4jLevel: level }, message)
          } else {
            logger.debug({ neo4jLevel: level }, message)
          }
        },
      },
    }
  )
}

/**
 * Create a session from a driver
 */
export function createSession(driver: Driver, config?: SessionConfig): Session {
  return driver.session(config)
}

/**
 * Verify driver connectivity
 */
export async function verifyConnectivity(driver: Driver): Promise<boolean> {
  const logger = getLogger().child({ component: 'neo4j' })

  try {
    await driver.verifyConnectivity()
    logger.info('Neo4j connectivity verified')
    return true
  } catch (error) {
    logger.error({ error }, 'Neo4j connectivity check failed')
    return false
  }
}

/**
 * Close driver and release resources
 */
export async function closeDriver(driver: Driver): Promise<void> {
  const logger = getLogger().child({ component: 'neo4j' })

  try {
    await driver.close()
    logger.info('Neo4j driver closed')
  } catch (error) {
    logger.error({ error }, 'Error closing Neo4j driver')
  }
}
