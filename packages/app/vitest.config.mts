import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { frameworkAliases } from './config-aliases.mjs';

const appDir = dirname(fileURLToPath(import.meta.url));
process.env.TZ = 'America/New_York';

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['browser', 'module', 'development'],
    mainFields: ['browser', 'module', 'main'],
    dedupe: [
      'react',
      'react-dom',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
    ],
    alias: [
      ...frameworkAliases,
      ...Object.entries({
        '@': resolve(appDir, 'src'),
        '@styles': resolve(appDir, 'styles'),
        tests: resolve(appDir, 'tests'),
        ky: resolve(appDir, 'src/__mocks__/ky.ts'),
        'react-markdown': resolve(appDir, 'src/__mocks__/react-markdown.tsx'),
        'remark-gfm': resolve(appDir, 'src/__mocks__/remark-gfm.ts'),
        'react-syntax-highlighter': resolve(
          appDir,
          'src/__mocks__/react-syntax-highlighter.tsx',
        ),
      }).map(([find, replacement]) => ({ find, replacement })),
    ],
  },
  test: {
    deps: {
      optimizer: {
        client: {
          enabled: true,
          include: [
            '@prometheus-io/codemirror-promql',
            '@uiw/react-codemirror',
            '@codemirror/state',
            '@codemirror/autocomplete',
            '@codemirror/lang-sql',
            '@codemirror/lang-json',
            '@codemirror/lint',
          ],
        },
      },
    },
    globals: true,
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    css: { modules: { classNameStrategy: 'non-scoped' } },
    include: [
      'src/**/*.{test,spec}.{ts,tsx,js,jsx}',
      'src/**/__tests__/*.{ts,tsx,js,jsx}',
    ],
    setupFiles: ['./src/setupTests.tsx'],
    clearMocks: false,
    sequence: { hooks: 'list' },
    pool: 'forks',
    maxWorkers: process.env.CI ? 2 : 1,
    coverage: {
      provider: 'istanbul',
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.stories.{ts,tsx}',
        'src/**/__mocks__/**',
        'src/setupTests.tsx',
      ],
      thresholds: {
        'src/hooks/**': {
          statements: 72,
          branches: 59,
          functions: 66,
          lines: 73,
        },
        'src/utils/**': {
          statements: 74,
          branches: 59,
          functions: 72,
          lines: 76,
        },
        'src/utils.ts': {
          statements: 76,
          branches: 77,
          functions: 75,
          lines: 76,
        },
      },
    },
  },
});
