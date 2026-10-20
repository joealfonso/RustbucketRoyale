import { defineConfig } from "vitest/config";

// Many tests build whole generated maps (hills, water, woods), a few hundred milliseconds each on large, and the
// suite runs them in parallel. On a busy laptop the 5 s default timed out tests that were not wrong, only slow, so
// the limit is 20 s. A test that is genuinely stuck still fails.
export default defineConfig({
  test: { include: ["packages/**/*.test.ts", "scripts/**/*.test.ts"], testTimeout: 20_000 },
});
