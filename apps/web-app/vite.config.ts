import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

const agentApiPort = process.env.AGENT_API_PORT || process.env.PORT || "6000";
if (!agentApiPort) {
  throw new Error("AGENT_API_PORT or PORT environment variable must be set");
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Deduplicate React to prevent "Invalid hook call" errors
    dedupe: ["react", "react-dom"],
  },
  // Pre-bundle deps to convert CommonJS to ESM and deduplicate React
  optimizeDeps: {
    include: ["@ricky0123/vad-react", "react", "react-dom"],
  },
  server: {
    port: parseInt(agentApiPort, 10),
    proxy: {
      "/api": `http://localhost:${agentApiPort}`,
    },
  },
});
