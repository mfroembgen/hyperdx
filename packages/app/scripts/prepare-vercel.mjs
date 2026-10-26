import { cp, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeRuntimeDependencies } from './runtime-dependencies.mjs';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(appDir, '.vercel/output');
await materializeRuntimeDependencies(
  join(output, 'functions/__server.func'),
  ['@hyperdx/api', 'react', 'react-dom', '@hyperdx/node-opentelemetry'],
  appDir,
  { excludeSourceMaps: true },
);
async function fileBytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await fileBytes(path);
    else if (entry.isFile()) total += (await stat(path)).size;
  }
  return total;
}
const bytes = await fileBytes(join(output, 'functions/__server.func'));
if (bytes > 250_000_000) {
  throw new Error(
    `Preview function is ${bytes} bytes, above Vercel's 250 MB standard limit.`,
  );
}
console.log(
  `Prepared Vercel Bun function: ${(bytes / 1_000_000).toFixed(1)} MB`,
);

// The Vercel project uses the monorepo root as its build context.
const rootOutput = resolve(appDir, '../../.vercel/output');
await rm(rootOutput, { recursive: true, force: true });
await cp(output, rootOutput, { recursive: true });
