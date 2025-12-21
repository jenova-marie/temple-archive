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
  },
  // Pre-bundle VAD/ONNX deps to convert CommonJS to ESM
  optimizeDeps: {
    include: ["@ricky0123/vad-react", "@ricky0123/vad-web", "onnxruntime-web"],
  },
  server: {
    proxy: {
      "/api": "http://localhost:4000", // recoverysky-api
    },
  },
});
