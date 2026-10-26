import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function writeRuntimeEnv(publicDir, version) {
  const values = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      key.startsWith('NEXT_PUBLIC_'),
    ),
  );
  values.NEXT_PUBLIC_APP_VERSION = version;
  const json = JSON.stringify(values).replaceAll('<', '\\u003c');
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, '__ENV.js'), `window.__ENV = ${json};\n`);
}
