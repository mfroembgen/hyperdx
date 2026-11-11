import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    globals: true,
    clearMocks: false,
    pool: 'forks',
    maxWorkers: 4,
    include: ['src/__tests__/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/*.int.test.*'],
    testTimeout: 15000,
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'lcov', 'clover'],
      thresholds: { statements: 70, branches: 55, functions: 72, lines: 71 },
    },
  },
});
