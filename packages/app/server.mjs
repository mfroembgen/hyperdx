import process from 'node:process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProdServer } from 'vinext/server/prod-server';

import { writeRuntimeEnv } from './scripts/runtime-env.mjs';

const appDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(
  await readFile(join(appDir, 'package.json'), 'utf8'),
);
await writeRuntimeEnv(join(appDir, 'public'), version);
await writeRuntimeEnv(join(appDir, 'dist/client'), version);
await startProdServer({
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  outDir: join(appDir, 'dist'),
});
