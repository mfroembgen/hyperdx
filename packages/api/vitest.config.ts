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
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/*.int.test.*'],
    testTimeout: 30000,
    setupFiles: ['./vitest.setup.ts'],
    retry: (() => {
      const raw =
        process.env.VITEST_RETRY_TIMES ?? process.env.JEST_RETRY_TIMES;
      const parsed = raw ? Number(raw) : NaN;
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
    })(),
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json', 'lcov', 'clover'],
    },
  },
});
