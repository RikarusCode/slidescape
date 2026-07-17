import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { target: "esnext" },
  server: {
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
      "/health": { target: "http://127.0.0.1:3001" }
    }
  }
});
