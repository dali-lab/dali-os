import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
  test: {
    include: ["app/**/*.integration.test.ts", "integration/**/*.integration.test.ts"],
    environment: "node",
    globalSetup: ["./integration/global-setup.ts"],
    setupFiles: ["./integration/setup.ts"],
    // One database, truncated between tests: files must not run concurrently.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
