import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

async function filesIn(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

export async function verifyFrontendBuild(expected, actual) {
  async function fingerprints(root) {
    const result = new Map();
    for (const path of await filesIn(root)) {
      const name = relative(root, path);
      // This file is intentionally rewritten with deployment-specific values.
      if (name === 'client/__ENV.js') continue;
      result.set(
        name,
        createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      );
    }
    for (const name of ['server/BUILD_ID', 'server/RSC_BUILD_ID']) {
      assert.ok(result.has(name), `frontend ${name} is required`);
    }
    return result;
  }
  const [source, image] = await Promise.all([
    fingerprints(expected),
    fingerprints(actual),
  ]);
  for (const name of new Set([...source.keys(), ...image.keys()])) {
    assert.equal(
      image.get(name),
      source.get(name),
      `frontend differs: ${name}`,
    );
  }
  return source.size;
}

export async function verifyNativeAddons(root, arch) {
  const machine = { x64: 62, arm64: 183 }[arch];
  assert.ok(machine, `unsupported architecture: ${arch}`);
  let count = 0;
  for (const path of await filesIn(root)) {
    if (!path.endsWith('.node')) continue;
    const header = await readFile(path);
    assert.ok(
      header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])),
      `native addon is not ELF: ${path}`,
    );
    const actual =
      header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18);
    assert.equal(actual, machine, `native addon architecture differs: ${path}`);
    count++;
  }
  return count;
}

if (import.meta.main) {
  const [expected, actual, modules] = process.argv.slice(2);
  assert.ok(
    expected && actual && modules,
    'expected, actual and modules paths',
  );
  const frontendFiles = await verifyFrontendBuild(expected, actual);
  const nativeAddons = await verifyNativeAddons(modules, process.arch);
  console.log(
    JSON.stringify({ arch: process.arch, frontendFiles, nativeAddons }),
  );
}
