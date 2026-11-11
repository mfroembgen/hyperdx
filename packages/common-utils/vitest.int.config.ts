import { defineConfig } from 'vitest/config';

import base from './vitest.config';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/**/__tests__/**/*.int.test.{ts,tsx}'],
    exclude: ['node_modules/**'],
    fileParallelism: false,
    // Coverage floors belong to the full unit suite, as in the Jest configs.
    coverage: { ...base.test.coverage, thresholds: undefined },
  },
});
