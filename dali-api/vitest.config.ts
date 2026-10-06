import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
  test: {
    globals: true,
    exclude: ["node_modules", "e2e"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text-summary", "html", "json-summary", "lcovonly"],
      // Report every app source file, not only the ones a test happened to import,
      // so the percentages describe the app rather than the suite.
      include: ["app/**/*.{ts,tsx}"],
      exclude: [
        "app/generated/**",
        "app/**/__tests__/**",
        "app/**/*.test.{ts,tsx}",
        "app/**/*.d.ts",
        "app/routes.ts",
        "app/mockData.ts",
        "app/types.ts",
        "app/types/**",
      ],
    },
  },
});
