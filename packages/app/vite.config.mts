import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vinext from 'vinext';

import { writeRuntimeEnv } from './scripts/runtime-env.mjs';

const appDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  await readFile(join(appDir, 'package.json'), 'utf8'),
);

const previewPlugins =
  process.env.HDX_PREVIEW_INLINE_API === 'true'
    ? [
        (await import('nitro/vite')).nitro({
          preset: 'vercel',
          serverEntry: false,
          rolldownConfig: { external: [/^@hyperdx\/api(?:\/|$)/] },
          vercel: { functions: { runtime: 'bun1.4.x' } },
        }),
      ]
    : [];

export default defineConfig({
  define: {
    'process.env.HDX_PREVIEW_INLINE_API': JSON.stringify(
      process.env.HDX_PREVIEW_INLINE_API ?? 'false',
    ),
  },
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/language',
    ],
  },
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  plugins: [
    vinext({ react: { compiler: true } }),
    ...previewPlugins,
    {
      name: 'hyperdx-native-dev-ssr',
      apply: 'serve',
      async configEnvironment(name, config) {
        if (name !== 'ssr') return;
        // Vinext inlines every dependency; CJS utilities need native loading in
        // the dev module runner. Keep the configured CSS/Next shims transformed.
        const { default: nextConfig } = await import('./next.config.mjs');
        config.resolve.noExternal = nextConfig.transpilePackages;
      },
    },
    {
      name: 'hyperdx-runtime-env',
      async buildStart() {
        await writeRuntimeEnv(join(appDir, 'public'), version);
      },
      async configureServer() {
        await writeRuntimeEnv(join(appDir, 'public'), version);
      },
    },
  ],
  environments: {
    ssr: {
      build: {
        rolldownOptions: {
          external: [/^@hyperdx\/api(?:\/|$)/],
        },
      },
    },
  },
});
