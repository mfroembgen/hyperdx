// Mutation testing config. See CONTRIBUTING.md#mutation-tests.
// The package script preloads the Vitest runner to avoid Bun's plugin-import error.
module.exports = {
  plugins: [
    '@stryker-mutator/typescript-checker',
    '@stryker-mutator/vitest-runner',
  ],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  // Type-check each mutant before running it. Most mutants don't compile, and
  // discarding those up front is much cheaper than a test run per mutant.
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  // Static mutants (module-level constants) are ~10% of the mutants here but
  // ~96% of the runtime, because each one re-runs every test file that loads
  // the module. Not worth it for a tool you run while writing tests.
  ignoreStatic: true,
  // Reuse results for unchanged code, so re-runs only test what you edited.
  incremental: true,
  reporters: ['clear-text', 'progress', 'html'],
  mutate: ['src/**/*.ts', '!src/**/__tests__/**'],
};
