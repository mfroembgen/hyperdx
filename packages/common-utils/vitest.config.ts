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
    include: ['src/**/__tests__/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/*.int.test.*'],
    testTimeout: 30000,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'lcov', 'clover'],
      thresholds: { statements: 86, branches: 78, functions: 85, lines: 86 },
    },
  },
});
