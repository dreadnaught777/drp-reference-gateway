import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // No suites are transcribed until their gating milestone (CLAUDE.md: tests
    // are transcribed, then frozen). An empty run is a pass at M0.
    passWithNoTests: true,
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
