import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // tests/scenarios and tests/visual are Playwright's (see
    // playwright.config.ts) — keep vitest scoped to invariants/unit tests
    // so the two runners never try to execute each other's spec files.
    include: ['tests/invariants/**/*.test.ts', 'src/**/*.test.ts'],
  },
});
