import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { target: "esnext" },
  optimizeDeps: {
    // This workspace package is rebuilt in watch mode during development. Let
    // Vite read the current output instead of retaining a pre-bundled copy.
    exclude: ["@slidescape/game"]
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787" },
      "/ws": { target: "ws://127.0.0.1:8787", ws: true },
      "/health": { target: "http://127.0.0.1:8787" }
    }
  }
});
