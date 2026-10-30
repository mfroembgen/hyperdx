import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const appDedupe = [
  'react',
  'react-dom',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/language',
];

async function packageAt(path) {
  let directory = dirname(await realpath(path));
  while (directory !== dirname(directory)) {
    try {
      const manifest = join(directory, 'package.json');
      const data = JSON.parse(await readFile(manifest, 'utf8'));
      if (data.name && data.version) {
        return { name: data.name, version: data.version, manifest };
      }
      directory = dirname(directory);
    } catch {
      directory = dirname(directory);
    }
  }
}

export async function buildSdk(root, temporary, output, publishedControl) {
  assert.ok(globalThis.Bun, 'run browser-sdk-memory.mjs with Bun');
  const app = join(root, 'packages/app');
  const requireApp = createRequire(join(app, 'package.json'));
  const sdk = JSON.parse(
    await readFile(requireApp.resolve('@hyperdx/browser/package.json'), 'utf8'),
  );
  assert.equal(
    sdk.version,
    '0.26.0',
    'update SDK contract expectations for a new SDK release',
  );
  const { chromium } = requireApp('@playwright/test');
  let bytes;
  let moduleGraph;
  if (publishedControl) {
    bytes = await readFile(requireApp.resolve('@hyperdx/browser'));
    moduleGraph = {
      publishedControl: true,
      sdkVersion: sdk.version,
      packages: [],
    };
  } else {
    // Keep the app's package resolution; do not alias the SDK or its dependencies.
    await symlink(
      join(app, 'node_modules'),
      join(temporary, 'node_modules'),
      'dir',
    );
    const entry = join(temporary, 'entry.mjs');
    await writeFile(
      entry,
      "import SDK from '@hyperdx/browser'; globalThis.HyperDX = SDK;\n",
    );
    const { build, version } = await import(
      pathToFileURL(requireApp.resolve('vite')).href
    );
    let modules = [];
    const result = await build({
      configFile: false,
      root: app,
      logLevel: 'silent',
      resolve: { dedupe: appDedupe },
      plugins: [
        {
          name: 'browser-sdk-module-graph',
          generateBundle() {
            modules = [...this.getModuleIds()];
          },
        },
      ],
      build: {
        write: false,
        minify: true,
        lib: { entry, formats: ['iife'], name: 'BrowserSdkContract' },
      },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(
      value => value.output,
    );
    const entryChunk = outputs.find(
      file => file.type === 'chunk' && file.isEntry,
    );
    assert.ok(entryChunk, 'Vite browser entry is required');
    bytes = Buffer.from(entryChunk.code);
    assert.ok(modules.length > 0, 'Vite module graph is required');
    await writeFile(
      join(output, 'metafile.json'),
      JSON.stringify({ bundler: 'vite', version, modules }, null, 2),
    );
    const packages = new Map();
    for (const input of modules) {
      const path = input.split('?')[0];
      if (
        input.startsWith('\0') ||
        !isAbsolute(path) ||
        !path.includes('node_modules')
      )
        continue;
      const data = await packageAt(path);
      if (data) packages.set(data.manifest, data);
    }
    const recorder = [...packages.values()].find(pkg => pkg.name === 'rrweb');
    assert.ok(
      recorder,
      'SDK must resolve the app recorder rather than an embedded legacy copy',
    );
    assert.ok(
      Number(recorder.version.split('.')[0]) === 2 &&
        Number(recorder.version.split('.')[1]) >= 2,
      'rrweb must include the 2.2 recorder lifecycle fixes',
    );
    moduleGraph = {
      publishedControl: false,
      bundler: 'vite',
      bundlerVersion: version,
      sdkVersion: sdk.version,
      aliases: [],
      dedupe: appDedupe,
      packages: [...packages.values()],
    };
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await writeFile(
    join(output, 'module-graph.json'),
    JSON.stringify(moduleGraph, null, 2),
  );
  return { bytes, sha256, chromium, moduleGraph };
}
