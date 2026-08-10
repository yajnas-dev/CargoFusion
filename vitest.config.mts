import { defineConfig } from "vitest/config";
import path from "node:path";
import "dotenv/config"; // loads GEMINI_API_KEY etc. from .env for gated live-integration tests

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Tests share one SQLite file (dev.db) and mutate rows in-place with
    // afterEach cleanup rather than per-test isolation/transactions, so
    // concurrent test files racing against the same rows produce
    // order-dependent false failures. Run files serially instead.
    fileParallelism: false,
  },
});
