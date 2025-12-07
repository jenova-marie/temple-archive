import { defineConfig } from "drizzle-kit";

// Local development - uses Docker postgres container
// Default: postgresql://postgres:postgres@localhost:5432/agent
const databaseUrl = "postgresql://trex:trex_dev_2024@localhost:5432/agent";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
