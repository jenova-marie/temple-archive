import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";

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
    proxy: {
      "/api": "http://localhost:4000", // recoverysky-api
    },
  },
});
