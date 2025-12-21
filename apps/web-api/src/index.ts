import { initializeObservability, shutdownObservability, getLogger } from '@pippa/observability';
import { buildApp } from './app.js';
import { env } from './env.js';

async function main() {
  // Initialize observability FIRST (before anything else)
  initializeObservability();

  const logger = getLogger().child({ service: 'web-api' });

  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT }, 'Server running');
  } catch (error) {
    logger.error({ error }, 'Server failed to start');
    process.exit(1);
  }

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await app.close();
    await shutdownObservability();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
