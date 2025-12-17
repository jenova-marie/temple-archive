import { defineConfig } from "drizzle-kit";

// Local development - uses Docker postgres container
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "postgres",
    database: "agent",
    ssl: false,
  },
  verbose: true,
  strict: true,
});
