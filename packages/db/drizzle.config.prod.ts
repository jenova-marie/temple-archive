import { defineConfig } from 'drizzle-kit'

// Production - DATABASE_URL loaded from .env via package.json script
// Format: postgresql://user:password@host:port/agent
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required for production migrations')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
})
