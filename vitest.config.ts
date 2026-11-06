import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { DEV_ACCESS_BYPASS: "1", BREVO_API_KEY: "test-key" },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
