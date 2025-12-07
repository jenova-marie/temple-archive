/**
 * Neo4j module exports
 */

export {
  createNeo4jDriver,
  createSession,
  verifyConnectivity,
  closeDriver,
  type Neo4jConfig,
} from './client.js'

export {
  initializeSchema,
  dropSchema,
  clearData,
  SCHEMA_STATEMENTS,
} from './schema.js'
