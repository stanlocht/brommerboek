import path from "node:path"
import { defineConfig } from "vitest/config"

// Unit tests only: pure helpers under src/, named *.test.ts. Playwright's
// end-to-end specs live in tests/**/*.spec.ts and are run by `bun run test`
// — the globs are disjoint so neither runner picks up the other's files.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
