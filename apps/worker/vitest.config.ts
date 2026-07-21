import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: {
          ASSETS: () => new Response("Not found", { status: 404 })
        }
      }
    })
  ],
  test: {
    include: ["apps/worker/test/**/*.test.ts"],
    testTimeout: 10_000
  }
});
