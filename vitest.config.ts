import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { DEV_ACCESS_BYPASS: "1", BREVO_API_KEY: "test-key", GITHUB_CLIENT_ID: "Iv1.test", CLOUDFLARE_CLIENT_ID: "cf-test-client" },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
