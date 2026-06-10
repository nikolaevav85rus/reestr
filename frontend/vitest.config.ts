import { defineConfig } from 'vitest/config';

// Vitest config is intentionally separate from the Playwright config
// (playwright.config.ts -> testDir: './tests'). Vitest only picks up unit
// tests that live under src/ and named *.test.ts(x) / *.spec.ts(x); the
// Playwright e2e suite under tests/** is excluded so the two runners never
// pick up each other's files.
export default defineConfig({
  test: {
    // jsdom gives us window/localStorage for the columnSettings tests; the
    // rest of the pure modules run fine under it too.
    environment: 'jsdom',
    globals: true,
    include: [
      'src/**/*.{test,spec}.ts',
      'src/**/*.{test,spec}.tsx',
    ],
    exclude: [
      'tests/**',
      'node_modules/**',
      'dist/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
});
