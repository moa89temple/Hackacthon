import { defineConfig } from "vitest/config";

/** The checks against the real container: npm run test:browser. Docker Desktop must be running. */
export default defineConfig({
  test: {
    include: ["test/container/**/*.container.ts"],
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
