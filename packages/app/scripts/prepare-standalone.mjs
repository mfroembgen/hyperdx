import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeRuntimeDependencies } from './runtime-dependencies.mjs';

if (process.env.NEXT_OUTPUT_STANDALONE === 'true') {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const target = join(appDir, 'dist/standalone');
  const { version } = JSON.parse(
    await readFile(join(appDir, 'package.json'), 'utf8'),
  );
  const manifest = JSON.parse(
    await readFile(join(appDir, 'dist/server/vinext-externals.json'), 'utf8'),
  );
  await materializeRuntimeDependencies(target, [...manifest, 'vinext'], appDir);
  await mkdir(join(target, 'scripts'), { recursive: true });
  await copyFile(join(appDir, 'server.mjs'), join(target, 'server.mjs'));
  await copyFile(
    join(appDir, 'scripts/runtime-env.mjs'),
    join(target, 'scripts/runtime-env.mjs'),
  );
  await writeFile(
    join(target, 'package.json'),
    JSON.stringify({ private: true, type: 'module', version }),
  );
}
