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
    // Explicit default-plus-.claude exclude: `vitest run <path>` (a bare
    // positional filter, as opposed to a config-default `vitest run` with
    // no args) globs from the filesystem root and picks up stray copies of
    // this same test tree under .claude/worktrees/ (scratch checkouts left
    // by prior background-agent sessions), producing spurious failures
    // against a stale codebase sharing this repo's dev.db.
    exclude: ["**/node_modules/**", "**/dist/**", "**/.{idea,git,cache,output,temp}/**", ".claude/**"],
  },
});
