import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorybookConfig } from '@storybook/react-vite';
import { frameworkAliases } from '../config-aliases.mjs';

const require = createRequire(import.meta.url);
const storybookDir = dirname(fileURLToPath(import.meta.url));
const agentDocsDir = join(storybookDir, '../../../agent_docs');

function getAbsolutePath(value: string): string {
  return dirname(require.resolve(join(value, 'package.json')));
}

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    getAbsolutePath('@storybook/addon-links'),
    getAbsolutePath('@storybook/addon-docs'),
  ],
  framework: {
    name: getAbsolutePath('@storybook/react-vite'),
    options: { builder: { viteConfigPath: false } },
  },
  staticDirs: ['./public'],
  viteFinal: async config => {
    const aliases = Array.isArray(config.resolve?.alias)
      ? config.resolve.alias
      : Object.entries(config.resolve?.alias ?? {}).map(
          ([find, replacement]) => ({ find, replacement }),
        );
    return {
      ...config,
      resolve: {
        ...config.resolve,
        alias: [
          ...aliases,
          ...frameworkAliases,
          { find: '@', replacement: join(storybookDir, '../src') },
          { find: '@styles', replacement: join(storybookDir, '../styles') },
          { find: '@agent-docs', replacement: agentDocsDir },
        ],
      },
    };
  },
};

export default config;
