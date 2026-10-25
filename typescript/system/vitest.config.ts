import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/tests/**/*.test.ts"],
    exclude: ["node_modules/**"],
    globalSetup: ["application/entitlement-agent/tests/support/global-setup.ts"],
    passWithNoTests: true,
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
